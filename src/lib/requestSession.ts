import type { AuthManager } from './AuthManager/index.js';

const ACCOUNT_CHANGED_MESSAGE = 'The account changed. Submit this request again.';
const CLIENT_CLOSED_MESSAGE = 'This Sogni client was closed before the request finished.';

/**
 * A request outlived the sign-in session that started it. `reason` says why:
 * the account signed out or changed, or the client itself was disposed. A
 * disposed client never reports an account change that did not happen, and
 * background work can recognise a result that no longer has an owner.
 */
export class RequestSessionError extends Error {
  readonly reason: 'accountChanged' | 'clientClosed';

  constructor(message: string, reason: RequestSessionError['reason']) {
    super(message);
    this.name = 'RequestSessionError';
    this.reason = reason;
  }
}

/** Keeps asynchronous request preparation attached to its initiating sign-in session. */
export function captureRequestSession(
  auth: AuthManager | undefined,
  message = ACCOUNT_CHANGED_MESSAGE
): () => void {
  const session = auth?.sessionVersion;
  return () => {
    if (auth?.sessionVersion === session) return;
    if (auth?.closed) throw new RequestSessionError(CLIENT_CLOSED_MESSAGE, 'clientClosed');
    throw new RequestSessionError(message, 'accountChanged');
  };
}
