/**
 * Subscription-related types for the Sogni SDK.
 *
 * These types mirror the public subscription API exposed by `sogni-api` under
 * `/v1/subscriptions/*` and `/v1/iap/stripe/subscribe`.
 */

/**
 * Lifecycle state returned by `GET /v1/subscriptions/status`.
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
export type SubscriptionRedirectType = 'web' | 'app' | 'dashboard' | 'photobooth';

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
  /** Payment provider, present when returned by the server. */
  provider?: 'stripe' | 'apple' | 'google' | string;
  /** ISO timestamp for the current period start, when returned by the server. */
  currentPeriodStart?: string;
  /** ISO timestamp for the current or effective entitlement period end. */
  currentPeriodEnd?: string;
  /** When `true`, the subscription remains entitled until `currentPeriodEnd`. */
  cancelAtPeriodEnd?: boolean;
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
