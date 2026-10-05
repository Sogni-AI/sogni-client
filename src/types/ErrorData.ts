import { SubscriptionPlanId } from '../Account/subscription.types.js';

interface ErrorData {
  code: number;
  originalCode?: string;
  message: string;
  /**
   * Coarse server-reported cause of an external generation failure. Known
   * values include `content_policy`, `input_validation`, `timeout`,
   * `result_storage`, `cancelled`, `vendor_failed`, `asset_resolution`, and
   * `vendor_transient`. Servers may add categories; handle unknown strings
   * with a generic failure message.
   */
  vendorFailureCategory?: string;
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
  /**
   * Present when a model refused the job because the account has not accepted
   * that model's one-time agreement (socket error code 4103,
   * {@link MODEL_CONSENT_REQUIRED_ERROR_CODE}). Names the agreement so apps can
   * open it; use `isModelConsentRequiredError` to branch on it.
   */
  consentRequired?: ModelConsentRequirement;
}

/**
 * The agreement a model requires before it renders, carried by a
 * {@link MODEL_CONSENT_REQUIRED_ERROR_CODE} (4103) job error.
 */
export interface ModelConsentRequirement {
  /** Stable agreement key, e.g. `'seedance-2-5-uncensored'`. */
  key: string;
  /** Agreement version the account must accept. */
  version: number;
  /** Model the refused job asked for, e.g. `'seedance-2-5-uncensored'`. */
  modelId?: string;
}

/**
 * Socket error code for a job refused because its model requires a one-time
 * likeness and consent agreement the account has not accepted. Seedance 2.5
 * Uncensored (`seedance-2-5-uncensored`) is the model that requires one.
 *
 * The error carries {@link ErrorData.consentRequired}. The agreement is
 * accepted in a Sogni app; the SDK never accepts it and API-key sessions
 * cannot. Until it is accepted every job for the model fails the same way, so
 * do not retry: show the server's message, which tells the user to accept it
 * in the Sogni app. Price estimates are not gated.
 */
export const MODEL_CONSENT_REQUIRED_ERROR_CODE = 4103;

/**
 * Socket error code for a job or price estimate refused because its model is
 * not yet available on this network (for example a model released to staging
 * but held in production). The error's `message` is the socket's wording,
 * which names models to try instead; show it as is. Not retryable: the model
 * stays refused until the server makes it available.
 */
export const MODEL_NOT_YET_AVAILABLE_ERROR_CODE = 4104;

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
