import ErrorData, {
  MODEL_CONSENT_REQUIRED_ERROR_CODE,
  ModelConsentRequirement
} from '../types/ErrorData.js';

/**
 * Returns `true` when the argument represents a model consent refusal: the
 * account has not accepted the one-time agreement the model requires (socket
 * error code 4103 / {@link MODEL_CONSENT_REQUIRED_ERROR_CODE}).
 *
 * Accepts the numeric code, the string code, an {@link ErrorData} from the
 * render path, or any object carrying a `consentRequired` agreement or a
 * `code` / `errorCode` of 4103. Anything else returns `false`.
 *
 * The refusal is not retryable: ask the user to accept the agreement in a
 * Sogni app, then submit again.
 */
export default function isModelConsentRequiredError(
  codeOrError:
    | number
    | string
    | ErrorData
    | {
        code?: number | string;
        errorCode?: number | string;
        consentRequired?: ModelConsentRequirement | null;
      }
    | null
    | undefined
): boolean {
  if (codeOrError === null || codeOrError === undefined) return false;
  if (typeof codeOrError === 'number') return codeOrError === MODEL_CONSENT_REQUIRED_ERROR_CODE;
  if (typeof codeOrError === 'string') {
    return Number(codeOrError) === MODEL_CONSENT_REQUIRED_ERROR_CODE;
  }
  if (typeof codeOrError === 'object') {
    const record = codeOrError as {
      code?: unknown;
      errorCode?: unknown;
      consentRequired?: { key?: unknown } | null;
    };
    if (typeof record.consentRequired?.key === 'string') return true;
    for (const code of [record.code, record.errorCode]) {
      if (typeof code === 'number' && code === MODEL_CONSENT_REQUIRED_ERROR_CODE) return true;
      if (typeof code === 'string' && Number(code) === MODEL_CONSENT_REQUIRED_ERROR_CODE) {
        return true;
      }
    }
  }
  return false;
}
