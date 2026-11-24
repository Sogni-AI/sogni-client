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
 * that received it costs nothing: a debit the server had already started is
 * cancelled, and the balance can take a moment to show it. (`not_found` is never
 * a refusal: see
 * {@link PayAsYouGoUnknownReason}.)
 */
export type PayAsYouGoRefusalReason =
  | 'not_eligible'
  | 'started'
  | 'no_idle_worker'
  | 'concurrency_limit'
  | 'insufficient_premium_spark'
  | 'insufficient_funds'
  | 'payment_failed'
  | 'staff_only'
  | 'unavailable'
  /**
   * Set by the SDK, never by the server: this request never left the client,
   * so it charged nothing. It says nothing about an earlier request; ask again
   * once connected.
   */
  | 'not_sent';

/**
 * Why the outcome of a switch request is not known.
 * - `timeout`: no reply arrived in time.
 * - `not_found`: the server no longer has this project waiting, for example because
 *   it already finished. An earlier request (or the re-send after a reconnect) may
 *   have switched and charged it before it finished, so this proves nothing about
 *   payment.
 * - `session_changed`: the account session ended while the request was pending.
 * - `unrecognized_reply`: the server replied with a status this SDK does not know.
 */
export type PayAsYouGoUnknownReason =
  | 'timeout'
  | 'not_found'
  | 'session_changed'
  | 'unrecognized_reply';

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

/** The server refused the switch; this request costs nothing (see {@link PayAsYouGoRefusalReason}). */
export interface PayAsYouGoRefused extends PayAsYouGoSwitchResultBase {
  status: 'refused';
  /** Unknown future reasons arrive as 'not_eligible'. */
  reason: PayAsYouGoRefusalReason;
}

/**
 * The payment state is unknown: the server may or may not have switched and
 * charged the project. Treat the payment as possibly made. Asking again with
 * `switchToPremiumSpark` is safe and never charges twice: it answers `switched`
 * if the earlier request switched, a refusal from the server if nothing was
 * charged (a `not_sent` refusal means the new request never reached the server
 * and says nothing about the earlier one), or
 * `unknown` again (including `not_found` once the creation has finished). While
 * it stays unknown, check the member's Spark history or the creation's result
 * rather than assuming either way.
 */
export interface PayAsYouGoUnknown extends PayAsYouGoSwitchResultBase {
  status: 'unknown';
  reason: PayAsYouGoUnknownReason;
}

export type PayAsYouGoSwitchResult = PayAsYouGoSwitched | PayAsYouGoRefused | PayAsYouGoUnknown;

const REFUSAL_REASONS = new Set<PayAsYouGoRefusalReason>([
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
 * Refusals that end the offer for good, so the SDK clears it at once. Every other
 * outcome leaves the offer to the server's next `projectQueue` update.
 * @internal
 */
export const PAY_AS_YOU_GO_REFUSALS_CLEARING_OFFER: ReadonlySet<PayAsYouGoRefusalReason> = new Set([
  'started',
  'not_eligible'
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
  // not_found can follow a request that did switch (its reply went to a dropped
  // socket and the project then finished), so it never proves nothing was charged.
  if (value.status === 'refused' && value.reason === 'not_found')
    return { projectId, status: 'unknown', reason: 'not_found', ...extra };
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
