import DataEntity from '../lib/DataEntity';
import { BalanceData } from './types';
import { jwtDecode } from 'jwt-decode';
import { SupernetType } from '../ApiClient/WebSocketClient/types';
/**
 * @inline
 */
export interface AccountData {
  token: string | null;
  /**
   * Current network status:\
   * - `connected` - connected to the socket
   * - `disconnected` - disconnected from the socket
   * - `connecting` - connecting to the socket
   * - `switching` - switching network type (fast/relaxed)
   * @enum
   * @values 'connected', 'disconnected', 'connecting', 'switching'
   * @default 'disconnected'
   */
  networkStatus: 'connected' | 'disconnected' | 'connecting' | 'switching';
  network: SupernetType | null;
  balance: BalanceData;
  walletAddress?: string;
  expiresAt?: Date;
  username?: string;
}

function getDefaults(): AccountData {
  return {
    token: null,
    networkStatus: 'disconnected',
    network: null,
    balance: {
      credit: '0',
      debit: '0',
      net: '0',
      settled: '0'
    }
  };
}

function decodeToken(token: string) {
  const data = jwtDecode<{ addr: string; env: string; iat: number; exp: number }>(token);
  return {
    walletAddress: data.addr,
    expiresAt: new Date(data.exp * 1000)
  };
}

/**
 * Current account data.
 * @expand
 */
class CurrentAccount extends DataEntity<AccountData> {
  constructor(data?: AccountData) {
    super(data || getDefaults());
  }

  _update<K extends keyof AccountData>(delta: Partial<AccountData>) {
    this.data = { ...this.data, ...(delta as Partial<AccountData>) };
    const keys = Object.keys(delta);
    if (delta.hasOwnProperty('token')) {
      if (delta.token) {
        Object.assign(this.data, decodeToken(delta.token));
      } else {
        delete this.data.walletAddress;
        delete this.data.expiresAt;
      }
      keys.push('walletAddress', 'expiresAt');
    }
    this.emit('updated', keys);
  }

  _clear() {
    this._update(getDefaults());
  }

  get isAuthenicated() {
    return !!this.data.token && !!this.data.expiresAt && this.data.expiresAt > new Date();
  }

  get networkStatus() {
    return this.data.networkStatus;
  }

  get network() {
    return this.data.network;
  }

  get balance() {
    return this.data.balance;
  }

  get walletAddress() {
    return this.data.walletAddress;
  }

  get expiresAt() {
    return this.data.expiresAt;
  }

  get username() {
    return this.data.username;
  }

  get token() {
    return this.data.token;
  }
}

export default CurrentAccount;
