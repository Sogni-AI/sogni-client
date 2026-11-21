import isNodejs from './isNodejs.js';

const CREDENTIAL_HEADERS = ['api-key', 'authorization', 'cookie'];
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/** Follow authenticated Node requests without forwarding credentials to another origin. */
export async function fetchWithCredentials(
  url: string,
  init: RequestInit = {},
  authenticated = false
): Promise<Response> {
  // Browsers handle redirects themselves: manual responses there are opaque.
  // API-key authentication is for server-side use.
  if (!isNodejs) return fetch(url, init);
  const headers = new Headers(init.headers);
  if (
    !authenticated &&
    init.credentials !== 'include' &&
    !CREDENTIAL_HEADERS.some((name) => headers.has(name))
  )
    return fetch(url, init);

  const origin = new URL(url).origin;
  let current = url;
  let options: RequestInit = { ...init, redirect: 'manual' };
  for (let hops = 0; ; hops++) {
    const response = await fetch(current, options);
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.includes(response.status) || !location) return response;
    await response.body?.cancel();
    if (hops >= 5) throw new Error('Too many redirects');
    const next = new URL(location, current);
    if (next.origin !== origin) {
      for (const name of CREDENTIAL_HEADERS) headers.delete(name);
      options.credentials = 'omit';
    }
    const method = (options.method || 'GET').toUpperCase();
    if (
      (response.status === 303 && method !== 'GET' && method !== 'HEAD') ||
      ((response.status === 301 || response.status === 302) && method === 'POST')
    ) {
      options = { ...options, method: 'GET', body: undefined };
      for (const name of [
        'content-encoding',
        'content-language',
        'content-location',
        'content-type',
        'content-length'
      ]) {
        headers.delete(name);
      }
    }
    options.headers = headers;
    current = next.toString();
  }
}
