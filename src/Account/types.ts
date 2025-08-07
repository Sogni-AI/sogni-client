import { TokenType } from '../types/token';

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

export interface BalanceData {
  settled: string;
  credit: string;
  debit: string;
  net: string;
  /**
   * Unclaimed worker earnings amount
   * @experimental Socket messages do not provide this field yet, so it may not be available in all cases.
   */
  unclaimed?: string;
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
}

export type RewardType = 'instant' | 'conditioned';

export interface RewardRaw {
  id: string;
  type: RewardType;
  title: string;
  description: string;
  amount: string;
  tokenType: TokenType;
  claimed: number;
  canClaim: number;
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
  lastClaim: Date;
  nextClaim: Date | null;
  provider?: string;
}

export interface ClaimOptions {
  turnstileToken?: string;
  provider?: string;
}
