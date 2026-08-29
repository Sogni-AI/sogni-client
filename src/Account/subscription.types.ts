/**
 * Subscription-related types for the Sogni SDK.
 *
 * These types mirror the public subscription API exposed by `sogni-api` under
 * `/v1/subscriptions/*` and `/v1/iap/stripe/subscribe`.
 */

/**
 * Lifecycle state returned by `GET /v1/subscriptions/status`.
 *
 * `'grace_period'` never grants entitlement: `active` is `false` during grace.
 * Grace means the billing provider (Apple billing grace, Google Play grace,
 * Stripe retries) keeps retrying the renewal payment until the grace window
 * ends; unlimited access is paused while the retry is in progress and resumes
 * automatically once the renewal succeeds. Renders can still be paid with
 * Spark/SOGNI in the meantime. During grace, `currentPeriodEnd` reflects when
 * the payment-retry window ends — not paid-through access.
 *
 * Canceling during a free trial ends Unlimited access immediately by default:
 * the server cuts the entitlement projection right away instead of letting the
 * trial run to its end date. A regular cancel-at-period-end keeps access until
 * `currentPeriodEnd`. Always rely on `active` for the entitlement decision
 * rather than the status string.
 */
export type SubscriptionStatus =
  | 'none'
  | 'trialing'
  | 'active'
  | 'grace_period'
  | 'past_due'
  | 'paused'
  | 'cancel_at_period_end'
  | 'canceled'
  | 'expired'
  | 'refunded';

/**
 * Plan/tier identifiers accepted by the subscription checkout endpoint.
 */
export type SubscriptionPlanId = 'unlimited' | 'unlimited_pro';

/**
 * Billing term selector accepted by the subscription checkout endpoint.
 */
export type SubscriptionTerm = 'monthly' | 'annual';

/** Actionable monthly fair-use state returned only while Fast limits are active. */
export interface SubscriptionFairUseState {
  limited: true;
  /** Subscription-funded Spark used in the current monthly fair-use window. */
  usageSpark: number;
  /** Retail-equivalent USD value of the subscription-funded usage. */
  usageUsd: number;
  /** Monthly reference price for the current tier. */
  planPriceUsd: number;
  /** ISO timestamp for the subscriber-anchored monthly reset. */
  resetAt: string;
  fastConcurrencyLimit: 1;
  fastQueueLimit: 1;
  relaxedUnrestricted: true;
  /** True for Unlimited, whose next tier is Unlimited Pro. */
  upgradeAvailable: boolean;
}

/**
 * Stripe recurring interval implied by the billing term.
 */
export type SubscriptionPlanInterval = 'month' | 'year';

/**
 * Checkout redirect target. The server uses this to choose the post-checkout
 * return URL.
 */
export type SubscriptionRedirectType = 'web' | 'app' | 'dashboard' | 'photobooth' | 'chat';

/**
 * Current subscription entitlement snapshot returned by
 * `GET /v1/subscriptions/status`.
 *
 * When the user has no effective subscription, `active` is `false` and
 * `status` is `'none'`.
 */
export interface SubscriptionEntitlementSnapshot {
  /** Whether the wallet currently has an effective entitlement. */
  active: boolean;
  /** Rich status string for display and entitlement state. */
  status: SubscriptionStatus;
  /** Plan/tier identifier, present when an entitlement exists. */
  tier?: SubscriptionPlanId | string;
  /**
   * Billing term (`'monthly'` / `'annual'`) for the effective entitlement,
   * present when an entitlement exists. Provider-agnostic — returned for
   * Stripe, Apple, and Google subscriptions alike.
   */
  term?: SubscriptionTerm | string;
  /**
   * Payment provider, present when returned by the server. `'manual'` denotes
   * an administratively granted subscription.
   */
  provider?: 'stripe' | 'apple' | 'google' | 'manual' | string;
  /** ISO timestamp for the current period start, when returned by the server. */
  currentPeriodStart?: string;
  /** ISO timestamp for the current or effective entitlement period end. */
  currentPeriodEnd?: string;
  /** When `true`, the subscription remains entitled until `currentPeriodEnd`. */
  cancelAtPeriodEnd?: boolean;
  /**
   * Tier the subscription will switch to at the next renewal when a downgrade
   * or plan change is scheduled. Absent when no change is pending; the current
   * `tier` keeps its benefits until `scheduledChangeAt`.
   */
  scheduledTier?: SubscriptionPlanId | string;
  /**
   * Billing term (`'monthly'` / `'annual'`) the subscription will switch to at
   * the next renewal when a term change (e.g. annual → monthly) is scheduled.
   * Absent when no change is pending.
   */
  scheduledTerm?: SubscriptionTerm | string;
  /**
   * ISO timestamp when the scheduled plan/term change takes effect (the next
   * renewal date). Absent when no change is pending.
   */
  scheduledChangeAt?: string;
  /** Feature flags or capability names enabled by this subscription. */
  capabilities?: Record<string, boolean>;
  /**
   * True when a Google Play deferred payment (e.g. QRIS) is awaiting
   * confirmation and there is no active entitlement yet. Display-only. Carried
   * by the REST status snapshot; absent on older servers. Pairs with `active`:
   * consumers should show a pending hint only while `paymentPending && !active`.
   */
  paymentPending?: boolean;
  /** Present only while the monthly Fast-network fair-use limits are active. */
  fairUse?: SubscriptionFairUseState;
  /**
   * Frontier vendor-model discount (basis points) this member currently
   * receives on the artist-facing price of premium third-party vendor models
   * (`gpt-image-2`, `seedance-2-0`, `seedance-2-0-mini`, `seedance-2-0-fast`,
   * `seedance-2-5`, `happyhorse-1.1-*`, `wan3.0-video`,
   * `wan3.0-spicy-video`). Present only when the
   * entitlement is active (the discount applies); absent otherwise. The
   * authoritative charge is enforced server-side; this drives UI display. For
   * example `500` = 5% (Unlimited), `1000` = 10% (Unlimited Pro).
   */
  frontierDiscountBps?: number;
}

/**
 * Current-period usage returned by `GET /v1/subscriptions/usage`.
 *
 * The render/job counters are scoped to the subscriber's current billing
 * cycle (not a calendar month). The `trial*` fields are present only while the
 * entitlement is `'trialing'` and drive "X of N trial credits used" messaging;
 * they are omitted entirely for non-trial subscriptions.
 */
export interface SubscriptionUsage {
  /** Render spark consumed in the current billing cycle. */
  periodRenderSpark: number;
  /** Number of paid jobs run in the current billing cycle. */
  periodJobs: number;
  /**
   * ISO timestamp when the free trial ends. Present only while the entitlement
   * is `'trialing'`.
   */
  trialEndsAt?: string;
  /**
   * Total number of render credits granted for the free trial. Present only
   * while the entitlement is `'trialing'`.
   */
  trialCreditsLimit?: number;
  /**
   * Number of trial render credits consumed so far. Present only while the
   * entitlement is `'trialing'`.
   */
  trialCreditsUsed?: number;
}

/**
 * Client-facing trial-eligibility reason. Consumers should use `eligible` as
 * the decision and treat this value as an opaque display hint. The open string
 * arm preserves compatibility with older and non-production servers.
 */
export type TrialReasonCode = 'eligible' | 'not_eligible' | (string & {});

/**
 * Free-trial eligibility result returned by
 * `GET /v1/subscriptions/trial-eligibility`.
 */
export interface TrialEligibility {
  /** Whether the current account is eligible to start a free trial. */
  eligible: boolean;
  /**
   * Opaque client-facing hint. Do not use it as an authorization decision.
   */
  reasonCode: TrialReasonCode;
}

/**
 * Public subscription plan returned by `GET /v1/subscriptions/plans`.
 *
 * Stripe price identifiers are intentionally not exposed by the public API.
 */
export interface SubscriptionPlan {
  /** Plan/tier identifier passed to checkout. */
  planId: SubscriptionPlanId;
  /** Alias of `planId`, included for display and filtering. */
  tier: SubscriptionPlanId;
  /** Billing cadence for this plan entry. */
  term: SubscriptionTerm;
  /** Stripe recurring interval implied by `term`. */
  interval: SubscriptionPlanInterval;
  /** Display-only list price in whole USD. */
  priceUsd: number;
  /** Human-readable label supplied by the server. */
  displayName: string;
  /**
   * Google Play product configuration for this `(tier, term)`, present only
   * when a Play subscription product is configured server-side. The
   * `productId` is the public Play SKU a Trusted Web Activity / Android client
   * passes to the Digital Goods API to start a Play Billing purchase. Absent
   * for plans with no Play product (e.g. on web-only deployments). There is no
   * Stripe/Apple analog: Stripe price ids are intentionally not exposed, and
   * Apple SKUs are supplied by StoreKit rather than this catalog.
   */
  google?: { productId: string };
  /**
   * Frontier vendor-model discount for this tier, in basis points, applied to
   * the artist-facing price of premium third-party vendor models
   * (`gpt-image-2`, `seedance-2-0`, `seedance-2-0-mini`, `seedance-2-0-fast`,
   * `seedance-2-5`, `happyhorse-1.1-*`, `wan3.0-video`,
   * `wan3.0-spicy-video`) while the member is
   * subscribed. Drives member-benefit display and non-member upsell copy so
   * consumers render the rate without hardcoding it (`500` = 5%, `1000` = 10%).
   * The discount itself is enforced server-side at the cost layer.
   */
  vendorDiscountBps: number;
}

/**
 * Options for `AccountApi.createSubscriptionCheckout`.
 */
export interface CreateSubscriptionCheckoutOptions {
  /**
   * Post-checkout redirect target. Defaults to `'web'`.
   */
  redirectType?: SubscriptionRedirectType;
  /**
   * Optional client app/source label stored in Stripe metadata.
   */
  appSource?: string;
  /**
   * Deprecated compatibility field. The server decides whether a checkout
   * receives a free trial, and this field cannot override that eligibility
   * decision. Prefer omitting it.
   */
  startTrial?: boolean;
  /**
   * Optional opaque host-application context forwarded only when provided.
   */
  deviceId?: string;
}

/**
 * Result returned by `AccountApi.createSubscriptionCheckout`.
 */
export interface SubscriptionCheckoutResult {
  /** Optional server message describing the checkout session. */
  message?: string;
  /** Stripe Checkout URL to open in the user's browser. */
  url: string;
}

/**
 * Result returned by `AccountApi.createSubscriptionPortalSession`.
 */
export interface SubscriptionPortalSession {
  /** Stripe Billing Portal URL to open in the user's browser. */
  url: string;
}

/** @internal */
export interface SubscriptionStatusResponseData {
  subscription: SubscriptionEntitlementSnapshot;
}

/** @internal */
export interface SubscriptionPlansResponseData {
  plans: SubscriptionPlan[];
}

/** @internal */
export interface TrialEligibilityResponseData {
  eligible: boolean;
  reasonCode: TrialReasonCode;
}

/** @internal */
export interface SubscriptionUsageResponseData {
  usage: SubscriptionUsage;
}
