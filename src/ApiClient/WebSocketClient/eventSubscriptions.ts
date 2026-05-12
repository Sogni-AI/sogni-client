import type { SocketEventName } from './events';

export type SocketEventSubscriptionGroup = 'modelAvailability';

export type SocketEventSubscriptionName =
  | SocketEventName
  | SocketEventSubscriptionGroup
  | (string & {});

export type SocketEventSubscriptions = Partial<
  Record<SocketEventName | SocketEventSubscriptionGroup, boolean>
> &
  Record<string, boolean | undefined>;

export interface SocketEventSubscriptionUpdate {
  /**
   * Replace or merge explicit event subscription flags.
   */
  subscriptions?: SocketEventSubscriptions;
  /**
   * Subscribe to one or more socket events or event groups.
   */
  subscribe?: SocketEventSubscriptionName | SocketEventSubscriptionName[];
  /**
   * Unsubscribe from one or more socket events or event groups.
   */
  unsubscribe?: SocketEventSubscriptionName | SocketEventSubscriptionName[];
  /**
   * Clear existing server-side subscription overrides before applying this update.
   */
  reset?: boolean;
  /**
   * Single-event update shorthand.
   */
  event?: SocketEventSubscriptionName;
  /**
   * Boolean value for the single-event update shorthand.
   */
  enabled?: boolean;
}

export type SocketEventSubscriptionInput = SocketEventSubscriptions | SocketEventSubscriptionUpdate;

const UPDATE_KEYS = new Set([
  'subscriptions',
  'subscribe',
  'unsubscribe',
  'reset',
  'event',
  'enabled'
]);

function hasUpdateShape(input: Record<string, unknown>): boolean {
  return Object.keys(input).some((key) => UPDATE_KEYS.has(key));
}

function normalizeSubscriptions(
  subscriptions?: SocketEventSubscriptions
): SocketEventSubscriptions | undefined {
  if (!subscriptions || typeof subscriptions !== 'object') {
    return undefined;
  }

  const normalized: SocketEventSubscriptions = {};
  for (const [eventName, enabled] of Object.entries(subscriptions)) {
    if (typeof enabled === 'boolean') {
      normalized[eventName] = enabled;
    }
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

export function normalizeSocketEventSubscriptionUpdate(
  input: SocketEventSubscriptionInput
): SocketEventSubscriptionUpdate {
  const raw = input && typeof input === 'object' ? input : {};
  const update = hasUpdateShape(raw as Record<string, unknown>)
    ? (raw as SocketEventSubscriptionUpdate)
    : { subscriptions: raw as SocketEventSubscriptions };

  return {
    ...update,
    subscriptions: normalizeSubscriptions(update.subscriptions)
  };
}

export function serializeSocketEventSubscriptions(
  subscriptions?: SocketEventSubscriptions
): string | undefined {
  const normalized = normalizeSubscriptions(subscriptions);
  return normalized ? JSON.stringify(normalized) : undefined;
}
