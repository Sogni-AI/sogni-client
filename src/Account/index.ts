import {
  AccountCreateData,
  BalanceData,
  LoginData,
  Nonce,
  Reward,
  RewardRaw,
  TxHistoryData,
  TxHistoryEntry,
  TxHistoryParams
} from './types';
import ApiGroup, { ApiConfig } from '../ApiGroup';
import { Wallet, pbkdf2, toUtf8Bytes } from 'ethers';
import { ApiError, ApiReponse } from '../ApiClient/ApiClient';
import CurrentAccount from './CurrentAccount';
import { SupernetType } from '../ApiClient/WebSocketClient/types';

class AccountApi extends ApiGroup {
  readonly currentAccount = new CurrentAccount();

  constructor(config: ApiConfig) {
    super(config);
    this.client.socket.on('balanceUpdate', this.handleBalanceUpdate.bind(this));
    this.client.on('connected', this.handleServerConnected.bind(this));
    this.client.on('disconnected', this.handleServerDisconnected.bind(this));
  }

  private handleBalanceUpdate(data: BalanceData) {
    this.currentAccount._update({ balance: data });
  }

  private handleServerConnected({ network }: { network: SupernetType }) {
    this.currentAccount._update({
      networkStatus: 'connected',
      network
    });
  }

  private handleServerDisconnected() {
    this.currentAccount._clear();
  }

  async getNonce(walletAddress: string): Promise<string> {
    const res = await this.client.rest.post<ApiReponse<Nonce>>('/v1/account/nonce', {
      walletAddress
    });
    return res.data.nonce;
  }

  getWallet(username: string, password: string): Wallet {
    const pwd = toUtf8Bytes(username.toLowerCase() + password);
    const salt = toUtf8Bytes('sogni-salt-value');
    const pkey = pbkdf2(pwd, salt, 10000, 32, 'sha256');
    return new Wallet(pkey, this.provider);
  }

  async create(
    username: string,
    email: string,
    password: string,
    subscribe = false,
    referralCode?: string
  ): Promise<AccountCreateData> {
    const wallet = this.getWallet(username, password);
    const nonce = await this.getNonce(wallet.address);
    const payload = {
      appid: this.client.appId,
      username,
      email,
      subscribe: subscribe ? 1 : 0,
      walletAddress: wallet.address
    };
    const signature = await this.eip712.signTypedData(wallet, 'signup', { ...payload, nonce });
    const res = await this.client.rest.post<ApiReponse<AccountCreateData>>('/v1/account/create', {
      ...payload,
      referralCode,
      signature
    });
    this.setToken(username, res.data.token);
    return res.data;
  }

  setToken(username: string, token: string): void {
    this.client.authenticate(token);
    this.currentAccount._update({
      token,
      username
    });
  }

  async login(username: string, password: string): Promise<LoginData> {
    const wallet = this.getWallet(username, password);
    const nonce = await this.getNonce(wallet.address);
    const signature = await this.eip712.signTypedData(wallet, 'authentication', {
      walletAddress: wallet.address,
      nonce
    });
    const res = await this.client.rest.post<ApiReponse<LoginData>>('/v1/account/login', {
      walletAddress: wallet.address,
      signature
    });
    this.setToken(username, res.data.token);
    return res.data;
  }

  async logout(): Promise<void> {
    this.client.rest.post('/v1/account/logout').catch((e) => {
      console.error('Failed to logout', e);
    });
    this.client.removeAuth();
    this.currentAccount._clear();
  }

  async refreshBalance(): Promise<BalanceData> {
    const res = await this.client.rest.get<ApiReponse<BalanceData>>('/v1/account/balance');
    this.currentAccount._update({ balance: res.data });
    return res.data;
  }

  async walletBalance(walletAddress: string) {
    const res = await this.client.rest.get<ApiReponse<{ token: string; ether: string }>>(
      '/v1/wallet/balance',
      {
        walletAddress
      }
    );
    return res.data;
  }

  async validateUsername(username: string) {
    try {
      return await this.client.rest.post<ApiReponse<undefined>>('/v1/account/username/validate', {
        username
      });
    } catch (e) {
      if (e instanceof ApiError) {
        // Username is already taken
        if (e.payload.errorCode === 108) {
          return e.payload;
        }
      }
      throw e;
    }
  }

  async switchNetwork(network: SupernetType) {
    this.currentAccount._update({
      networkStatus: 'connecting',
      network: null
    });
    this.client.socket.switchNetwork(network);
  }

  async transactionHistory(
    params: TxHistoryParams
  ): Promise<{ entries: TxHistoryEntry[]; next: TxHistoryParams }> {
    const res = await this.client.rest.get<ApiReponse<TxHistoryData>>('/v1/transactions/list', {
      status: params.status,
      address: params.address,
      limit: params.limit.toString()
    });

    return {
      entries: res.data.transactions.map(
        (tx): TxHistoryEntry => ({
          id: tx.id,
          address: tx.address,
          createTime: new Date(tx.createTime),
          updateTime: new Date(tx.updateTime),
          status: tx.status,
          role: tx.role,
          amount: tx.amount,
          description: tx.description,
          source: tx.source,
          endTime: new Date(tx.endTime),
          type: tx.type
        })
      ),
      next: {
        ...params,
        offset: res.data.next
      }
    };
  }

  async rewards(): Promise<Reward[]> {
    const r =
      await this.client.rest.get<ApiReponse<{ rewards: RewardRaw[] }>>('/v2/account/rewards');

    return r.data.rewards.map(
      (raw: RewardRaw): Reward => ({
        id: raw.id,
        type: raw.type,
        title: raw.title,
        description: raw.description,
        amount: raw.amount,
        claimed: !!raw.claimed,
        canClaim: !!raw.canClaim,
        lastClaim: new Date(raw.lastClaimTimestamp * 1000),
        nextClaim:
          raw.lastClaimTimestamp && raw.claimResetFrequencySec > -1
            ? new Date(raw.lastClaimTimestamp * 1000 + raw.claimResetFrequencySec * 1000)
            : null
      })
    );
  }

  async claimRewards(rewardIds: string[]): Promise<void> {
    await this.client.rest.post('/v2/account/reward/claim', {
      claims: rewardIds
    });
  }
}

export default AccountApi;
