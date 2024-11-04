export interface Nonce {
  nonce: string;
}

export interface AccountCreateData {
  token: string;
}

export interface LoginData {
  token: string;
  username: string;
}

export interface GetBalanceData {
  settled: string;
  credit: string;
  debit: string;
  net: string;
}
