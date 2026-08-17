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
   * `undefined` until the account receives a socket entitlement snapshot or
   * {@link AccountApi.getSubscriptionStatus} / {@link AccountApi.refreshSubscription}
   * has been called.
   *
   * Subscribe to the `'updated'` event (inherited from `DataEntity`) to react
   * to changes; the `changedKeys` array will include `'subscription'` when
   * this field is refreshed.
   */
  subscription?: SubscriptionEntitlementSnapshot;
  /**
   * `true` while this account cannot spend free Spark. Paid balances are
   * unaffected — Premium Spark, SOGNI, and any live subscription keep working
   * while this is `true`.
   *
   * Server-authoritative and pushed on the socket, so it updates live.
   * `undefined` until the socket authenticates. Read
   * {@link AccountData.freeSparkUnlockPath} for the call to action to present.
   *
   * Subscribe to the `'updated'` event to react to changes; `changedKeys` will
   * include `'freeSparkLocked'`.
   */
  freeSparkLocked?: boolean;
  /**
   * Which call to action to present while {@link AccountData.freeSparkLocked}
   * is `true`.
   *
   * - `'trial'` — offer the free Unlimited trial.
   * - `'purchase'` — offer a Premium Spark purchase.
   * - `undefined` — not locked, or the server sent no path.
   *
   * The server chooses the path. Present the one it sends rather than
   * substituting another.
   */
  freeSparkUnlockPath?: 'trial' | 'purchase';
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
    subscription: undefined,
    freeSparkLocked: undefined,
    freeSparkUnlockPath: undefined
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
   * `undefined` until the account receives a socket entitlement snapshot or
   * {@link AccountApi.getSubscriptionStatus} / {@link AccountApi.refreshSubscription}
   * has been called.
   */
  get subscription(): SubscriptionEntitlementSnapshot | undefined {
    return this.data.subscription;
  }

  /**
   * `true` while this account cannot spend free Spark. See
   * {@link AccountData.freeSparkLocked}.
   */
  get freeSparkLocked(): boolean | undefined {
    return this.data.freeSparkLocked;
  }

  /**
   * Which call to action to present to a locked account. See
   * {@link AccountData.freeSparkUnlockPath}.
   */
  get freeSparkUnlockPath(): 'trial' | 'purchase' | undefined {
    return this.data.freeSparkUnlockPath;
  }

  /**
   * Convenience getter - `true` when the account has an effective
   * subscription entitlement on any Unlimited tier (`"unlimited"` or
   * `"unlimited_pro"`).
   *
   * Returns `false` when no entitlement snapshot has been fetched yet, when
   * the server reports no active entitlement, or when the tier is not an
   * Unlimited tier. Call {@link AccountApi.refreshSubscription} to force a REST
   * refresh when no socket entitlement snapshot has been received yet.
   */
  get isUnlimited(): boolean {
    const sub = this.data.subscription;
    if (!sub || !sub.active) return false;
    return sub.tier === 'unlimited' || sub.tier === 'unlimited_pro';
  }
}

export default CurrentAccount;
