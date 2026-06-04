import DataEntity from '../lib/DataEntity.js';
import { Balances } from './types.js';
import { SubscriptionEntitlementSnapshot } from './subscription.types.js';
import { SupernetType } from '../ApiClient/WebSocketClient/types.js';
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
  /**
   * The most recently fetched subscription entitlement snapshot.
   * `undefined` until {@link AccountApi.getSubscriptionStatus} or
   * {@link AccountApi.refreshSubscription} has been called.
   *
   * Subscribe to the `'updated'` event (inherited from `DataEntity`) to react
   * to changes — the `changedKeys` array will include `'subscription'` when
   * this field is refreshed.
   */
  subscription?: SubscriptionEntitlementSnapshot;
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
    username: undefined,
    subscription: undefined
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

  /**
   * The most recently cached subscription entitlement snapshot.
   * `undefined` until {@link AccountApi.getSubscriptionStatus} or
   * {@link AccountApi.refreshSubscription} has been called.
   */
  get subscription(): SubscriptionEntitlementSnapshot | undefined {
    return this.data.subscription;
  }

  /**
   * Convenience getter — `true` when the account has an active or trialing
   * subscription with the `"unlimited"` tier.
   *
   * Returns `false` when no entitlement snapshot has been fetched yet or when
   * the subscription is not active/trialing. Call
   * {@link AccountApi.refreshSubscription} to populate the snapshot first.
   */
  get isUnlimited(): boolean {
    const sub = this.data.subscription;
    if (!sub || !sub.active) return false;
    const liveStatus = sub.status === 'active' || sub.status === 'trialing';
    return liveStatus && sub.tier === 'unlimited';
  }
}

export default CurrentAccount;
