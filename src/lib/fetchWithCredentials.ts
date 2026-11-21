import isNodejs from './isNodejs.js';

const CREDENTIAL_HEADERS = ['api-key', 'authorization', 'cookie'];
// Node's fetch also drops these when a redirect changes origin.
const CROSS_ORIGIN_HEADERS = [...CREDENTIAL_HEADERS, 'proxy-authorization', 'host'];
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
// Node's fetch follows at most 20 redirects.
const MAX_REDIRECTS = 20;

/** Fail the way Node's fetch does when it cannot follow a redirect. */
function fetchFailed(cause: unknown): TypeError {
  return Object.assign(new TypeError('fetch failed'), { cause });
}

/** http: to https: on the same hostname, on default ports or the same explicit port. */
function isSameHostUpgrade(from: URL, to: URL): boolean {
  if (from.protocol !== 'http:' || to.protocol !== 'https:' || from.hostname !== to.hostname) {
    return false;
  }
  if (!from.port) return !to.port;
  return from.port === (to.port || '443');
}

/** Follow authenticated Node requests without forwarding credentials to another origin. */
export async function fetchWithCredentials(
  url: string,
  init: RequestInit = {},
  authenticated = false
): Promise<Response> {
  // Browsers handle redirects themselves: manual responses there are opaque.
  // API-key authentication is for server-side use.
  if (!isNodejs) return fetch(url, init);
  // An explicit 'error' or 'manual' mode never follows a redirect.
  if (init.redirect && init.redirect !== 'follow') return fetch(url, init);
  const headers = new Headers(init.headers);
  if (
    !authenticated &&
    init.credentials !== 'include' &&
    !CREDENTIAL_HEADERS.some((name) => headers.has(name))
  )
    return fetch(url, init);

  let origin: URL;
  try {
    origin = new URL(url);
  } catch {
    return fetch(url, init);
  }
  let current = url;
  let keepCredentials = true;
  let options: RequestInit = { ...init, redirect: 'manual' };
  for (let redirects = 0; ; redirects++) {
    const response = await fetch(current, options);
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.includes(response.status) || location === null) return response;
    await response.body?.cancel();
    if (redirects >= MAX_REDIRECTS) throw fetchFailed(new Error('redirect count exceeded'));
    let next: URL;
    try {
      next = new URL(location, current);
    } catch (error) {
      throw fetchFailed(error);
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      throw fetchFailed(new Error('URL scheme must be a HTTP(S) scheme'));
    }
    if (next.username || next.password) {
      throw fetchFailed(new Error('cross origin not allowed for request mode "cors"'));
    }
    if (keepCredentials && next.origin !== origin.origin) {
      if (isSameHostUpgrade(origin, next)) {
        // The same host moving to https keeps the request's credentials.
        origin = next;
      } else {
        for (const name of CROSS_ORIGIN_HEADERS) headers.delete(name);
        options.credentials = 'omit';
        keepCredentials = false;
      }
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
