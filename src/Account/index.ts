import {
  AccountCreateData,
  AccountCreateParams,
  Balances,
  ClaimOptions,
  FullBalances,
  LoginData,
  MeData,
  Nonce,
  Reward,
  RewardRaw,
  RewardsQuery,
  SsoLinkData,
  SsoProvider,
  SsoSignupData,
  SsoSignupParams,
  TxHistoryData,
  TxHistoryEntry,
  TxHistoryParams
} from './types.js';
import {
  CreateSubscriptionCheckoutOptions,
  SubscriptionCheckoutResult,
  SubscriptionEntitlementSnapshot,
  SubscriptionPlanId,
  SubscriptionPlansResponseData,
  SubscriptionPlan,
  SubscriptionPortalSession,
  SubscriptionStatus,
  SubscriptionStatusResponseData,
  SubscriptionTerm,
  SubscriptionUsage,
  SubscriptionUsageResponseData,
  TrialEligibility,
  TrialEligibilityResponseData
} from './subscription.types.js';
import ApiGroup, { ApiConfig } from '../ApiGroup.js';
import { parseEther, pbkdf2, toUtf8Bytes, Wallet } from 'ethers';
import { ApiError, ApiResponse } from '../ApiClient/index.js';
import CurrentAccount from './CurrentAccount.js';
import { SupernetType } from '../ApiClient/WebSocketClient/types.js';
import {
  AuthenticatedData,
  SocketSubscriptionEntitlementData
} from '../ApiClient/WebSocketClient/events.js';
import { delay } from '../lib/utils/index.js';
import {
  ApiKeyAuthManager,
  CookieAuthManager,
  TokenAuthManager
} from '../lib/AuthManager/index.js';

const MAX_DEPOSIT_ATTEMPTS = 4;
enum ErrorCode {
  INSUFFICIENT_BALANCE = 123,
  INSUFFICIENT_ALLOWANCE = 149
}

/**
 * Parse the numeric entitlement `version` that socket payloads carry as a
 * string (and that the REST status endpoint may add later). Returns `null`
 * for missing or non-numeric values so unversioned payloads remain
 * apply-able.
 */
function parseSubscriptionVersion(version: unknown): number | null {
  if (typeof version === 'number' && Number.isFinite(version)) {
    return version;
  }
  if (typeof version === 'string' && version.trim() !== '') {
    const parsed = Number(version);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}
/**
 * Account API methods that let you interact with the user's account.
 * Can be accessed via `sogni.account`. Look for more samples below.
 *
 * @example Retrieve the current account balance
 * ```typescript
 * const balance = await sogni.account.refreshBalance();
 * console.log(balance);
 * ```
 *
 */
class AccountApi extends ApiGroup {
  readonly currentAccount = new CurrentAccount();

  /**
   * Highest entitlement `version` applied to `currentAccount.subscription`.
   * Socket payloads carry a monotonically increasing version; writes that
   * carry an older version than the one already applied are discarded instead
   * of overwriting fresher data.
   */
  private lastAppliedSubscriptionVersion: number | null = null;

  /**
   * Logical clock counting applied socket entitlement writes. A REST refresh
   * captures this counter before its request goes on the wire; if it advanced
   * by the time the response arrives, a fresher socket push landed mid-flight
   * and the REST snapshot is discarded as stale.
   */
  private appliedSubscriptionSocketWrites = 0;

  constructor(config: ApiConfig) {
    super(config);
    this.currentAccount._update({
      networkStatus: this.client.socket.isConnected ? 'connected' : 'disconnected',
      network: this.client.socket.supernetType
    });
    this.client.socket.on('balanceUpdate', this.handleBalanceUpdate.bind(this));
    this.client.socket.on('changeNetwork', this.handleChangeNetwork.bind(this));
    this.client.socket.on('authenticated', this.handleSocketAuthenticated.bind(this));
    this.client.socket.on(
      'subscriptionEntitlementUpdated',
      this.handleSubscriptionEntitlementUpdated.bind(this)
    );
    this.client.on('connecting', this.handleServerConnecting.bind(this));
    this.client.on('connected', this.handleServerConnected.bind(this));
    this.client.on('disconnected', this.handleServerDisconnected.bind(this));
    this.client.auth.on('updated', this.handleAuthUpdated.bind(this));
  }

  private handleBalanceUpdate(data: Balances) {
    this.currentAccount._update({ balance: data });
  }

  private handleChangeNetwork({ network }: { network: SupernetType }) {
    this.currentAccount._update({ network, networkStatus: 'connected' });
  }

  private handleServerConnected({ network }: { network: SupernetType }) {
    this.currentAccount._update({
      networkStatus: 'connected',
      network
    });
  }

  private handleServerConnecting({ network }: { network: SupernetType }) {
    this.currentAccount._update({
      networkStatus: 'connecting',
      network
    });
  }

  private handleServerDisconnected() {
    this.currentAccount._update({
      networkStatus: 'disconnected',
      network: null
    });
  }

  private mapSocketSubscriptionEntitlement(
    data: SocketSubscriptionEntitlementData | undefined
  ): SubscriptionEntitlementSnapshot | undefined {
    if (!data) return undefined;
    const sub = data.subscription;
    if (!sub?.status) {
      return {
        active: false,
        status: 'none'
      };
    }

    // The producer status domain (socket payload `subscription.status`) is:
    // trialing | active | grace | cancelled | expired | revoked |
    // needs_reconciliation. Mirror the REST snapshot mapping: grace →
    // grace_period, revoked → canceled, needs_reconciliation → past_due, and
    // cancelled → cancel_at_period_end while the paid period still runs.
    const status: SubscriptionStatus =
      sub.status === 'grace'
        ? 'grace_period'
        : sub.status === 'cancelled'
          ? data.active
            ? 'cancel_at_period_end'
            : 'canceled'
          : sub.status === 'revoked'
            ? 'canceled'
            : sub.status === 'needs_reconciliation'
              ? 'past_due'
              : sub.status === 'expired'
                ? 'expired'
                : sub.status === 'trialing'
                  ? 'trialing'
                  : sub.status === 'active'
                    ? 'active'
                    : data.active
                      ? 'active'
                      : 'none';

    // During grace the date that matters is when the provider stops retrying
    // the renewal payment. Mirror REST semantics by projecting `graceEnd`
    // into `currentPeriodEnd`, falling back to `periodEnd` for older sockets
    // that do not populate it.
    const effectivePeriodEnd =
      status === 'grace_period' && sub.graceEnd ? sub.graceEnd : sub.periodEnd;

    // Newer sockets carry an explicit cancelAtPeriodEnd flag; older sockets
    // only imply it through the 'cancelled' producer status.
    const cancelAtPeriodEnd =
      typeof sub.cancelAtPeriodEnd === 'boolean'
        ? sub.cancelAtPeriodEnd
        : sub.status === 'cancelled'
          ? true
          : undefined;

    return {
      active: data.active,
      status,
      ...(sub.tier ? { tier: sub.tier } : {}),
      ...(sub.term ? { term: sub.term } : {}),
      ...(sub.provider ? { provider: sub.provider } : {}),
      ...(sub.periodStart ? { currentPeriodStart: new Date(sub.periodStart).toISOString() } : {}),
      ...(effectivePeriodEnd
        ? { currentPeriodEnd: new Date(effectivePeriodEnd).toISOString() }
        : {}),
      ...(cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd } : {}),
      ...(sub.scheduledTier ? { scheduledTier: sub.scheduledTier } : {}),
      ...(sub.scheduledTerm ? { scheduledTerm: sub.scheduledTerm } : {}),
      ...(sub.scheduledChangeAt
        ? { scheduledChangeAt: new Date(sub.scheduledChangeAt).toISOString() }
        : {}),
      ...(sub.paymentPending ? { paymentPending: true } : {}),
      ...(sub.fairUse?.limited && Number(sub.fairUse.resetAt) > Date.now()
        ? {
            fairUse: {
              ...sub.fairUse,
              resetAt: new Date(sub.fairUse.resetAt).toISOString()
            }
          }
        : {}),
      capabilities:
        sub.capabilities ??
        (data.active && (sub.tier === 'unlimited' || sub.tier === 'unlimited_pro')
          ? { unlimited: true }
          : {})
    };
  }

  /**
   * Single chokepoint through which every subscription entitlement writer
   * (REST refresh, socket entitlement push, socket authenticated seeding)
   * must route.
   *
   * Guards against last-writer-wins races between the two transports: writes
   * carrying an older `version` than the one already applied are discarded,
   * and an unversioned REST snapshot whose request started before a socket
   * push was applied is discarded as stale. Snapshots deep-equal to the
   * current one are accepted without re-applying, so reconnect re-seeds and
   * tab replays do not emit redundant 'updated' events.
   *
   * @returns `true` when the snapshot was accepted (even if identical to the
   * current one), `false` when it was discarded as stale.
   */
  private applySubscriptionSnapshot(
    subscription: SubscriptionEntitlementSnapshot,
    source: 'rest' | 'socket',
    options: { version?: number | null; socketWritesAtRequestStart?: number } = {}
  ): boolean {
    const version = options.version ?? null;
    if (
      version !== null &&
      this.lastAppliedSubscriptionVersion !== null &&
      version < this.lastAppliedSubscriptionVersion
    ) {
      this.client.logger.debug(
        `[account] Discarding ${source} subscription snapshot: version ${version} is older ` +
          `than applied version ${this.lastAppliedSubscriptionVersion}`
      );
      return false;
    }
    if (
      source === 'rest' &&
      version === null &&
      options.socketWritesAtRequestStart !== undefined &&
      this.appliedSubscriptionSocketWrites !== options.socketWritesAtRequestStart
    ) {
      this.client.logger.debug(
        '[account] Discarding stale REST subscription snapshot: a socket entitlement push was ' +
          'applied while the request was in flight'
      );
      return false;
    }
    if (version !== null) {
      this.lastAppliedSubscriptionVersion = version;
    }
    if (source === 'socket') {
      this.appliedSubscriptionSocketWrites += 1;
    }
    const current = this.currentAccount.subscription;
    if (current && JSON.stringify(current) === JSON.stringify(subscription)) {
      return true;
    }
    this.currentAccount._update({ subscription });
    return true;
  }

  private handleSubscriptionEntitlementUpdated(data: SocketSubscriptionEntitlementData) {
    this.applyFreeSparkLocked(data.freeSparkLocked, data.freeSparkUnlockPath);
    const subscription = this.mapSocketSubscriptionEntitlement(data);
    if (subscription) {
      this.applySubscriptionSnapshot(subscription, 'socket', {
        version: parseSubscriptionVersion(data.subscription?.version)
      });
    }
  }

  /**
   * Mirror the server's free-Spark state onto the account. An absent value is
   * ignored so a payload that omits the field leaves current state unchanged
   * rather than clearing it.
   */
  private applyFreeSparkLocked(
    freeSparkLocked?: boolean,
    freeSparkUnlockPath?: 'trial' | 'purchase'
  ) {
    if (typeof freeSparkLocked !== 'boolean') return;
    if (
      this.currentAccount.freeSparkLocked === freeSparkLocked &&
      this.currentAccount.freeSparkUnlockPath === freeSparkUnlockPath
    ) {
      return;
    }
    this.currentAccount._update({ freeSparkLocked, freeSparkUnlockPath });
  }

  private handleSocketAuthenticated(data: AuthenticatedData) {
    // Populate account early from socket authenticated event (me() will overwrite with full data)
    this.applyFreeSparkLocked(data.freeSparkLocked, data.freeSparkUnlockPath);
    const subscription = this.mapSocketSubscriptionEntitlement(data.subscriptionEntitlement);
    if (this.client.auth instanceof ApiKeyAuthManager) {
      this.currentAccount._update({
        username: data.username,
        walletAddress: data.address
      });
    }
    if (subscription) {
      this.applySubscriptionSnapshot(subscription, 'socket', {
        version: parseSubscriptionVersion(data.subscriptionEntitlement?.subscription?.version)
      });
    } else {
      // The authenticated payload carried no entitlement snapshot (older
      // socket build or feature flag off). Schedule a best-effort REST
      // refresh so the cached snapshot cannot silently go stale across
      // reconnects; failures are swallowed because this is opportunistic.
      this.refreshSubscription().catch(() => undefined);
    }
  }

  private handleAuthUpdated(isAuthenticated: boolean) {
    if (!isAuthenticated) {
      // Reset the entitlement recency guard together with the account data so
      // the next login starts from a clean slate.
      this.lastAppliedSubscriptionVersion = null;
      this.appliedSubscriptionSocketWrites = 0;
      this.currentAccount._clear();
    } else {
      this.me();
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
   * const wallet = sogni.account.getWallet('username', 'password');
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
  async create(
    {
      username,
      email,
      password,
      subscribe,
      turnstileToken,
      referralCode,
      appSource
    }: AccountCreateParams,
    rememberMe = false
  ): Promise<AccountCreateData> {
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
    const resolvedAppSource = appSource?.trim() || this.client.appSource;
    const signature = await this.eip712.signTypedData(wallet, 'signup', { ...payload, nonce });
    const res = await this.client.rest.post<ApiResponse<AccountCreateData>>('/v1/account/create', {
      ...payload,
      ...(resolvedAppSource ? { appSource: resolvedAppSource } : {}),
      referralCode,
      signature,
      rememberMe
    });
    const auth = this.client.auth;
    if (auth instanceof TokenAuthManager) {
      await auth.authenticate({ refreshToken: res.data.refreshToken, token: res.data.token });
    } else if (auth instanceof CookieAuthManager) {
      await auth.authenticate();
    }
    return res.data;
  }

  /**
   * Login with username and password. WebSocket connection is established after successful login.
   *
   * @example Login with username and password
   * ```typescript
   * await sogni.account.login('username', 'password');
   * console.log('Logged in');
   * ```
   *
   * @param username
   * @param password
   * @param rememberMe - Whether to establish a long-lived session. Default is false. Only
   * applicable for cookie-based authentication.
   * @param appSource - Optional client app/source label for login attribution. Defaults to the
   * SogniClient connection appSource when configured.
   */
  async login(
    username: string,
    password: string,
    rememberMe = false,
    appSource?: string
  ): Promise<LoginData> {
    const wallet = this.getWallet(username, password);
    const nonce = await this.getNonce(wallet.address);
    const signature = await this.eip712.signTypedData(wallet, 'authentication', {
      walletAddress: wallet.address,
      nonce
    });
    const resolvedAppSource = appSource?.trim() || this.client.appSource;
    const res = await this.client.rest.post<ApiResponse<LoginData>>('/v1/account/login', {
      walletAddress: wallet.address,
      signature,
      ...(resolvedAppSource ? { appSource: resolvedAppSource } : {}),
      rememberMe
    });
    const auth = this.client.auth;
    if (auth instanceof TokenAuthManager) {
      await auth.authenticate({ refreshToken: res.data.refreshToken, token: res.data.token });
    } else if (auth instanceof CookieAuthManager) {
      await auth.authenticate();
    }
    return res.data;
  }

  /**
   * Login with a Google/Apple identity-provider ID token (Sign in with
   * Google / Sign in with Apple). The session is activated exactly like a
   * password login.
   *
   * Error handling (see `SSO_ERROR_CODES`): a 404 with errorCode 105 means no
   * account exists for this identity — offer signup and reuse the SAME
   * `idToken` with {@link ssoSignup}. A 409 with errorCode 186 means the
   * email belongs to an existing password account — the user should sign in
   * with their password and enable SSO from settings ({@link ssoLink}).
   *
   * Note: SSO sessions are capability-restricted (no withdrawals, approvals,
   * email changes, or other operations requiring a user wallet signature).
   *
   * @example Login with a Google credential
   * ```typescript
   * await sogni.account.ssoLogin('google', credential);
   * ```
   *
   * @param provider - `'google'` or `'apple'`
   * @param idToken - the identity provider's ID token (Google `credential` /
   * Apple `id_token`)
   * @param rememberMe - Whether to establish a long-lived session. Default is
   * false. Only applicable for cookie-based authentication.
   * @param appSource - Optional client app/source label for login attribution.
   * Defaults to the SogniClient connection appSource when configured.
   */
  async ssoLogin(
    provider: SsoProvider,
    idToken: string,
    rememberMe = false,
    appSource?: string
  ): Promise<LoginData> {
    const resolvedAppSource = appSource?.trim() || this.client.appSource;
    const res = await this.client.rest.post<ApiResponse<LoginData>>('/v1/account/sso/login', {
      provider,
      idToken,
      ...(resolvedAppSource ? { appSource: resolvedAppSource } : {}),
      rememberMe
    });
    const auth = this.client.auth;
    if (auth instanceof TokenAuthManager) {
      await auth.authenticate({ refreshToken: res.data.refreshToken, token: res.data.token });
    } else if (auth instanceof CookieAuthManager) {
      await auth.authenticate();
    }
    return res.data;
  }

  /**
   * Create a new account from a Google/Apple identity-provider ID token. The
   * account's email comes from the verified token (no email parameter, no
   * Turnstile); a username must still be chosen — validate it first with
   * {@link validateUsername}. Reuse the SAME `idToken` the preceding
   * {@link ssoLogin} attempt failed with (errorCode 105) — the token is only
   * consumed by a successful login/signup.
   *
   * @example Signup after a 105 login miss
   * ```typescript
   * await sogni.account.ssoSignup({ provider: 'google', idToken: credential, username: 'newuser' });
   * ```
   */
  async ssoSignup(params: SsoSignupParams, rememberMe = false): Promise<SsoSignupData> {
    const { provider, idToken, username, subscribe, referralCode, appSource } = params;
    const resolvedAppSource = appSource?.trim() || this.client.appSource;
    const res = await this.client.rest.post<ApiResponse<SsoSignupData>>('/v1/account/sso/signup', {
      appid: this.client.appId,
      provider,
      idToken,
      username,
      subscribe: subscribe ? 1 : 0,
      ...(resolvedAppSource ? { appSource: resolvedAppSource } : {}),
      referralCode,
      rememberMe
    });
    const auth = this.client.auth;
    if (auth instanceof TokenAuthManager) {
      await auth.authenticate({ refreshToken: res.data.refreshToken, token: res.data.token });
    } else if (auth instanceof CookieAuthManager) {
      await auth.authenticate();
    }
    return res.data;
  }

  /**
   * One-time enable of Google/Apple sign-in on the CURRENT password account.
   * Requires an authenticated password session (an SSO session gets a 403 with
   * errorCode 184). The identity provider's verified email must match the
   * account email — otherwise a 400 with errorCode 188 (this includes Apple
   * "Hide My Email" relay addresses, which can never match). One provider per
   * account, permanent — no unlink. The current session is unchanged; the new
   * sign-in method applies from the next login.
   *
   * @example Enable Google sign-in from settings
   * ```typescript
   * const { authMethods } = await sogni.account.ssoLink('google', credential);
   * ```
   */
  async ssoLink(provider: SsoProvider, idToken: string): Promise<SsoLinkData> {
    const res = await this.client.rest.post<ApiResponse<SsoLinkData>>('/v1/account/sso/link', {
      provider,
      idToken
    });
    this.currentAccount._update({ authMethods: res.data.authMethods });
    return res.data;
  }

  /**
   * Logout the user and close the WebSocket connection.
   *
   * @example Logout the user
   * ```typescript
   * await sogni.account.logout();
   * console.log('Logged out');
   * ```
   */
  async logout(): Promise<void> {
    try {
      await this.client.rest.post('/v1/account/logout');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.client.logger.warn('Failed to logout, probably already logged out');
      } else {
        throw e;
      }
    }
    this.client.auth.clear();
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
   * const balance = await sogni.account.refreshBalance();
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
   * const balance = await sogni.account.accountBalance();
   * console.log(balance);
   * ```
   */
  async accountBalance(): Promise<FullBalances> {
    const res = await this.client.rest.get<ApiResponse<FullBalances>>('/v4/account/balance');
    return res.data;
  }

  /**
   * Get the balance of the wallet address.
   *
   * This method is used to get the balance of the wallet address. It returns $SOGNI and ETH balance.
   *
   * @example Get the balance of the wallet address
   * ```typescript
   * const address = sogni.account.currentAccount.walletAddress;
   * const balance = await sogni.account.walletBalance(address);
   * console.log(balance);
   * // { token: '100.000000', ether: '0.000000' }
   * ```
   *
   * @param walletAddress
   * @param provider - blockchain provider, 'base' or 'etherlink' defaults to 'base'
   */
  async walletBalance(walletAddress: string, provider: 'base' | 'etherlink' = 'base') {
    const res = await this.client.rest.get<
      ApiResponse<{ sogni: string; spark: string; ether: string }>
    >('/v2/wallet/balance', {
      walletAddress,
      provider
    });
    return res.data;
  }

  async me() {
    const res = await this.client.rest.get<ApiResponse<MeData>>('/v1/account/me');
    this.currentAccount._update({
      username: res.data.username,
      email: res.data.currentEmail,
      walletAddress: res.data.walletAddress,
      // Session auth grade + available sign-in methods. Older API servers omit
      // them — default the grade to 'password' (matches server-side semantics
      // for legacy tokens) rather than leaving the FE gating blind.
      auth: res.data.auth ?? 'password',
      authMethods: res.data.authMethods
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
   * await sogni.account.switchNetwork('fast');
   * console.log('Switched to the fast network, now lets wait until we get list of models');
   * await sogni.projects.waitForModels();
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
   * const { entries, next } = await sogni.account.transactionHistory({
   *  status: 'completed',
   *  limit: 10,
   *  address: sogni.account.currentAccount.walletAddress
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
          type: tx.type,
          billingMode: tx.billingMode,
          paymentModel: tx.paymentModel,
          subscriptionTier: tx.subscriptionTier,
          subscriptionTrialing: tx.subscriptionTrialing,
          subscriptionThrottled: tx.subscriptionThrottled
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
        cantClaimReason: raw.cantClaimReason ?? null,
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
   * await sogni.account.withdraw('your-account-password', 100, 'etherlink');
   * ```
   *
   * @param password - account password
   * @param amount - amount of tokens to withdraw from account to wallet
   * @param provider - blockchain provider, 'base' or 'etherlink' defaults to 'base'
   */
  async withdraw(
    password: string,
    amount: number | string,
    provider: string = 'base'
  ): Promise<void> {
    const wallet = this.getWallet(this.currentAccount.username!, password);
    const walletAddress = wallet.address;
    //const nonce = await this.getNonce(walletAddress);
    const payload = {
      walletAddress,
      amount: parseEther(amount.toString()).toString(),
      provider
    };
    if (walletAddress !== this.currentAccount.walletAddress) {
      throw new ApiError(400, {
        status: 'error',
        message: 'Incorrect password',
        errorCode: 0
      });
    }
    const permitR = await this.client.rest.post<{ data: Record<string, any> }>(
      '/v1/account/token/withdraw/permit',
      payload
    );
    const { domain, types, message } = permitR.data;
    const signature = await wallet.signTypedData(domain, types, message);
    await this.client.rest.post('/v2/account/token/withdraw', {
      ...payload,
      signature
    });
  }

  /**
   * Deposit tokens from wallet to account
   * @example withdraw to current wallet address
   * ```typescript
   * await sogni.account.deposit('your-account-password', 100, 'base');
   * ```
   *
   * @param password - account password
   * @param amount - amount to transfer
   * @param provider - blockchain provider, 'base' or 'etherlink' defaults to 'base'
   */
  async deposit(
    password: string,
    amount: number | string,
    provider: string = 'base'
  ): Promise<void> {
    return this._deposit(password, amount, provider, 1);
  }

  private async _deposit(
    password: string,
    amount: number | string,
    provider: string = 'base',
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
        provider: provider
      });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.payload.errorCode === ErrorCode.INSUFFICIENT_ALLOWANCE) {
          // If this is the first attempt, we need to approve the token usage,
          // otherwise we can retry the deposit directly.
          if (attemptCount === 1) {
            await this.approveTokenUsage(password, 'account', provider);
          }
          if (attemptCount >= MAX_DEPOSIT_ATTEMPTS) {
            throw error;
          }
          await delay(10000); // Wait for the approval transaction to be processed
          await this._deposit(password, amount, provider, attemptCount + 1);
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

  // Subscription

  /**
   * Fetch the current user's subscription entitlement snapshot.
   *
   * Returns an object describing whether the account has an effective
   * subscription entitlement, the tier, period boundaries, usage, limits, and
   * enabled capabilities. When no subscription exists, `active` is `false` and
   * `status` is `'none'`.
   *
   * Also updates `currentAccount.subscription` so callers can read the
   * snapshot from the observable entity without re-fetching.
   *
   * @example
   * ```typescript
   * const snap = await sogni.account.getSubscriptionStatus();
   * if (snap.active) {
   *   console.log('Plan:', snap.tier, 'until', snap.currentPeriodEnd);
   * }
   * ```
   */
  async getSubscriptionStatus(): Promise<SubscriptionEntitlementSnapshot> {
    // Capture the socket write clock before the request goes out so a socket
    // push that lands mid-flight marks this response as stale.
    const socketWritesAtRequestStart = this.appliedSubscriptionSocketWrites;
    const res = await this.client.rest.get<ApiResponse<SubscriptionStatusResponseData>>(
      '/v1/subscriptions/status'
    );
    const subscription = res.data.subscription;
    const applied = this.applySubscriptionSnapshot(subscription, 'rest', {
      // The REST snapshot does not carry a version today; prefer version
      // comparison over the in-flight heuristic as soon as the API adds one.
      version: parseSubscriptionVersion(
        (subscription as SubscriptionEntitlementSnapshot & { version?: unknown }).version
      ),
      socketWritesAtRequestStart
    });
    if (!applied && this.currentAccount.subscription) {
      // A fresher socket push was applied while this request was in flight.
      // Return the fresher cached snapshot so callers stay consistent with
      // currentAccount.subscription.
      return this.currentAccount.subscription;
    }
    return subscription;
  }

  /**
   * Fetch the current user's usage for the active billing cycle.
   *
   * Returns the render/job counters for the subscriber's current billing cycle
   * (not a calendar month). While the entitlement is `'trialing'`, the response
   * also carries `trialEndsAt`, `trialCreditsLimit`, and `trialCreditsUsed` so
   * you can render "X of N trial credits used" messaging; those fields are
   * omitted for non-trial subscriptions.
   *
   * Note: these trial usage fields come from this endpoint, NOT from
   * {@link getSubscriptionStatus} — the entitlement snapshot never carries
   * trial usage.
   *
   * @example
   * ```typescript
   * const usage = await sogni.account.getSubscriptionUsage();
   * if (usage.trialCreditsLimit !== undefined) {
   *   console.log(`${usage.trialCreditsUsed} of ${usage.trialCreditsLimit} trial credits used`);
   * }
   * ```
   */
  async getSubscriptionUsage(): Promise<SubscriptionUsage> {
    const res =
      await this.client.rest.get<ApiResponse<SubscriptionUsageResponseData>>(
        '/v1/subscriptions/usage'
      );
    return res.data.usage;
  }

  /**
   * Check whether the current account is eligible to start a free trial.
   *
   * Returns `{ eligible, reasonCode }`. Use `eligible` as the decision and
   * treat `reasonCode` as an opaque display hint.
   *
   * @example
   * ```typescript
   * const { eligible, reasonCode } = await sogni.account.getTrialEligibility();
   * if (eligible) {
   *   const { url } = await sogni.account.createSubscriptionCheckout('unlimited', 'monthly', {
   *     startTrial: true
   *   });
   * }
   * ```
   */
  async getTrialEligibility(): Promise<TrialEligibility> {
    const res = await this.client.rest.get<ApiResponse<TrialEligibilityResponseData>>(
      '/v1/subscriptions/trial-eligibility'
    );
    return { eligible: res.data.eligible, reasonCode: res.data.reasonCode };
  }

  /**
   * Associate an opaque host-application identifier with the current account.
   * Requires an authenticated session.
   *
   * @param deviceId - Opaque host-application identifier.
   *
   * @example
   * ```typescript
   * await sogni.account.setDeviceId(myPersistentDeviceId);
   * ```
   */
  async setDeviceId(deviceId: string): Promise<void> {
    await this.client.rest.post('/v1/account/device-id', { deviceId });
  }

  /**
   * Fetch the list of available subscription plans.
   *
   * This is a public endpoint; no authentication is required.
   *
   * @example
   * ```typescript
   * const plans = await sogni.account.getSubscriptionPlans();
   * plans.forEach(p => console.log(p.displayName, p.priceUsd));
   * ```
   */
  async getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    const res =
      await this.client.rest.get<ApiResponse<SubscriptionPlansResponseData>>(
        '/v1/subscriptions/plans'
      );
    return res.data.plans;
  }

  /**
   * Create a Stripe checkout session to subscribe to a plan.
   *
   * Returns a `url` to which the user should be redirected to complete payment.
   * After a successful checkout Stripe will redirect back to your configured
   * return URL and the subscription entitlement will become active.
   *
   * Trial granting is server-authoritative. `options.startTrial` is a deprecated
   * compatibility field and cannot override the server's eligibility decision.
   * Prefer omitting it.
   * Host applications may pass `options.deviceId` when their integration
   * requires the corresponding server-side context.
   *
   * @param planId - The plan identifier from {@link getSubscriptionPlans}
   * @param term   - Billing cadence: `'monthly'` or `'annual'`
   * @param options - Optional checkout metadata, redirect target, and trial controls.
   *
   * @example
   * ```typescript
   * const { url } = await sogni.account.createSubscriptionCheckout('unlimited', 'monthly');
   * window.location.href = url;
   * ```
   */
  async createSubscriptionCheckout(
    planId: SubscriptionPlanId,
    term: SubscriptionTerm,
    options: CreateSubscriptionCheckoutOptions = {}
  ): Promise<SubscriptionCheckoutResult> {
    const res = await this.client.rest.post<ApiResponse<SubscriptionCheckoutResult>>(
      '/v1/iap/stripe/subscribe',
      {
        planId,
        term,
        redirectType: options.redirectType ?? 'web',
        ...(options.appSource ? { appSource: options.appSource } : {}),
        ...(options.startTrial !== undefined ? { startTrial: options.startTrial } : {}),
        ...(options.deviceId !== undefined ? { deviceId: options.deviceId } : {})
      }
    );
    return res.data;
  }

  /**
   * Create a Stripe customer portal session for managing an existing subscription.
   *
   * Returns a `url` to which the user should be redirected. The portal lets
   * them update payment methods, cancel, or view invoices.
   *
   * @example
   * ```typescript
   * const { url } = await sogni.account.createSubscriptionPortalSession();
   * window.location.href = url;
   * ```
   */
  async createSubscriptionPortalSession(): Promise<SubscriptionPortalSession> {
    const res = await this.client.rest.post<ApiResponse<SubscriptionPortalSession>>(
      '/v1/subscriptions/stripe/portal',
      {}
    );
    return res.data;
  }

  /**
   * Refresh the cached subscription entitlement on `currentAccount`.
   *
   * Convenience wrapper around {@link getSubscriptionStatus} that makes the
   * intent ("I want to pull fresh entitlement data into the observable
   * account entity") explicit at the call site.
   *
   * @example
   * ```typescript
   * await sogni.account.refreshSubscription();
   * console.log(sogni.account.currentAccount.isUnlimited);
   * ```
   */
  async refreshSubscription(): Promise<SubscriptionEntitlementSnapshot> {
    return this.getSubscriptionStatus();
  }
}

export default AccountApi;
