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

/**
 * Why the server refused a switch to Premium Spark. A refusal means the request
 * that received it charged nothing.
 */
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
  | 'unavailable';

/**
 * Why the outcome of a switch request is not known.
 * - `timeout`: no reply arrived in time.
 * - `session_changed`: the account session ended while the request was pending.
 * - `unrecognized_reply`: the server replied with a status this SDK does not know.
 */
export type PayAsYouGoUnknownReason = 'timeout' | 'session_changed' | 'unrecognized_reply';

interface PayAsYouGoSwitchResultBase {
  projectId: string;
  /** Plain text from the server or the SDK; apps usually show their own wording. */
  message?: string;
  /** The project's Premium Spark price, a decimal string, when the reply carries it. */
  costInSpark?: string;
}

/** The project now runs on Premium Spark and its price was charged once. */
export interface PayAsYouGoSwitched extends PayAsYouGoSwitchResultBase {
  status: 'switched';
  paymentModel: 'paid_spark';
}

/** The server refused the switch; this request charged nothing. */
export interface PayAsYouGoRefused extends PayAsYouGoSwitchResultBase {
  status: 'refused';
  /** Unknown future reasons arrive as 'not_eligible'. */
  reason: PayAsYouGoRefusalReason;
}

/**
 * The payment state is unknown: the server may or may not have switched the
 * project. Asking again with `switchToPremiumSpark` is safe. It answers
 * `switched` without a second charge when the earlier request went through, or
 * a refusal when it did not. A `not_found` refusal at that point means the
 * project already left the server's active list; the earlier request's outcome
 * then shows in the account's billing history.
 */
export interface PayAsYouGoUnknown extends PayAsYouGoSwitchResultBase {
  status: 'unknown';
  reason: PayAsYouGoUnknownReason;
}

export type PayAsYouGoSwitchResult = PayAsYouGoSwitched | PayAsYouGoRefused | PayAsYouGoUnknown;

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
  'unavailable'
]);

/**
 * Refusals after which the server keeps offering the switch: the offer stays,
 * so an app can offer a Spark purchase and ask again.
 * @internal
 */
export const PAY_AS_YOU_GO_REFUSALS_KEEPING_OFFER: ReadonlySet<PayAsYouGoRefusalReason> = new Set([
  'insufficient_premium_spark',
  'insufficient_funds'
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
  const extra: Pick<PayAsYouGoSwitchResultBase, 'message' | 'costInSpark'> = {};
  if (typeof value.message === 'string' && value.message.trim() && value.message.length <= 600)
    extra.message = value.message;
  if (isDecimalString(value.costInSpark)) extra.costInSpark = value.costInSpark;
  if (value.status === 'switched')
    return { projectId, status: 'switched', paymentModel: 'paid_spark', ...extra };
  if (value.status === 'refused')
    return {
      projectId,
      status: 'refused',
      reason: REFUSAL_REASONS.has(value.reason as PayAsYouGoRefusalReason)
        ? (value.reason as PayAsYouGoRefusalReason)
        : 'not_eligible',
      ...extra
    };
  return { projectId, status: 'unknown', reason: 'unrecognized_reply', ...extra };
}
