import {
  AccountCreateData,
  AccountCreateParams,
  Balances,
  ClaimOptions,
  FullBalances,
  LoginData,
  Nonce,
  Reward,
  RewardRaw,
  RewardsQuery,
  TxHistoryData,
  TxHistoryEntry,
  TxHistoryParams
} from './types';
import ApiGroup, { ApiConfig } from '../ApiGroup';
import { parseEther, pbkdf2, toUtf8Bytes, Wallet } from 'ethers';
import { ApiError, ApiResponse } from '../ApiClient';
import CurrentAccount from './CurrentAccount';
import { SupernetType } from '../ApiClient/WebSocketClient/types';
import { AuthUpdatedEvent, Tokens } from '../lib/AuthManager';
import { delay } from '../lib/utils';

const MAX_DEPOSIT_ATTEMPTS = 4;
enum ErrorCode {
  INSUFFICIENT_BALANCE = 123,
  INSUFFICIENT_ALLOWANCE = 149
}
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
    this.client.auth.on('updated', this.handleAuthUpdated.bind(this));
  }

  private handleBalanceUpdate(data: Balances) {
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

  private handleAuthUpdated({ refreshToken, token, walletAddress }: AuthUpdatedEvent) {
    if (!refreshToken) {
      this.currentAccount._clear();
    } else {
      this.currentAccount._update({ walletAddress, token, refreshToken });
    }
  }

  /**
   * Get the nonce for the given wallet address.
   * @param walletAddress
   * @internal
   */
  async getNonce(walletAddress: string): Promise<string> {
    const res = await this.client.rest.post<ApiResponse<Nonce>>('/v1/account/nonce', {
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
    return new Wallet(pkey);
  }

  /**
   * Create a new account with the given username, email, and password.
   * @internal
   */
  async create({
    username,
    email,
    password,
    subscribe,
    turnstileToken,
    referralCode
  }: AccountCreateParams): Promise<AccountCreateData> {
    const wallet = this.getWallet(username, password);
    const nonce = await this.getNonce(wallet.address);
    const payload = {
      appid: this.client.appId,
      username,
      email,
      subscribe: subscribe ? 1 : 0,
      walletAddress: wallet.address,
      turnstileToken
    };
    const signature = await this.eip712.signTypedData(wallet, 'signup', { ...payload, nonce });
    const res = await this.client.rest.post<ApiResponse<AccountCreateData>>('/v1/account/create', {
      ...payload,
      referralCode,
      signature
    });
    await this.setToken(username, { refreshToken: res.data.refreshToken, token: res.data.token });
    return res.data;
  }

  /**
   * Restore session with username and refresh token.
   *
   * You can save access token that you get from the login method and restore the session with this method.
   *
   * @example Store access token to local storage
   * ```typescript
   * const { username, token, refreshToken } = await client.account.login('username', 'password');
   * localStorage.setItem('sogni-username', username);
   * localStorage.setItem('sogni-token', token);
   * localStorage.setItem('sogni-refresh-token', refreshToken);
   * ```
   *
   * @example Restore session from local storage
   * ```typescript
   * const username = localStorage.getItem('sogni-username');
   * const token = localStorage.getItem('sogni-token');
   * const refreshToken = localStorage.getItem('sogni-refresh-token');
   * if (username && refreshToken) {
   *  client.account.setToken(username, {token, refreshToken});
   *  console.log('Session restored');
   * }
   * ```
   *
   * @param username
   * @param tokens - Refresh token, access token pair { refreshToken: string, token: string }
   */
  async setToken(username: string, tokens: Tokens): Promise<void> {
    await this.client.authenticate(tokens);
    this.currentAccount._update({
      username,
      walletAddress: this.client.auth.walletAddress
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
    const res = await this.client.rest.post<ApiResponse<LoginData>>('/v1/account/login', {
      walletAddress: wallet.address,
      signature
    });
    await this.setToken(username, { refreshToken: res.data.refreshToken, token: res.data.token });
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
   * through WebSocket events. But you can call this method to force a balance refresh. Note that
   * will also trigger updated event on the current account.
   *
   * @example Refresh user account balance
   * ```typescript
   * const balance = await client.account.refreshBalance();
   * console.log(balance);
   * ```
   */
  async refreshBalance(): Promise<Balances> {
    const balance = await this.accountBalance();
    this.currentAccount._update({ balance: balance });
    return balance;
  }

  /**
   * Get the account balance of the current account.
   * This method returns the account balance of the current user, including settled, credit, debit, and unclaimed earnings amounts.
   *
   * @example Get the account balance of the current user
   * ```typescript
   * const balance = await client.account.accountBalance();
   * console.log(balance);
   * ```
   */
  async accountBalance(): Promise<FullBalances> {
    const res = await this.client.rest.get<ApiResponse<FullBalances>>('/v3/account/balance');
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
    const res = await this.client.rest.get<
      ApiResponse<{ sogni: string; spark: string; ether: string }>
    >('/v2/wallet/balance', {
      walletAddress
    });
    return res.data;
  }

  /**
   * Validate the username before signup
   * @internal
   * @param username
   */
  async validateUsername(username: string) {
    try {
      return await this.client.rest.post<ApiResponse<undefined>>('/v1/account/username/validate', {
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
   * This will change default network used to process projects. After switching, client will receive
   * list of AI models available for on selected network.
   *
   * @example Switch to the fast network
   * ```typescript
   * await client.account.switchNetwork('fast');
   * console.log('Switched to the fast network, now lets wait until we get list of models');
   * await client.projects.waitForModels();
   * ```
   * @param network - Network type to switch to
   */
  async switchNetwork(network: SupernetType): Promise<SupernetType> {
    this.currentAccount._update({
      networkStatus: 'switching',
      network: null
    });
    const newNetwork = await this.client.socket.switchNetwork(network);
    this.currentAccount._update({
      networkStatus: 'connected',
      network: newNetwork
    });
    return newNetwork;
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
    const query: Record<string, string> = {
      status: params.status,
      address: params.address,
      limit: params.limit.toString()
    };
    if (params.offset) {
      query.offset = params.offset.toString();
    }
    if (params.provider) {
      query.provider = params.provider;
    }
    const res = await this.client.rest.get<ApiResponse<TxHistoryData>>(
      '/v1/transactions/list',
      query
    );

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
          tokenType: tx.tokenType,
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
  async rewards(query: RewardsQuery = {}): Promise<Reward[]> {
    const r = await this.client.rest.get<ApiResponse<{ rewards: RewardRaw[] }>>(
      '/v4/account/rewards',
      query
    );

    return r.data.rewards.map(
      (raw: RewardRaw): Reward => ({
        id: raw.id,
        type: raw.type,
        title: raw.title,
        description: raw.description,
        amount: raw.amount,
        tokenType: raw.tokenType,
        claimed: !!raw.claimed,
        canClaim: !!raw.canClaim,
        lastClaim: new Date(raw.lastClaimTimestamp * 1000),
        provider: query.provider || 'base',
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
   * @param options - Options for claiming rewards
   * @param options.turnstileToken - Turnstile token for anti-bot protection
   * @param options.provider - Provider name for the rewards
   */
  async claimRewards(
    rewardIds: string[],
    { turnstileToken, provider }: ClaimOptions = {}
  ): Promise<void> {
    const payload: Record<string, any> = {
      claims: rewardIds,
      provider: provider || 'base'
    };
    if (turnstileToken) {
      payload.turnstileToken = turnstileToken;
    }
    await this.client.rest.post('/v3/account/reward/claim', payload);
  }

  /**
   * Withdraw funds from the current account to wallet.
   * @example withdraw to current wallet address
   * ```typescript
   * await client.account.withdraw('your-account-password', 100);
   * ```
   *
   * @param password - account password
   * @param amount - amount of tokens to withdraw from account to wallet
   */
  async withdraw(password: string, amount: number | string): Promise<void> {
    const wallet = this.getWallet(this.currentAccount.username!, password);
    const walletAddress = wallet.address;
    const nonce = await this.getNonce(walletAddress);
    const payload = {
      walletAddress: walletAddress,
      amount: parseEther(amount.toString()).toString()
    };
    if (walletAddress !== this.currentAccount.walletAddress) {
      throw new ApiError(400, {
        status: 'error',
        message: 'Incorrect password',
        errorCode: 0
      });
    }
    const signature = await this.eip712.signTypedData(wallet, 'withdraw', { ...payload, nonce });
    await this.client.rest.post('/v1/account/token/withdraw', {
      ...payload,
      signature: signature
    });
  }

  /**
   * Deposit tokens from wallet to account
   * @example withdraw to current wallet address
   * ```typescript
   * await client.account.deposit('your-account-password', 100);
   * ```
   *
   * @param password - account password
   * @param amount - amount to transfer
   */
  async deposit(password: string, amount: number | string): Promise<void> {
    return this._deposit(password, amount, 1);
  }

  private async _deposit(
    password: string,
    amount: number | string,
    attemptCount: number = 1
  ): Promise<void> {
    const wallet = this.getWallet(this.currentAccount.username!, password);
    if (wallet.address !== this.currentAccount.walletAddress) {
      throw new ApiError(400, {
        status: 'error',
        message: 'Incorrect password',
        errorCode: 0
      });
    }
    try {
      await this.client.rest.post('/v3/account/token/deposit', {
        walletAddress: wallet.address,
        amount: parseEther(amount.toString()).toString(),
        provider: 'base'
      });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.payload.errorCode === ErrorCode.INSUFFICIENT_ALLOWANCE) {
          // If this is the first attempt, we need to approve the token usage,
          // otherwise we can retry the deposit directly.
          if (attemptCount === 1) {
            await this.approveTokenUsage(password, 'account');
          }
          if (attemptCount >= MAX_DEPOSIT_ATTEMPTS) {
            throw error;
          }
          await delay(10000); // Wait for the approval transaction to be processed
          await this._deposit(password, amount, attemptCount + 1);
          return;
        }
        throw error;
      }
      throw error;
    }
  }

  /**
   * Approve SOGNI token usage for the specified spender.
   * @internal
   *
   * @param password - user account password
   * @param spender - Spender type, either 'account' for deposit or 'staker' for staking contract
   * @param provider - Provider name, defaults to 'base', can be 'base', 'etherlink', etc.
   */
  async approveTokenUsage(
    password: string,
    spender: 'account' | 'staker',
    provider: string = 'base'
  ): Promise<void> {
    const wallet = this.getWallet(this.currentAccount.username!, password);
    const permitR = await this.client.rest.post<{ data: Record<string, any> }>(
      '/v1/contract/token/approve/permit',
      {
        walletAddress: wallet.address,
        spender: spender,
        provider: provider
      }
    );
    const { domain, types, message } = permitR.data;
    const signature = await wallet.signTypedData(domain, types, message);
    await this.client.rest.post('/v1/contract/token/approve', {
      walletAddress: wallet.address,
      spender: spender,
      provider: provider,
      deadline: message.deadline,
      approveSignature: signature
    });
  }
}

export default AccountApi;
