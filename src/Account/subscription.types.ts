/**
 * Subscription-related types for the Sogni SDK.
 *
 * These types mirror the server-side subscription surface exposed under
 * `/v1/subscriptions/*` and `/v1/iap/stripe/*`. They are intentionally
 * additive — the existing token-based balance and `tokenType` APIs are
 * unchanged.
 */

/**
 * How the current account session is billed:
 * - `'auto'`         — no explicit mode; server picks based on context
 * - `'tokens'`       — usage charged against the SOGNI/Spark token balance
 * - `'subscription'` — usage covered by an active subscription entitlement
 */
export type BillingMode = 'auto' | 'tokens' | 'subscription';

/**
 * Lifecycle state of a subscription. Mirrors the server-side status enum.
 */
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

/**
 * Billing term — monthly or annual.
 */
export type SubscriptionTerm = 'monthly' | 'annual';

/**
 * Current subscription entitlement snapshot returned by
 * `GET /v1/subscriptions/status`.
 *
 * When the user has no active subscription, `active` will be `false` and
 * most other fields will be absent.
 */
export interface SubscriptionEntitlementSnapshot {
  /** Whether there is a currently active (or trialing) entitlement. */
  active: boolean;
  /** Lifecycle status of the subscription. Present when a subscription record exists. */
  status?: SubscriptionStatus;
  /** Internal plan identifier (e.g. `"unlimited_monthly"`). */
  planId?: string;
  /** Human-readable tier name (e.g. `"unlimited"`). */
  tier?: string;
  /** Payment provider (e.g. `"stripe"`, `"apple"`, `"google"`). */
  provider?: string;
  /** Unix timestamp (seconds) for the start of the current billing period. */
  currentPeriodStart?: number;
  /** Unix timestamp (seconds) for the end of the current billing period. */
  currentPeriodEnd?: number;
  /** When `true` the subscription will not auto-renew and will cancel at period end. */
  cancelAtPeriodEnd?: boolean;
  /** Per-period usage counters, if returned by the server. */
  usage?: SubscriptionUsage;
  /** Usage limits associated with the current plan, if returned by the server. */
  limits?: SubscriptionLimits;
  /**
   * Feature flags or capability names enabled by this subscription.
   * The exact set of strings is server-defined and may grow over time.
   */
  capabilities?: string[];
}

/**
 * Per-period usage counters returned by `GET /v1/subscriptions/usage`.
 *
 * All counts reflect the current billing period unless noted otherwise.
 */
export interface SubscriptionUsage {
  /** Number of image-generation jobs run in the current period. */
  imagesGenerated?: number;
  /** Number of video-generation jobs run in the current period. */
  videosGenerated?: number;
  /** Number of LLM chat tokens consumed in the current period. */
  tokensUsed?: number;
  /** Server-defined usage period start (Unix seconds). */
  periodStart?: number;
  /** Server-defined usage period end (Unix seconds). */
  periodEnd?: number;
}

/**
 * Plan-level limits associated with a subscription tier.
 */
export interface SubscriptionLimits {
  /** Maximum images per billing period, or `null` for unlimited. */
  imagesPerPeriod?: number | null;
  /** Maximum videos per billing period, or `null` for unlimited. */
  videosPerPeriod?: number | null;
  /** Maximum LLM tokens per billing period, or `null` for unlimited. */
  tokensPerPeriod?: number | null;
}

/**
 * A single purchasable subscription plan returned by
 * `GET /v1/subscriptions/plans`.
 */
export interface SubscriptionPlan {
  /** Server-assigned plan identifier passed to checkout. */
  planId: string;
  /** Human-readable plan name (e.g. `"Unlimited Monthly"`). */
  name: string;
  /** Billing cadence for this plan variant. */
  term: SubscriptionTerm;
  /** ISO 4217 currency code for `price` (e.g. `"usd"`). */
  currency: string;
  /**
   * Price in the smallest currency unit (e.g. cents for USD).
   * Use `displayPrice` when showing to users.
   */
  price: number;
  /** Human-readable formatted price string supplied by the server (e.g. `"$9.99/mo"`). */
  displayPrice?: string;
  /** Tier name this plan belongs to (e.g. `"unlimited"`). */
  tier?: string;
  /** Whether a free trial is available when subscribing via this plan. */
  trialAvailable?: boolean;
  /** Length of the free trial in days, if applicable. */
  trialDays?: number;
  /** Feature bullets or descriptions included with this plan. */
  features?: string[];
}
