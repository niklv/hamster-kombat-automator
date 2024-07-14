import { Axios, Proxy } from '~/services'
import {
  BoostsModel,
  ComboModel,
  CompletedTaskModel,
  DailyCipherModel,
  LoginResponseModel,
  ProfileModel,
  TasksListModel,
  UpgradesModel,
} from './interfaces'
import { API_MAP, BOT_MASTER_AXIOS_CONFIG } from './constants'
import { AccountModel } from '~/interfaces'
import { time } from '~/utils'
import { AxiosRequestConfig } from 'axios'

export class ApiService {
  private readonly axios: Axios

  constructor(agent: AccountModel['agent'], proxyString: string | null) {
    const { headers, baseURL } = BOT_MASTER_AXIOS_CONFIG
    const axiosConfig: AxiosRequestConfig = { baseURL, headers: { ...headers, ...agent } }

    if (proxyString) {
      const proxyAgent = Proxy.getAgent(proxyString)
      axiosConfig.httpsAgent = proxyAgent
      axiosConfig.httpAgent = proxyAgent
    }

    this.axios = new Axios({
      config: axiosConfig,
      proxyString,
    })
  }

  async login(tgWebData: string, fp: AccountModel['fingerprint']) {
    try {
      let fingerprint = {}
      this.axios.setAuthToken()

      if (fp) {
        fingerprint = {
          version: '4.2.1',
          visitorId: fp.visitorId,
          components: fp.components,
        }
      }

      const dto = { initDataRaw: tgWebData, fingerprint }
      const { authToken } = await this.axios.post<LoginResponseModel>(API_MAP.login, {
        data: dto,
      })

      this.axios.setAuthToken(authToken)
    } catch (e) {
      throw new Error(`Api | login() | ${e}`)
    }
  }

  async getProfileInfo() {
    try {
      const { clickerUser } = await this.axios.post<ProfileModel>(API_MAP.profileInfo)
      return clickerUser
    } catch (e) {
      throw new Error(`Api | getProfileInfo() | ${e}`)
    }
  }

  async selectExchange(exchangeId: string) {
    try {
      const dto = { exchangeId }
      const { clickerUser } = await this.axios.post<ProfileModel>(API_MAP.exchange, { data: dto })
      return clickerUser
    } catch (e) {
      throw new Error(`Api | selectExchange(${exchangeId}) | ${e}`)
    }
  }

  async getTasks() {
    try {
      const { tasks } = await this.axios.post<TasksListModel>(API_MAP.tasksList)
      return tasks
    } catch (e) {
      throw new Error(`Api | getTasks() | ${e}`)
    }
  }

  async completeTask(taskId: string) {
    try {
      const dto = { taskId }
      const { task } = await this.axios.post<CompletedTaskModel>(API_MAP.completeTask, {
        data: dto,
      })
      return task
    } catch (e) {
      throw new Error(`Api | completeTask(${taskId}) | ${e}`)
    }
  }

  async sendTaps(count: number, availableTaps: number) {
    try {
      const dto = { count, availableTaps, timestamp: time() }
      const { clickerUser } = await this.axios.post<ProfileModel>(API_MAP.tap, { data: dto })
      return clickerUser
    } catch (e) {
      throw new Error(`Api | sendTaps(${count}) | ${e}`)
    }
  }

  async applyBoost(boostId: string) {
    try {
      const dto = { boostId, timestamp: time() }
      const { clickerUser } = await this.axios.post<ProfileModel>(API_MAP.boost, { data: dto })
      return clickerUser
    } catch (e) {
      throw new Error(`Api | applyBoost(${boostId}) | ${e}`)
    }
  }

  async getUpgrades() {
    try {
      const { upgradesForBuy } = await this.axios.post<UpgradesModel>(API_MAP.upgrades)
      return upgradesForBuy
    } catch (e) {
      throw new Error(`Api | getUpgrades() | ${e}`)
    }
  }

  async getBoosts() {
    try {
      const { boostsForBuy } = await this.axios.post<BoostsModel>(API_MAP.boostForBuy)
      return boostsForBuy
    } catch (e) {
      throw new Error(`Api | getBoosts() | ${e}`)
    }
  }

  async buyUpgrade(upgradeId: string) {
    try {
      const dto = { upgradeId, timestamp: Date.now() }
      const { clickerUser } = await this.axios.post<ProfileModel>(API_MAP.buyUpgrade, { data: dto })
      return clickerUser
    } catch (e) {
      throw new Error(`Api | buyUpgrade(${upgradeId}) | ${e}`)
    }
  }

  async claimCombo() {
    try {
      await this.axios.post<ComboModel>(API_MAP.claimCombo, {
        data: {},
      })
      return true
    } catch (e) {
      throw new Error(`Api | claimCombo() | ${e}`)
    }
  }

  async getConfig() {
    try {
      return await this.axios.post<DailyCipherModel>(API_MAP.config, {
        data: {},
      })
    } catch (e) {
      throw new Error(`Api | getConfig() | ${e}`)
    }
  }

  async claimDailyCipher(cipher: string) {
    try {
      return await this.axios.post<DailyCipherModel>(API_MAP.cipher, {
        data: { cipher: cipher.toUpperCase() },
      })
    } catch (e) {
      throw new Error(`Api | claimDailyCipher(${cipher}) | ${e}`)
    }
  }
}
