import { SubscriptionPlanId } from '../Account/subscription.types.js';

interface ErrorData {
  code: number;
  originalCode?: string;
  message: string;
  /**
   * Discriminator set to `true` when this render-path error is a subscription
   * FEATURE-gate denial (socket error code 4081). The four fields below are
   * present only when this is `true`. Apps can branch on it (or use
   * `isSubscriptionLimitError`) to show an upgrade prompt instead of a generic
   * error toast.
   */
  subscriptionLimit?: boolean;
  /**
   * Plans that would satisfy the gated feature, cheapest-first. ALWAYS an
   * array when present, e.g. `['unlimited_pro']`.
   */
  requiredPlans?: SubscriptionPlanId[];
  /**
   * Stable machine key for the gated capability, e.g. `'video_4k_render'`.
   * Branch on this — never parse {@link ErrorData.limitation} prose.
   */
  feature?: string;
  /**
   * Standalone, user-facing English describing the limitation, suitable for a
   * toast, e.g. `'4K video render requires Unlimited Pro'`.
   */
  limitation?: string;
}

/**
 * Socket error codes returned when a job explicitly submitted with
 * `billingMode: 'subscription'` cannot be covered by the subscription, plus
 * the FEATURE-gate denial that applies regardless of billing mode.
 *
 * - `NOT_ENTITLED` (4078): no active subscription entitlement covers the job.
 * - `QUEUE_CAP` (4079): the subscription's concurrent job queue cap was
 *   reached.
 * - `GRACE_RETRY` (4080): the subscription is in its billing-grace window —
 *   the provider is retrying the renewal payment and unlimited access is
 *   paused until it succeeds. Offer a "pay with Spark/SOGNI" fallback instead
 *   of auto-retrying the subscription job in a loop; it will keep failing
 *   until the renewal succeeds.
 * - `SUBSCRIPTION_FEATURE_REQUIRES_UPGRADE` (4081): the request targets a
 *   feature that the user's current plan does not include (e.g. true-4K video
 *   render). The error additionally carries `subscriptionLimit`/`requiredPlans`
 *   /`feature`/`limitation`; offer an upgrade to one of `requiredPlans`.
 */
export const SUBSCRIPTION_ERROR_CODES = {
  NOT_ENTITLED: 4078,
  QUEUE_CAP: 4079,
  GRACE_RETRY: 4080,
  SUBSCRIPTION_FEATURE_REQUIRES_UPGRADE: 4081
} as const;

/**
 * Union of the subscription-billing socket error codes carried by
 * {@link SUBSCRIPTION_ERROR_CODES}.
 */
export type SubscriptionErrorCode =
  (typeof SUBSCRIPTION_ERROR_CODES)[keyof typeof SUBSCRIPTION_ERROR_CODES];

export default ErrorData;
