import ErrorData, { SUBSCRIPTION_ERROR_CODES } from '../types/ErrorData.js';

const FEATURE_CODE = SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_FEATURE_REQUIRES_UPGRADE;

/**
 * Returns `true` when the argument represents a subscription FEATURE-gate
 * denial (socket error code 4081 / {@link SUBSCRIPTION_ERROR_CODES}
 * `SUBSCRIPTION_FEATURE_REQUIRES_UPGRADE`).
 *
 * Accepts the numeric code, the string code, an {@link ErrorData} from the
 * render path, or any object carrying the `subscriptionLimit` discriminator or
 * a `code` of 4081 (e.g. a `ChatJobError`, whose `code` is the string wire
 * value). Anything else — including the other subscription denial codes
 * (4078/4079/4080) — returns `false`.
 */
export default function isSubscriptionLimitError(
  codeOrError:
    | number
    | string
    | ErrorData
    | { code?: number | string; subscriptionLimit?: boolean }
    | null
    | undefined
): boolean {
  if (codeOrError === null || codeOrError === undefined) return false;
  if (typeof codeOrError === 'number') return codeOrError === FEATURE_CODE;
  if (typeof codeOrError === 'string') return Number(codeOrError) === FEATURE_CODE;
  if (typeof codeOrError === 'object') {
    const record = codeOrError as { code?: number | string; subscriptionLimit?: boolean };
    if (record.subscriptionLimit === true) return true;
    const code = record.code;
    if (typeof code === 'number') return code === FEATURE_CODE;
    if (typeof code === 'string') return Number(code) === FEATURE_CODE;
  }
  return false;
}
