import { config } from '~/config'
import { log, Proxy, TGClient } from '~/services'
import { AutomatorState, ProfileModel, UpgradeItem } from './interfaces'
import { AccountModel } from '~/interfaces'
import { DAILY_TASK_ID } from './constants'
import { ApiService } from './api'
import { secToTime, time, wait } from '~/utils'
import { formatNum, getRandomRangeNumber } from '~/helpers'
import { ONE_DAY_TIMESTAMP, ONE_HOUR_TIMESTAMP } from '~/constants'
import { FloodWaitError } from 'telegram/errors'
import { getDailyCombo } from '~/automator/utils'
import { addHours, addSeconds, differenceInSeconds, min } from 'date-fns'

const {
  taps_count_range,
  turbo_taps_count,
  sleep_between_taps,
  max_upgrade_lvl,
  tap_mode,
  buy_mode,
} = config.settings

export class Automator extends TGClient {
  private tokenCreatedTime = 0
  private energyBoostTimeout = 0
  private cipherAvailableAt = 0
  private comboAvailableAt = 0
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
    earnPerTap: 1,
  }
  private readonly api: ApiService

  constructor(props: AccountModel) {
    super(props)
    this.api = new ApiService(props.agent, props.proxyString)
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
      earnPerTap: info.earnPerTap,
      lastCompletedDaily,
    }
  }

  private async refreshToken(tgWebData: string) {
    if (time() - this.tokenCreatedTime < ONE_HOUR_TIMESTAMP) return
    await this.api.login(tgWebData, this.client.fingerprint)
    this.tokenCreatedTime = time()
    log.success('Successfully authenticated', this.client.name)
    await wait()
  }

  private async getProfileInfo() {
    const data = await this.api.getProfileInfo()
    const { lastPassiveEarn, earnPassivePerHour, balanceCoins } = data
    this.updateState(data)

    const lpe = lastPassiveEarn.toFixed()
    log.info(
      `Last passive earn: ${formatNum(lpe)} | EPH: ${formatNum(earnPassivePerHour)} | Balance: ${formatNum(balanceCoins)}`,
      this.client.name,
    )
    await wait()
  }

  private async selectExchange() {
    if (this.state.exchangeId !== 'hamster') return
    const exchange = 'okx'
    const data = await this.api.selectExchange(exchange)
    this.updateState(data)

    log.success(`Selected ${exchange} exchange`, this.client.name)
    await wait()
  }

  private async completeDailyTask() {
    if (time() - this.state.lastCompletedDaily < ONE_DAY_TIMESTAMP) return
    const tasks = await this.api.getTasks()
    console.log(tasks)
    const dailyTask = tasks.find(({ id }) => id === DAILY_TASK_ID)

    if (!dailyTask?.isCompleted) {
      const { rewardsByDays, days, completedAt } = await this.api.completeTask(DAILY_TASK_ID)

      this.state.lastCompletedDaily = Math.floor(Date.parse(completedAt) / 1000)
      const reward = rewardsByDays?.[days - 1].rewardCoins

      if (reward)
        log.success(
          `Collect streak daily reward | Days: ${days} | Reward coins: ${formatNum(reward)}`,
          this.client.name,
        )
    }
    await wait()
  }

  private async completePuzzle() {
    // TODO
  }

  private async applyDailyTurbo() {
    await this.api.applyBoost('BoostMaxTaps')
    log.info('Turbo has been applied', this.client.name)
    await wait()
    await this.sendTaps(turbo_taps_count)
  }

  private async applyDailyEnergy() {
    const boosts = await this.api.getBoosts()
    const { level, cooldownSeconds } = boosts.filter(({ id }) => id === 'BoostFullAvailableTaps')[0]

    if (level < 6 && cooldownSeconds === 0) {
      const data = await this.api.applyBoost('BoostFullAvailableTaps')
      this.updateState(data)

      log.info(`Energy has been restored | Energy: ${data.availableTaps}`, this.client.name)
    } else {
      this.energyBoostTimeout = time() + ONE_DAY_TIMESTAMP
      log.warn('The limit of free energy restorers for today has been reached!', this.client.name)
    }
  }

  private async sendTaps(count?: number) {
    const [min_taps, max_taps] = taps_count_range
    const tapsCount = count || getRandomRangeNumber(min_taps, max_taps)

    const data = await this.api.sendTaps(tapsCount, this.state.availableTaps)
    this.updateState(data)

    log.success(
      `Tapped +${tapsCount} | EPH: ${formatNum(data.earnPassivePerHour)} | Balance: ${formatNum(data.balanceCoins)}`,
      this.client.name,
    )
  }

  private async claimCipher() {
    if (time() < this.cipherAvailableAt) return
    try {
      const { dailyCipher } = await this.api.getConfig()
      const { remainSeconds, isClaimed, bonusCoins, cipher = '' } = dailyCipher
      const decodedCipher = atob(`${cipher.slice(0, 3)}${cipher.slice(4)}`)
      this.cipherAvailableAt = time() + 5 * 60 * 60

      if (remainSeconds === 0) {
        log.warn(`Cipher [${decodedCipher}] is expired!`, this.client.name)
        await wait()
        return
      }

      if (isClaimed) {
        log.warn(`Cipher [${decodedCipher}] already claimed!`, this.client.name)
        await wait()
        return
      }

      const { clickerUser } = await this.api.claimDailyCipher(decodedCipher)
      this.updateState(clickerUser)

      log.success(
        `Successfully claimed [${decodedCipher}] cipher! +${formatNum(bonusCoins)}`,
        this.client.name,
      )
    } catch (e) {
      log.warn(String(e), this.client.name)
    }
    await wait()
  }

  async claimCombo() {
    try {
      await this.api.claimCombo()
      log.success(`Successfully claimed daily combo!`, this.client.name)
    } catch (e) {
      log.warn(`Daily combo claim is unavailable: ${e}`, this.client.name)
    }
  }

  async claimDailyCombo() {
    if (time() < this.comboAvailableAt) return
    const { combo, date } = await getDailyCombo()
    let balance = this.state.balanceCoins
    const dayOfDate = Number(date.slice(0, 2))
    const currentDay = new Date().getDate()
    this.comboAvailableAt = time() + 3 * 60 * 60

    if (dayOfDate !== currentDay) {
      log.warn('There is no new combo yet today', this.client.name)
      await wait()
      return
    }

    log.info(`Available combo cards [${combo.join(', ')}] for ${date}`, this.client.name)

    const upgrades = await this.getPossibleUpgrades()
    const comboCards = upgrades.filter(({ id }) => combo.includes(id))

    if (comboCards.length !== 3) {
      const unavailableCards = combo.filter((id) => !comboCards.some((item) => item.id === id))

      log.warn(
        `Cant claim daily combo because of you have unavailable cards for this combo: [${unavailableCards.join(', ')}]`,
        this.client.name,
      )
      await wait()
      return
    }

    log.info('Trying buy combo cars...', this.client.name)
    const unboughtCards: string[] = []

    for (const { id, price, level } of comboCards) {
      if (balance >= price) {
        await this.api.buyUpgrade(id)
        balance -= price
        await wait()
      } else {
        log.warn(
          `Insufficient balance to upgrade [${id}] to ${level} lvl | Price: ${formatNum(price)} | Balance ${formatNum(balance)}`,
          this.client.name,
        )
        unboughtCards.push(id)
      }
    }

    const data = await this.api.getProfileInfo()
    this.updateState(data)

    if (unboughtCards.length === 3) {
      await this.claimCombo()
    } else {
      log.warn(
        `Daily combo claim is unavailable, unpurchased cards from combo: [${unboughtCards.join(', ')}]`,
        this.client.name,
      )
    }
    await wait()
  }

  private async tapCoins(): Promise<Date> {
    // 1. first tap all available coins
    while (this.state.earnPerTap < this.state.availableTaps) {
      await this.sendTaps()
      const [min_sleep, max_sleep] = sleep_between_taps
      const sleepTime = getRandomRangeNumber(min_sleep, max_sleep)
      await wait(sleepTime)
    }

    // 2. apply daily energy if available
    const isDailyEnergyReady = time() - this.state.energyBoostLastUpdate > ONE_HOUR_TIMESTAMP
    if (isDailyEnergyReady && time() > this.energyBoostTimeout) {
      await this.applyDailyEnergy()
      await wait()
      return this.tapCoins()
    }

    const { availableTaps, maxEnergy, tapsRecoverPerSec } = this.state
    const sleepSeconds = (maxEnergy - availableTaps) / tapsRecoverPerSec

    log.info(
      `Minimum energy reached: ${availableTaps} | Approximate energy recovery time ${secToTime(sleepSeconds)}`,
      this.client.name,
    )

    return addSeconds(Date.now(), sleepSeconds)
  }

  private async getPossibleUpgrades() {
    let upgrades = await this.api.getUpgrades()

    // TODO: delete after Hamsters`s developer will fix bugs with duplicate upgrade items
    upgrades = [...new Map(upgrades.map((item) => [item.id, item])).values()]

    const channelsToSubscribe = upgrades.filter(
      ({ isAvailable, isExpired, condition }) =>
        !isAvailable && !isExpired && condition?._type === 'SubscribeTelegramChannel',
    )

    await Promise.all(
      channelsToSubscribe.map(async (upgrade: UpgradeItem) => {
        await wait()
        await this.subscribeToChannel(upgrade.condition!.link)
        upgrade.isAvailable = true
      }),
    )

    return upgrades
      .filter(({ isAvailable, isExpired, level, maxLevel = 999 }) => {
        const hasMaxUpgradeLevel = level >= max_upgrade_lvl
        const isAvailableToUpgrade = maxLevel > level
        return isAvailable && !isExpired && !hasMaxUpgradeLevel && isAvailableToUpgrade
      })
      .sort((a, b) => {
        const a_ppr = a.profitPerHourDelta / a.price
        const b_ppr = b.profitPerHourDelta / b.price

        return b_ppr - a_ppr
      })
  }

  private async buyUpgrades(): Promise<Date> {
    // TODO approximate combo profit
    // await this.claimCombo()

    while (true) {
      const possibleUpgrades = await this.getPossibleUpgrades()
      await wait()
      if (!possibleUpgrades.length) {
        log.warn(`No upgrades available: Sleep for 1 hour`, this.client.name)
        return addHours(Date.now(), 1)
      }
      const bestUpgrade = possibleUpgrades.find(({ cooldownSeconds = 0 }) => cooldownSeconds === 0)
      if (bestUpgrade && bestUpgrade.price <= this.state.balanceCoins) {
        await this.buyUpgrade(bestUpgrade)
        await wait()
        continue
      }

      const nextUpgrade = possibleUpgrades[0]
      if (nextUpgrade.cooldownSeconds) {
        log.info(
          `No upgrades available: Wait for upgrade cooldown [${nextUpgrade.id}] ${secToTime(nextUpgrade.cooldownSeconds)}`,
          this.client.name,
        )
        return addSeconds(Date.now(), nextUpgrade.cooldownSeconds)
      }

      log.warn(
        `Insufficient balance to upgrade [${nextUpgrade.id}] to ${nextUpgrade.level} lvl | Price: ${formatNum(nextUpgrade.price)} | Balance ${formatNum(this.state.balanceCoins)}`,
        this.client.name,
      )

      const upgradeWaitSeconds = Math.ceil(
        (nextUpgrade.price - this.state.balanceCoins) / this.state.earnPassivePerSec,
      )

      log.info(
        `Approximate time for rebalancing: ${secToTime(upgradeWaitSeconds)}`,
        this.client.name,
      )

      return addSeconds(Date.now(), upgradeWaitSeconds)
    }
  }

  private async buyUpgrade(upgrade: UpgradeItem) {
    const { id, level, profitPerHourDelta } = upgrade
    const data = await this.api.buyUpgrade(id)
    this.updateState(data)
    log.success(
      `Upgraded [${id}] to ${level} lvl | +${formatNum(profitPerHourDelta)} | EPH: ${formatNum(data.earnPassivePerHour)} | Balance: ${formatNum(data.balanceCoins)}`,
      this.client.name,
    )
  }

  async start() {
    try {
      const { proxyString, name } = this.client
      if (proxyString) await Proxy.check(proxyString, name)
      await wait()
      const tgWebData = await this.getTgWebData()
      await wait()

      while (true) {
        try {
          await this.refreshToken(tgWebData)
          await this.getProfileInfo()
          await this.selectExchange()
          await this.claimCipher()
          await this.completeDailyTask()
          await this.completePuzzle()

          // TODO use dates not sleep seconds cause buy mode takes time too
          let nextRun = addHours(new Date(), 1)

          if (tap_mode) {
            const coinsNextRun = await this.tapCoins()
            nextRun = min([nextRun, coinsNextRun])
          }

          if (buy_mode) {
            // TODO daily combo
            await this.claimDailyCombo()
            const buyNextRun = await this.buyUpgrades()
            nextRun = min([nextRun, buyNextRun])
          }

          log.info(`Next run at ${nextRun.toString()}}`, this.client.name)
          await wait(differenceInSeconds(nextRun.getTime(), Date.now()))
        } catch (e) {
          log.error(String(e), this.client.name)
          await wait(15)
          continue
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
