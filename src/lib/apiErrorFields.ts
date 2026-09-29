/**
 * Optional fields a Sogni REST error may carry next to `message` and
 * `errorCode`. Kept import-free: `ApiClient/index.ts` (which defines `ApiError`)
 * and every REST surface that builds one read these helpers.
 */

export interface ApiErrorExtras {
  retryAfter?: number;
  details?: Record<string, unknown>;
}

const HTTP_DATE_TIME = /\d{2}:\d{2}:\d{2}/;
const HTTP_DATE_WORD = /[A-Za-z]{3}/;

/** A wait in seconds, or undefined when the value is not a usable one. */
export function normalizeRetryAfterSeconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Parse an HTTP `Retry-After` header into whole seconds from now. Accepts both
 * forms the header allows — delta-seconds (`"120"`) and an HTTP-date — and
 * returns undefined for anything else. A date already in the past reads as 0.
 */
export function parseRetryAfterHeader(
  value: string | null | undefined,
  nowMs: number = Date.now()
): number | undefined {
  if (typeof value !== 'string') return undefined;
  const header = value.trim();
  if (!header) return undefined;
  if (/^\d+$/.test(header)) {
    const seconds = Number(header);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  // Date.parse is lenient ("1.5" parses as a date), so only hand it something
  // shaped like an HTTP-date: a day/month word and an HH:MM:SS time.
  if (!HTTP_DATE_WORD.test(header) || !HTTP_DATE_TIME.test(header)) return undefined;
  const at = Date.parse(header);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

export function normalizeErrorDetails(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The optional fields of an error body, validated; absent fields are omitted. */
export function apiErrorExtras(body: unknown): ApiErrorExtras {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  const source = body as Record<string, unknown>;
  const extras: ApiErrorExtras = {};
  const retryAfter = normalizeRetryAfterSeconds(source.retryAfter);
  if (retryAfter !== undefined) extras.retryAfter = retryAfter;
  const details = normalizeErrorDetails(source.details);
  if (details) extras.details = details;
  return extras;
}
