import DataEntity from '../lib/DataEntity';
import { Balances } from './types';
import { SupernetType } from '../ApiClient/WebSocketClient/types';
/**
 * @inline
 */
export interface AccountData {
  /**
   * Current network status:
   * - `connected` - connected to the socket
   * - `disconnected` - disconnected from the socket
   * - `connecting` - connecting to the socket
   * - `switching` - switching network type (fast/relaxed)
   *
   * @default 'disconnected'
   */
  networkStatus: 'connected' | 'disconnected' | 'connecting' | 'switching';
  network: SupernetType | null;
  balance: Balances;
  walletAddress?: string;
  username?: string;
  email?: string;
}

function getDefaults(): AccountData {
  return {
    networkStatus: 'disconnected',
    network: null,
    balance: {
      sogni: {
        credit: '0',
        debit: '0',
        net: '0',
        settled: '0'
      },
      spark: {
        credit: '0',
        debit: '0',
        net: '0',
        settled: '0',
        premiumCredit: '0'
      }
    },
    walletAddress: undefined,
    username: undefined
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

  _clear() {
    this._update(getDefaults());
  }

  get isAuthenicated() {
    return !!this.data.walletAddress;
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

  get username() {
    return this.data.username;
  }

  get email() {
    return this.data.email;
  }
}

export default CurrentAccount;
