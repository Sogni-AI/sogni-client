/**
 * An Unlimited plan project that has waited a while, at a moment when a card
 * outside the plan's worker pool could start it now, can be run on Premium Spark
 * instead, at its normal price. Present only while that is true; absent on older
 * servers. Nothing is charged until the owner calls
 * {@link ProjectsApi.switchToPremiumSpark}.
 */
export interface PayAsYouGoOffer {
  available: true;
  /** The project's normal Premium Spark price, a decimal string. */
  costInSpark: string;
  /**
   * The account's Premium Spark and Spark balance currently cover the price.
   * Advisory: the server decides when the switch is requested. When false, offer
   * a Spark purchase first.
   */
  coveredByPremiumSpark: boolean;
}

/** Why a switch to Premium Spark did not happen. Nothing is charged for any of them. */
export type PayAsYouGoRefusalReason =
  | 'not_found'
  | 'not_eligible'
  | 'started'
  | 'no_idle_worker'
  | 'concurrency_limit'
  | 'insufficient_premium_spark'
  | 'insufficient_funds'
  | 'payment_failed'
  | 'staff_only'
  | 'unavailable'
  | 'timeout';

export interface PayAsYouGoSwitchResult {
  projectId: string;
  status: 'switched' | 'refused';
  /** Present when refused. Unknown future reasons arrive as 'not_eligible'. */
  reason?: PayAsYouGoRefusalReason;
  /** Plain text from the server; apps usually show their own wording per reason. */
  message?: string;
  costInSpark?: string;
  paymentModel?: 'paid_spark';
}

const REFUSAL_REASONS = new Set<PayAsYouGoRefusalReason>([
  'not_found',
  'not_eligible',
  'started',
  'no_idle_worker',
  'concurrency_limit',
  'insufficient_premium_spark',
  'insufficient_funds',
  'payment_failed',
  'staff_only',
  'unavailable',
  'timeout'
]);

const isDecimalString = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && /^\d+(\.\d+)?$/.test(value);

/** @internal */
export function normalizePayAsYouGoOffer(raw: unknown): PayAsYouGoOffer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.available !== true || !isDecimalString(value.costInSpark)) return null;
  return {
    available: true,
    costInSpark: value.costInSpark,
    coveredByPremiumSpark: value.coveredByPremiumSpark === true
  };
}

/** @internal */
export function normalizePayAsYouGoSwitchResult(
  projectId: string,
  raw: unknown
): PayAsYouGoSwitchResult {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const result: PayAsYouGoSwitchResult = {
    projectId,
    status: value.status === 'switched' ? 'switched' : 'refused'
  };
  if (result.status === 'switched') result.paymentModel = 'paid_spark';
  else
    result.reason = REFUSAL_REASONS.has(value.reason as PayAsYouGoRefusalReason)
      ? (value.reason as PayAsYouGoRefusalReason)
      : 'not_eligible';
  if (typeof value.message === 'string' && value.message.trim() && value.message.length <= 600)
    result.message = value.message;
  if (isDecimalString(value.costInSpark)) result.costInSpark = value.costInSpark;
  return result;
}
