import { config } from '~/config'
import { Axios, log, Proxy, TGClient } from '~/services'
import { AutomatorState, ProfileModel, UpgradeItem } from './interfaces'
import { AccountModel } from '~/interfaces'
import { BOT_MASTER_AXIOS_CONFIG, DAILY_TASK_ID } from './constants'
import { Api } from './api'
import { msToTime, time, wait } from '~/utils'
import { formatNum, getRandomRangeNumber } from '~/helpers'
import { ONE_DAY_TIMESTAMP, ONE_HOUR_TIMESTAMP } from '~/constants'
import { FloodWaitError } from 'telegram/errors'
import { AxiosRequestConfig } from 'axios'

const {
  taps_count_range,
  turbo_taps_count,
  min_energy,
  sleep_between_taps,
  max_upgrade_lvl,
  tap_mode,
} = config.settings

export class Automator extends TGClient {
  private tokenCreatedTime = 0
  private upgradeSleep = 0
  private energyBoostTimeout = 0
  private state: AutomatorState = {
    availableTaps: 0,
    totalCoins: 0,
    balanceCoins: 0,
    exchangeId: '',
    energyBoostLastUpdate: 0,
    turboBoostLastUpdate: 0,
    maxEnergy: 0,
    tapsRecoverPerSec: 0,
    lastCompletedDaily: 0,
    earnPassivePerSec: 0,
  }
  private isStateInit = false
  private readonly ax: Axios

  constructor(props: AccountModel) {
    super(props)
    const { headers, baseURL } = BOT_MASTER_AXIOS_CONFIG
    let axiosConfig: AxiosRequestConfig = { baseURL, headers: { ...headers, ...props.agent } }

    if (this.client?.proxyString) {
      const agent = Proxy.getAgent(this.client.proxyString)
      axiosConfig.httpsAgent = agent
      axiosConfig.httpAgent = agent
    }

    this.ax = new Axios({
      config: axiosConfig,
      proxyString: props.proxyString,
    })
  }

  private updateState(info: ProfileModel['clickerUser']) {
    const { tasks } = info
    const completedTime = tasks?.[`${DAILY_TASK_ID}`]?.completedAt
    const lastCompletedDaily = completedTime
      ? Math.floor(Date.parse(tasks[`${DAILY_TASK_ID}`].completedAt) / 1000)
      : 0

    this.state = {
      availableTaps: info.availableTaps,
      totalCoins: info.totalCoins,
      balanceCoins: info.balanceCoins,
      exchangeId: info.exchangeId,
      energyBoostLastUpdate: info.boosts?.BoostFullAvailableTaps?.lastUpgradeAt || 0,
      turboBoostLastUpdate: info.boosts?.BoostMaxTaps?.lastUpgradeAt || 0,
      maxEnergy: info.maxTaps,
      tapsRecoverPerSec: info.tapsRecoverPerSec,
      earnPassivePerSec: info.earnPassivePerSec,
      lastCompletedDaily,
    }
    this.isStateInit = true
  }

  private async auth(tgWebData: string) {
    await Api.login(this.ax, tgWebData, this.client.fingerprint)
    this.tokenCreatedTime = time()
    log.success('Successfully authenticated', this.client.name)
  }

  private async setProfileInfo() {
    const data = await Api.getProfileInfo(this.ax)
    const { lastPassiveEarn, earnPassivePerHour, balanceCoins } = data
    this.updateState(data)

    const lpe = lastPassiveEarn.toFixed()
    log.info(
      `Last passive earn: ${formatNum(lpe)} | EPH: ${formatNum(earnPassivePerHour)} | Balance: ${formatNum(balanceCoins)}`,
      this.client.name,
    )
  }

  private async selectExchange() {
    const exchange = 'okx'
    const data = await Api.selectExchange(this.ax, exchange)
    this.updateState(data)

    log.success(`Selected ${exchange} exchange`, this.client.name)
  }

  private async completeDailyTask() {
    const tasks = await Api.getTasks(this.ax)
    const dailyTask = tasks.find(({ id }) => id === DAILY_TASK_ID)

    if (!dailyTask?.isCompleted) {
      const { rewardsByDays, days, completedAt } = await Api.completeTask(this.ax, DAILY_TASK_ID)

      this.state.lastCompletedDaily = Math.floor(Date.parse(completedAt) / 1000)
      const reward = rewardsByDays?.[days - 1].rewardCoins

      if (reward)
        log.success(
          `Collect streak daily reward | Days: ${days} | Reward coins: ${formatNum(reward)}`,
          this.client.name,
        )
    }
  }

  private async applyDailyTurbo() {
    await Api.applyBoost(this.ax, 'BoostMaxTaps')
    log.info('Turbo has been applied', this.client.name)
    await wait()
    await this.sendTaps(turbo_taps_count)
  }

  private async applyDailyEnergy() {
    const boosts = await Api.getBoosts(this.ax)
    const { level, cooldownSeconds } = boosts.filter(({ id }) => id === 'BoostFullAvailableTaps')[0]

    if (level < 6 && cooldownSeconds === 0) {
      const data = await Api.applyBoost(this.ax, 'BoostFullAvailableTaps')
      this.updateState(data)

      log.info(`Energy has been restored | Energy: ${data.availableTaps}`, this.client.name)
    } else {
      this.energyBoostTimeout = time() + ONE_DAY_TIMESTAMP
      log.warn('The limit of free energy restorers for today has been reached!', this.client.name)
    }
  }

  private async sendTaps(count?: number) {
    const [min, max] = taps_count_range
    const tapsCount = count || getRandomRangeNumber(min, max)

    const data = await Api.sendTaps(this.ax, tapsCount, this.state.availableTaps)
    this.updateState(data)

    log.success(
      `Tapped +${tapsCount} | EPH: ${formatNum(data.earnPassivePerHour)} | Balance: ${formatNum(data.balanceCoins)}`,
      this.client.name,
    )
  }

  private async getAvailableUpgrades() {
    const data = await Api.getUpgrades(this.ax)

    const channelsToSubscribe = data.filter(
      ({ isAvailable, isExpired, condition }) =>
        !isAvailable && !isExpired && condition && condition._type === 'SubscribeTelegramChannel',
    )

    await Promise.all(
      channelsToSubscribe.map(async ({ condition }) => {
        await wait()
        await this.subscribeToChannel(condition!.link)
      }),
    )

    const availableUpgrades = data
      .filter(
        ({ isAvailable: isUnlock, isExpired, level, maxLevel = 999, cooldownSeconds = 0 }) => {
          const isAvailable = isUnlock && !isExpired
          const hasMaxUpgradeLevel = level >= max_upgrade_lvl
          const isAvailableToUpgrade = maxLevel > level
          const isCooldown = cooldownSeconds !== 0

          return isAvailable && !hasMaxUpgradeLevel && isAvailableToUpgrade && !isCooldown
        },
      )
      .sort((a, b) => {
        const a_ppr = a.profitPerHourDelta / a.price
        const b_ppr = b.profitPerHourDelta / b.price

        return b_ppr - a_ppr
      })

    return availableUpgrades
  }

  private async buyUpgrade(upgrades: UpgradeItem[]) {
    let balance = this.state.balanceCoins
    let totalCostAllUpgrades = []
    let atLeastOneBought = false

    // TODO: delete after Hamsters`s developer will fix bugs with duplicate upgrade items
    const uniqueUpgrades = [...new Map(upgrades.map((item) => [item.id, item])).values()]

    for (const { price, id, level, profitPerHourDelta } of uniqueUpgrades) {
      if (balance >= price) {
        const res = await Api.buyUpgrade(this.ax, id)
        balance -= price
        atLeastOneBought = true

        log.success(
          `Upgraded [${id}] to ${level} lvl | +${formatNum(profitPerHourDelta)} | EPH: ${formatNum(res.earnPassivePerHour)} | Balance: ${formatNum(balance)}`,
          this.client.name,
        )
        await wait()
      } else {
        totalCostAllUpgrades.push(price)
        log.warn(
          `Insufficient balance to upgrade [${id}] to ${level} lvl | Price: ${formatNum(price)} | Balance ${formatNum(balance)}`,
          this.client.name,
        )
      }
    }

    if (atLeastOneBought) return

    const data = await Api.getProfileInfo(this.ax)
    this.updateState(data)
    const { earnPassivePerSec, balanceCoins } = data
    const minPrice = Math.max(...totalCostAllUpgrades)

    if (minPrice > balanceCoins) {
      const upgradeWaitTime = Math.ceil((minPrice - balanceCoins) / earnPassivePerSec)

      log.warn(
        `Approximate time for rebalancing: ${msToTime(upgradeWaitTime * 1000).formattedTime}`,
        this.client.name,
      )

      this.upgradeSleep = time() + upgradeWaitTime
    }
  }

  async start() {
    try {
      const { proxyString, name } = this.client
      if (proxyString) await Proxy.check(proxyString, name)
      await wait()
      const tgWebData = await this.getTgWebData()
      await wait()

      while (true) {
        const {
          turboBoostLastUpdate,
          exchangeId,
          energyBoostLastUpdate,
          availableTaps,
          maxEnergy,
          tapsRecoverPerSec,
          lastCompletedDaily,
        } = this.state

        const isTokenExpired = time() - this.tokenCreatedTime >= ONE_HOUR_TIMESTAMP
        const isDailyTurboReady = time() - turboBoostLastUpdate > ONE_DAY_TIMESTAMP && false // Turbo is not available in the app right now
        const isDailyEnergyReady = time() - energyBoostLastUpdate > ONE_HOUR_TIMESTAMP
        const isDailyTaskAvailable = time() - lastCompletedDaily > ONE_DAY_TIMESTAMP

        try {
          if (isTokenExpired) {
            await this.auth(tgWebData)
            await wait()
            continue
          }

          if (!this.isStateInit) {
            await this.setProfileInfo()
            await wait()
            continue
          }

          if (exchangeId === 'hamster') {
            await this.selectExchange()
            await wait()
            continue
          }

          if (isDailyTaskAvailable) {
            await this.completeDailyTask()
            await wait()
            continue
          }

          if (!isDailyTurboReady && time() > this.upgradeSleep) {
            const upgrades = await this.getAvailableUpgrades()

            if (upgrades.length !== 0) await this.buyUpgrade(upgrades.slice(0, 4))
          }

          if (tap_mode) {
            if (isDailyTurboReady) {
              await this.applyDailyTurbo()
              await wait()
              continue
            }

            if (min_energy <= availableTaps) {
              const [min, max] = sleep_between_taps
              const sleepTime = getRandomRangeNumber(min, max)

              await this.sendTaps()
              await wait(sleepTime)
              continue
            }

            if (isDailyEnergyReady && time() > this.energyBoostTimeout) {
              await this.applyDailyEnergy()
              await wait()
            } else {
              const sleepTime = (maxEnergy - availableTaps) / tapsRecoverPerSec
              const timeInMinutes = Math.round((maxEnergy - availableTaps) / tapsRecoverPerSec / 60)

              log.info(
                `Minimum energy reached: ${availableTaps} | Approximate energy recovery time ${timeInMinutes} minutes`,
                this.client.name,
              )

              await wait(sleepTime)
            }
          }
        } catch (e) {
          log.error(String(e), this.client.name)
          await wait(15)
        }
      }
    } catch (error) {
      if (error instanceof FloodWaitError) {
        log.error(String(error), this.client.name)
        log.warn(`Sleep ${error.seconds} seconds`, this.client.name)
        await wait(error.seconds)
      }
      await wait()
    }
  }
}
