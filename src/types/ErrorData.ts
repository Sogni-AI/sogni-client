interface ErrorData {
  code: number;
  originalCode?: string;
  message: string;
}

/**
 * Socket error codes returned when a job explicitly submitted with
 * `billingMode: 'subscription'` cannot be covered by the subscription.
 *
 * - `NOT_ENTITLED` (4078): no active subscription entitlement covers the job.
 * - `QUEUE_CAP` (4079): the subscription's concurrent job queue cap was
 *   reached.
 * - `GRACE_RETRY` (4080): the subscription is in its billing-grace window —
 *   the provider is retrying the renewal payment and unlimited access is
 *   paused until it succeeds. Offer a "pay with Spark/SOGNI" fallback instead
 *   of auto-retrying the subscription job in a loop; it will keep failing
 *   until the renewal succeeds.
 */
export const SUBSCRIPTION_ERROR_CODES = {
  NOT_ENTITLED: 4078,
  QUEUE_CAP: 4079,
  GRACE_RETRY: 4080
} as const;

/**
 * Union of the subscription-billing socket error codes carried by
 * {@link SUBSCRIPTION_ERROR_CODES}.
 */
export type SubscriptionErrorCode =
  (typeof SUBSCRIPTION_ERROR_CODES)[keyof typeof SUBSCRIPTION_ERROR_CODES];

export default ErrorData;
