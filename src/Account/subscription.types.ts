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
 * Machine-readable reason for a trial-eligibility verdict. The server returns
 * a code on every response: `'eligible'` when a trial may be started, or one of
 * the deny codes explaining why it cannot. This is a closed set defined by the
 * server's `TrialReasonCode` union.
 */
export type TrialReasonCode =
  | 'eligible'
  | 'wallet_already_used'
  | 'strong_signal_match'
  | 'weak_combo'
  | 'admin_override_allow'
  | 'admin_override_deny'
  | 'abuse_prevention_disabled';

/**
 * Free-trial eligibility result returned by
 * `GET /v1/subscriptions/trial-eligibility`.
 */
export interface TrialEligibility {
  /** Whether the current account is eligible to start a free trial. */
  eligible: boolean;
  /**
   * Machine-readable reason for the verdict — ALWAYS present. When `eligible`
   * is `true` this is `'eligible'`; otherwise it is the deny reason (e.g.
   * `'wallet_already_used'`, `'strong_signal_match'`, `'weak_combo'`).
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
   * Whether to start a free trial when the account is eligible. Defaults to the
   * server's behavior when omitted. Pass `false` to explicitly subscribe now
   * with no trial even if the account is otherwise eligible — the value is sent
   * verbatim so the backend honors the "no trial" intent.
   */
  startTrial?: boolean;
  /**
   * Optional raw persistent device identifier used for trial anti-abuse
   * attribution. Forwarded to the server only when provided.
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
