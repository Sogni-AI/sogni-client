import type { AuthManager } from './AuthManager/index.js';

/** Keeps asynchronous request preparation attached to its initiating sign-in session. */
export function captureRequestSession(
  auth: AuthManager | undefined,
  message = 'The account changed. Submit this request again.'
): () => void {
  const session = auth?.sessionVersion;
  return () => {
    if (auth?.sessionVersion !== session) {
      throw new Error(message);
    }
  };
}
