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
import { ApiError, ApiReponse } from '../ApiClient';
import CurrentAccount from './CurrentAccount';
import { SupernetType } from '../ApiClient/WebSocketClient/types';

/**
 * Account API methods that let you interact with the user's account.
 * Can be accessed via `client.account`. Look for more samples below.
 *
 * @example Retrieve the current account balance
 * ```typescript
 * const balance = await client.account.refreshBalance();
 * console.log(balance);
 * ```
 *
 */
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

  private async getNonce(walletAddress: string): Promise<string> {
    const res = await this.client.rest.post<ApiReponse<Nonce>>('/v1/account/nonce', {
      walletAddress
    });
    return res.data.nonce;
  }

  /**
   * Create Ethers.js Wallet instance from username and password.
   * This method is used internally to create a wallet for the user.
   * You can use this method to create a wallet if you need to sign transactions.
   *
   * @example Create a wallet from username and password
   * ```typescript
   * const wallet = client.account.getWallet('username', 'password');
   * console.log(wallet.address);
   * ```
   *
   * @param username - Sogni account username
   * @param password - Sogni account password
   */
  getWallet(username: string, password: string): Wallet {
    const pwd = toUtf8Bytes(username.toLowerCase() + password);
    const salt = toUtf8Bytes('sogni-salt-value');
    const pkey = pbkdf2(pwd, salt, 10000, 32, 'sha256');
    return new Wallet(pkey, this.provider);
  }

  /**
   * Create a new account with the given username, email, and password.
   * @internal
   *
   * @param username
   * @param email
   * @param password
   * @param subscribe
   * @param referralCode
   */
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

  /**
   * Restore session with username and access token.
   *
   * You can save access token that you get from the login method and restore the session with this method.
   *
   * @example Store access token to local storage
   * ```typescript
   * const { username, token } = await client.account.login('username', 'password');
   * localStorage.setItem('sogni-username', username);
   * localStorage.setItem('sogni-token', token);
   * ```
   *
   * @example Restore session from local storage
   * ```typescript
   * const username = localStorage.getItem('sogni-username');
   * const token = localStorage.getItem('sogni-token');
   * if (username && token) {
   *  client.account.setToken(username, token);
   *  console.log('Session restored');
   * }
   * ```
   *
   * @param username
   * @param token
   */
  setToken(username: string, token: string): void {
    this.client.authenticate(token);
    this.currentAccount._update({
      token,
      username
    });
  }

  /**
   * Login with username and password. WebSocket connection is established after successful login.
   *
   * @example Login with username and password
   * ```typescript
   * await client.account.login('username', 'password');
   * console.log('Logged in');
   * ```
   *
   * @param username
   * @param password
   */
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

  /**
   * Logout the user and close the WebSocket connection.
   *
   * @example Logout the user
   * ```typescript
   * await client.account.logout();
   * console.log('Logged out');
   * ```
   */
  async logout(): Promise<void> {
    this.client.rest.post('/v1/account/logout').catch((e) => {
      this.client.logger.error('Failed to logout', e);
    });
    this.client.removeAuth();
    this.currentAccount._clear();
  }

  /**
   * Refresh the balance of the current account.
   *
   * Usually, you don't need to call this method manually. Balance is updated automatically
   * through WebSocket events. But you can call this method to force a balance refresh.
   *
   * @example Refresh user account balance
   * ```typescript
   * const balance = await client.account.refreshBalance();
   * console.log(balance);
   * // { net: '100.000000', settled: '100.000000', credit: '0.000000', debit: '0.000000' }
   * ```
   */
  async refreshBalance(): Promise<BalanceData> {
    const res = await this.client.rest.get<ApiReponse<BalanceData>>('/v1/account/balance');
    this.currentAccount._update({ balance: res.data });
    return res.data;
  }

  /**
   * Get the balance of the wallet address.
   *
   * This method is used to get the balance of the wallet address. It returns $SOGNI and ETH balance.
   *
   * @example Get the balance of the wallet address
   * ```typescript
   * const address = client.account.currentAccount.walletAddress;
   * const balance = await client.account.walletBalance(address);
   * console.log(balance);
   * // { token: '100.000000', ether: '0.000000' }
   * ```
   *
   * @param walletAddress
   */
  async walletBalance(walletAddress: string) {
    const res = await this.client.rest.get<ApiReponse<{ token: string; ether: string }>>(
      '/v1/wallet/balance',
      {
        walletAddress
      }
    );
    return res.data;
  }

  /**
   * Validate the username before signup
   * @internal
   * @param username
   */
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

  /**
   * Switch between fast and relaxed networks.
   * Note: This method will close the current WebSocket connection and establish a new one.
   * Do not call this method if you have any active projects.
   *
   * @example Switch to the fast network
   * ```typescript
   * client.apiClient.once('connected', ({ network }) => {
   *  console.log('Switched to the network:', network);
   * });
   * await client.account.switchNetwork('fast');
   * ```
   * @param network
   */
  async switchNetwork(network: SupernetType) {
    this.currentAccount._update({
      networkStatus: 'connecting',
      network: null
    });
    this.client.socket.switchNetwork(network);
  }

  /**
   * Get the transaction history of the current account.
   *
   * @example Get the transaction history
   * ```typescript
   * const { entries, next } = await client.account.transactionHistory({
   *  status: 'completed',
   *  limit: 10,
   *  address: client.account.currentAccount.walletAddress
   * });
   * ```
   *
   * @param params - Transaction history query parameters
   * @returns Transaction history entries and next query parameters
   */
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

  /**
   * Get the rewards of the current account.
   * @internal
   */
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

  /**
   * Claim rewards by reward IDs.
   * @internal
   * @param rewardIds
   */
  async claimRewards(rewardIds: string[]): Promise<void> {
    await this.client.rest.post('/v2/account/reward/claim', {
      claims: rewardIds
    });
  }
}

export default AccountApi;
