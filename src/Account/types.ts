import { TokenType } from '../types/token.js';
import type { BillingMode } from '../Projects/types/index.js';

export type TransactionPaymentModel =
  | 'subscription'
  | 'paid_spark'
  | 'free_spark'
  | 'sogni'
  | string;

export interface Nonce {
  nonce: string;
}

export interface AccountCreateParams {
  username: string;
  email: string;
  password: string;
  subscribe: boolean;
  turnstileToken: string;
  referralCode?: string;
  /**
   * Optional client app/source label for signup attribution. Defaults to the
   * SogniClient connection appSource when configured.
   */
  appSource?: string;
}

/** Identity provider for Sign in with Google / Sign in with Apple. */
export type SsoProvider = 'google' | 'apple';

/**
 * How a session or account authenticates. `password` sessions have full
 * capabilities; `sso-*` sessions are capability-restricted (no withdrawals,
 * approvals, email changes, or other operations requiring a user wallet
 * signature).
 */
export type AuthMethod = 'password' | 'sso-google' | 'sso-apple';

export interface SsoSignupParams {
  provider: SsoProvider;
  /** The identity provider's ID token (Google `credential` / Apple `id_token`). */
  idToken: string;
  /** Sogni username to create, 4-20 characters. Validate with {@link AccountApi.validateUsername} first. */
  username: string;
  subscribe?: boolean;
  referralCode?: string;
  /**
   * Optional client app/source label for signup attribution. Defaults to the
   * SogniClient connection appSource when configured.
   */
  appSource?: string;
}

export interface SsoSignupData {
  token: string;
  refreshToken: string;
  username: string;
}

export interface SsoLinkData {
  provider: SsoProvider;
  authMethods: AuthMethod[];
}

/**
 * API `errorCode` values the SSO flows return. See the FE integration guide
 * for the full decision table (notably: 105 at `/sso/login` → offer signup
 * reusing the SAME id token; 186 → the email belongs to an existing password
 * account, route the user to password login + one-time SSO enable).
 */
export const SSO_ERROR_CODES = {
  /** Signup: identity already registered (use ssoLogin). Link: already enabled, or identity owned by another account. */
  ACCOUNT_ALREADY_EXISTS: 104,
  /** Login: no account for this identity — offer signup with the same id token. */
  ACCOUNT_DOESNT_EXIST: 105,
  /** Signup: email in use (non-linkable case). */
  EMAIL_ALREADY_EXISTS: 141,
  /** Operation not available to SSO-authenticated sessions. */
  SSO_RESTRICTED: 184,
  /** The identity provider token was rejected — restart provider sign-in. */
  INVALID_IDP_TOKEN: 185,
  /** Email belongs to an existing password account — sign in with password, then enable SSO. */
  SSO_LINK_REQUIRED: 186,
  /** SSO sign-in disabled because the account email changed — use the password. */
  SSO_EMAIL_CHANGED: 187,
  /** Link rejected: provider email does not match the account email (includes Apple "Hide My Email"). */
  SSO_LINK_EMAIL_MISMATCH: 188
} as const;

export type SsoErrorCode = (typeof SSO_ERROR_CODES)[keyof typeof SSO_ERROR_CODES];

export interface AccountCreateData {
  token: string;
  refreshToken: string;
}

export interface LoginData {
  token: string;
  refreshToken: string;
  username: string;
}

export interface MeData {
  currentEmail: string;
  discord2FA: boolean;
  discordLinked: boolean;
  discordServerMember: boolean;
  discordUsername: string;
  emailVerified: boolean;
  requestedUpdatedEmail: string;
  username: string;
  walletAddress: string;
  /**
   * How THIS session authenticated. Capability gates key off the session, so
   * UI must be gated on this value: when it starts with `sso-`, hide
   * withdrawals, approvals, email editing, and any operation requiring a user
   * wallet signature. Absent on older API servers — treat as `password`.
   */
  auth?: AuthMethod;
  /**
   * All sign-in methods available on the account (e.g. `['password']`,
   * `['sso-google']`, or `['password', 'sso-apple']` for a linked account).
   * Use for the settings "sign-in methods" card. Absent on older API servers.
   */
  authMethods?: AuthMethod[];
}

export interface BalanceData {
  settled: string;
  credit: string;
  debit: string;
  net: string;
  /**
   * Unclaimed worker earnings amount
   * @experimental Socket messages do not provide this field yet, so it may not be available in all cases.
   */
  relaxedUnclaimed?: string;
  /**
   * Unclaimed worker earnings amount
   * @experimental Socket messages do not provide this field yet, so it may not be available in all cases.
   */
  fastUnclaimed?: string;
}

export interface SparkBalanceData extends BalanceData {
  premiumCredit: string;
}

export interface Balances {
  sogni: BalanceData;
  spark: SparkBalanceData;
}

export interface FullBalances {
  sogni: Required<BalanceData>;
  spark: Required<SparkBalanceData>;
}

export interface TxHistoryParams {
  status: 'completed';
  address: string;
  limit: number;
  provider?: string;
  offset?: number;
}

export interface TxHistoryData {
  transactions: TxRaw[];
  next: number;
}

export interface TxRaw {
  _id: string;
  id: string;
  SID: number;
  address: string;
  createTime: number;
  updateTime: number;
  status: 'completed';
  role: 'artist' | 'worker';
  clientSID: number;
  addressSID: number;
  amount: number;
  description: string;
  source: 'project' | string;
  sourceSID: string;
  endTime: number;
  type: 'debit' | string;
  tokenType: TokenType;
  billingMode?: BillingMode;
  paymentModel?: TransactionPaymentModel;
  subscriptionTier?: string | null;
  subscriptionTrialing?: boolean;
  subscriptionThrottled?: boolean;
}

export interface TxHistoryEntry {
  id: string;
  address: string;
  createTime: Date;
  updateTime: Date;
  status: 'completed';
  role: 'artist' | 'worker';
  amount: number;
  tokenType: TokenType;
  description: string;
  source: 'project' | string;
  endTime: Date;
  type: 'debit' | string;
  billingMode?: BillingMode;
  paymentModel?: TransactionPaymentModel;
  subscriptionTier?: string | null;
  subscriptionTrialing?: boolean;
  subscriptionThrottled?: boolean;
}

export type RewardType = 'instant' | 'conditioned';

/**
 * Why a reward cannot be claimed right now.
 *
 * - `already_claimed` — claimed for the current period; try again next period.
 * - `requires_verification` — the account is not yet verified for this reward.
 * - `over_free_cap` — the account is not eligible for more free Spark
 *   right now.
 *
 * Treat any non-null value as "not claimable" and render `reward.description`
 * or your own copy for the specific value you recognise: new values may be
 * added, and an unrecognised one must not present as claimable.
 */
export type RewardCantClaimReason = 'already_claimed' | 'requires_verification' | 'over_free_cap';

export interface RewardRaw {
  id: string;
  type: RewardType;
  title: string;
  description: string;
  amount: string;
  tokenType: TokenType;
  claimed: number;
  canClaim: number;
  cantClaimReason?: RewardCantClaimReason | null;
  lastClaimTimestamp: number;
  claimResetFrequencySec: number;
}

export interface RewardsQuery {
  provider?: string;
}

export interface Reward {
  id: string;
  type: RewardType;
  title: string;
  description: string;
  amount: string;
  tokenType: TokenType;
  claimed: boolean;
  canClaim: boolean;
  cantClaimReason?: RewardCantClaimReason | null;
  lastClaim: Date;
  nextClaim: Date | null;
  provider?: string;
}

export interface ClaimOptions {
  turnstileToken?: string;
  provider?: string;
}
