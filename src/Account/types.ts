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
