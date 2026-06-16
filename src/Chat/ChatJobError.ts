import { SUBSCRIPTION_ERROR_CODES, SubscriptionErrorCode } from '../types/ErrorData.js';
import { SubscriptionPlanId } from '../Account/subscription.types.js';

/** Structured fields preserved from a failed chat/LLM job. */
export interface ChatJobErrorFields {
  /**
   * Server error code exactly as sent on the wire (a string, e.g. `'4080'`).
   * Currently attached by the socket server to `subscription_unavailable`
   * denials — see `SUBSCRIPTION_ERROR_CODES`.
   */
  code?: string;
  /**
   * Machine-readable error type tag from the server, e.g.
   * `'subscription_unavailable'`, `'insufficient_balance'`,
   * `'model_unavailable'`, `'invalid_request'`.
   */
  errorType?: string;
  /** Chat job id the failure belongs to, when known (socket transport). */
  jobID?: string;
  /** HTTP status when the failure came from a REST chat endpoint. */
  status?: number;
  /** Raw error payload as received from the server (socket message or REST body). */
  payload?: unknown;
  /** `true` when this failure is a subscription FEATURE-gate denial (4081). */
  subscriptionLimit?: boolean;
  /** Plans that would satisfy the gated feature, cheapest-first. */
  requiredPlans?: SubscriptionPlanId[];
  /** Stable machine key for the gated capability, e.g. `'video_4k_render'`. */
  feature?: string;
  /** Standalone user-facing English describing the limitation. */
  limitation?: string;
}

/** Fields extracted from a recognized REST/socket chat error body. @internal */
export interface ExtractedChatJobErrorFields {
  code?: string;
  errorType?: string;
  message?: string;
  subscriptionLimit?: boolean;
  requiredPlans?: SubscriptionPlanId[];
  feature?: string;
  limitation?: string;
}

/**
 * Error thrown/streamed when a chat/LLM job fails, preserving the server's
 * error contract so apps can branch on machine-readable fields instead of
 * string-matching `.message`.
 *
 * `message` stays the human-readable server message (unchanged from the
 * plain `Error` this class replaces). `code`/`errorCode` carry the wire
 * error code when present — for jobs submitted with
 * `billingMode: 'subscription'`, the subscription denial codes from
 * `SUBSCRIPTION_ERROR_CODES` (`'4078'` not entitled, `'4080'` billing-grace
 * renewal retry). `errorType` carries the server's error tag, e.g.
 * `'subscription_unavailable'`.
 *
 * ```typescript
 * try {
 *   for await (const chunk of stream) { ... }
 * } catch (err) {
 *   if (err instanceof ChatJobError && err.errorType === 'subscription_unavailable') {
 *     // offer a "pay with Spark/SOGNI" fallback instead of retrying
 *   }
 * }
 * ```
 */
export class ChatJobError extends Error {
  /** Server error code as a string (e.g. `'4080'`), when the failure carries one. */
  readonly code?: string;
  /** Alias of {@link ChatJobError.code} for consumers that branch on `errorCode`. */
  readonly errorCode?: string;
  /** Server error type tag (e.g. `'subscription_unavailable'`), when present. */
  readonly errorType?: string;
  /** Chat job id the failure belongs to, when known. */
  readonly jobID?: string;
  /** HTTP status when the failure came from a REST chat endpoint. */
  readonly status?: number;
  /** Raw error payload as received from the server. */
  readonly payload?: unknown;
  /** `true` when this failure is a subscription FEATURE-gate denial (4081). */
  readonly subscriptionLimit?: boolean;
  /** Plans that would satisfy the gated feature, cheapest-first. */
  readonly requiredPlans?: SubscriptionPlanId[];
  /** Stable machine key for the gated capability, e.g. `'video_4k_render'`. */
  readonly feature?: string;
  /** Standalone user-facing English describing the limitation. */
  readonly limitation?: string;

  constructor(message: string, fields: ChatJobErrorFields = {}) {
    super(message);
    this.name = 'ChatJobError';
    this.code = fields.code;
    this.errorCode = fields.code;
    this.errorType = fields.errorType;
    this.jobID = fields.jobID;
    this.status = fields.status;
    this.payload = fields.payload;
    this.subscriptionLimit = fields.subscriptionLimit;
    this.requiredPlans = fields.requiredPlans;
    this.feature = fields.feature;
    this.limitation = fields.limitation;
  }

  /**
   * The numeric subscription denial code when this failure is one of the
   * `SUBSCRIPTION_ERROR_CODES` (4078 / 4079 / 4080); `undefined` otherwise.
   */
  get subscriptionErrorCode(): SubscriptionErrorCode | undefined {
    if (!this.code) return undefined;
    const numeric = Number(this.code);
    const known = Object.values(SUBSCRIPTION_ERROR_CODES) as number[];
    return known.includes(numeric) ? (numeric as SubscriptionErrorCode) : undefined;
  }
}

/**
 * Extract structured chat-job error fields from a REST chat error body.
 *
 * Only payload shapes tied to a named producer are recognized; anything else
 * returns `undefined` so the caller keeps its existing error untouched:
 *
 * 1. OpenAI-style envelope `{ error: { message, type, code } }` — produced by
 *    the socket server's HTTP LLM arm (jobsController
 *    `handleHTTPLLMJobRequest`, e.g. HTTP 402 with
 *    `type: 'subscription_unavailable'`, `code: '4078' | '4080'`) and
 *    forwarded by `POST /v1/chat/completions`.
 * 2. Flat socket fields `{ error, error_code, error_message }` — the
 *    `llmJobError` socket message contract (jobsController
 *    `handleLLMJobRequest`) mirrored into a REST body.
 *
 * @internal
 */
export function extractChatJobErrorFields(
  payload: unknown
): ExtractedChatJobErrorFields | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;

  const readStructured = (
    source: Record<string, unknown>
  ): Pick<
    ExtractedChatJobErrorFields,
    'subscriptionLimit' | 'requiredPlans' | 'feature' | 'limitation'
  > => {
    const subscriptionLimit = source.subscriptionLimit === true ? true : undefined;
    const requiredPlans = Array.isArray(source.requiredPlans)
      ? (source.requiredPlans.filter((p) => typeof p === 'string') as SubscriptionPlanId[])
      : undefined;
    const feature = typeof source.feature === 'string' ? source.feature : undefined;
    const limitation = typeof source.limitation === 'string' ? source.limitation : undefined;
    return { subscriptionLimit, requiredPlans, feature, limitation };
  };

  // Shape 1: OpenAI-style envelope { error: { message, type, code, subscription } }
  const envelope = record.error;
  if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) {
    const err = envelope as Record<string, unknown>;
    const code = typeof err.code === 'string' ? err.code : undefined;
    const errorType = typeof err.type === 'string' ? err.type : undefined;
    const message = typeof err.message === 'string' ? err.message : undefined;
    const sub =
      err.subscription && typeof err.subscription === 'object' && !Array.isArray(err.subscription)
        ? (err.subscription as Record<string, unknown>)
        : undefined;
    const structured = sub ? readStructured(sub) : {};
    if (code !== undefined || errorType !== undefined || structured.subscriptionLimit) {
      return { code, errorType, message, ...structured };
    }
    return undefined;
  }

  // Shape 2: flat socket llmJobError fields { error, error_code, error_message, ...structured }
  const errorType = typeof record.error === 'string' ? record.error : undefined;
  const code = typeof record.error_code === 'string' ? record.error_code : undefined;
  const message = typeof record.error_message === 'string' ? record.error_message : undefined;
  const structured = readStructured(record);
  if (
    code !== undefined ||
    (errorType !== undefined && message !== undefined) ||
    structured.subscriptionLimit
  ) {
    return { code, errorType, message, ...structured };
  }
  return undefined;
}

export default ChatJobError;
