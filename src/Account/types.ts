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
}

export interface TxHistoryParams {
  status: 'completed';
  address: string;
  limit: number;
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
}

export interface TxHistoryEntry {
  id: string;
  address: string;
  createTime: Date;
  updateTime: Date;
  status: 'completed';
  role: 'artist' | 'worker';
  amount: number;
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
  claimed: number;
  canClaim: number;
  lastClaimTimestamp: number;
  claimResetFrequencySec: number;
}

export interface Reward {
  id: string;
  type: RewardType;
  title: string;
  description: string;
  amount: string;
  claimed: boolean;
  canClaim: boolean;
  lastClaim: Date;
  nextClaim: Date | null;
}
