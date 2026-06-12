import { SUBSCRIPTION_ERROR_CODES, SubscriptionErrorCode } from '../types/ErrorData.js';

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
}

/** Fields extracted from a recognized REST chat error body. @internal */
export interface ExtractedChatJobErrorFields {
  code?: string;
  errorType?: string;
  message?: string;
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

  constructor(message: string, fields: ChatJobErrorFields = {}) {
    super(message);
    this.name = 'ChatJobError';
    this.code = fields.code;
    this.errorCode = fields.code;
    this.errorType = fields.errorType;
    this.jobID = fields.jobID;
    this.status = fields.status;
    this.payload = fields.payload;
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

  // Shape 1: OpenAI-style envelope { error: { message, type, code } }
  const envelope = record.error;
  if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) {
    const err = envelope as Record<string, unknown>;
    const code = typeof err.code === 'string' ? err.code : undefined;
    const errorType = typeof err.type === 'string' ? err.type : undefined;
    const message = typeof err.message === 'string' ? err.message : undefined;
    if (code !== undefined || errorType !== undefined) {
      return { code, errorType, message };
    }
    return undefined;
  }

  // Shape 2: flat socket llmJobError fields { error, error_code, error_message }
  const errorType = typeof record.error === 'string' ? record.error : undefined;
  const code = typeof record.error_code === 'string' ? record.error_code : undefined;
  const message = typeof record.error_message === 'string' ? record.error_message : undefined;
  if (code !== undefined || (errorType !== undefined && message !== undefined)) {
    return { code, errorType, message };
  }
  return undefined;
}

export default ChatJobError;
