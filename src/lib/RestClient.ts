import { ApiError, ApiErrorResponse } from '../ApiClient/index.js';
import TypedEventEmitter, { EventMap } from './TypedEventEmitter.js';
import { JSONValue } from '../types/json.js';
import { Logger } from './DefaultLogger.js';
import { AuthManager } from './AuthManager/index.js';
import { captureRequestSession } from './requestSession.js';

interface RestRequestInit extends RequestInit {
  timeoutMs?: number;
}

interface RestPostOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

const PLAIN_TEXT_ERROR_MAX_LENGTH = 500;
const ERROR_BODY_EXCERPT_LENGTH = 200;

/**
 * Message for a non-2xx response whose body is not a JSON object.
 *
 * A plain-text body is the server's own explanation (sogni-socket answers a held
 * model with "MiniMax H3 Latent Upscaler (Community) will be available soon."), so
 * it is the message. The HTTP reason phrase ("Bad Request") only labels an empty
 * body or a gateway's HTML error page, which gets a short excerpt instead.
 */
function nonJsonErrorMessage(response: Response, rawText: string): string {
  const body = rawText.replace(/\s+/g, ' ').trim();
  const status = response.statusText || `HTTP ${response.status}`;
  if (!body) return status;
  if (!body.startsWith('<')) {
    return body.length > PLAIN_TEXT_ERROR_MAX_LENGTH
      ? `${body.slice(0, PLAIN_TEXT_ERROR_MAX_LENGTH)}…`
      : body;
  }
  return `${status}: ${body.slice(0, ERROR_BODY_EXCERPT_LENGTH)}`;
}

class RestClient<E extends EventMap = never> extends TypedEventEmitter<E> {
  readonly baseUrl: string;
  protected _auth: AuthManager;
  protected _logger: Logger;

  constructor(baseUrl: string, auth: AuthManager, logger: Logger) {
    super();
    this.baseUrl = baseUrl;
    this._auth = auth;
    this._logger = logger;
  }

  get auth(): AuthManager {
    return this._auth;
  }

  private formatUrl(relativeUrl: string, query: Record<string, unknown> = {}): string {
    const url = new URL(relativeUrl, this.baseUrl);
    Object.keys(query).forEach((key) => {
      const value = query[key];
      // Omit unset optional params: URLSearchParams would send the literal
      // string "undefined", which the API reads as a real value.
      if (value === undefined || value === null) return;
      url.searchParams.append(key, String(value));
    });
    return url.toString();
  }

  private async request<T = JSONValue>(url: string, options: RestRequestInit = {}): Promise<T> {
    const assertSession = captureRequestSession(this.auth);
    const { timeoutMs = 30000, ...requestOptions } = options;
    const init = await this.auth.authenticateRequest(requestOptions);
    assertSession();

    // Add a timeout to detect hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeoutId);
      assertSession();
      // Clear a rejected sign-in before parsing, including non-JSON 401 pages.
      // The response body then belongs to that signed-out session. A later
      // sign-in must invalidate both successful results and API errors.
      if (response.status === 401 && this.auth.isAuthenticated) {
        this.auth.clear();
        if (this.auth.isAuthenticated) assertSession();
      }
      const assertResponseSession = captureRequestSession(this.auth);
      try {
        return (await this.processResponse(response)) as T;
      } finally {
        // fetch resolves at the headers; reading the body can outlive this account.
        assertResponseSession();
      }
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  }

  private async processResponse(response: Response): Promise<JSONValue> {
    // Read the body once as text so we can attempt JSON parse AND fall back to
    // surfacing the raw text in the thrown ApiError if it isn't JSON. This
    // matters because gateways (nginx, CloudFront, uWebSockets) return HTML
    // error pages for 5xx — under the old "JSON.parse first" flow that produced
    // the misleading generic "Failed to parse response" error which hid the
    // actual HTTP status from the caller and made retry decisions impossible.
    const rawText = await response.text();

    let parsedBody: JSONValue | undefined;
    let parseError: unknown;
    if (rawText) {
      try {
        parsedBody = JSON.parse(rawText) as JSONValue;
      } catch (e) {
        parseError = e;
      }
    }

    if (!response.ok) {
      // Non-2xx. If body was JSON, surface its shape; otherwise synthesize an
      // ApiErrorResponse so callers and operators can see what came back.
      const payload: ApiErrorResponse =
        parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
          ? (parsedBody as unknown as ApiErrorResponse)
          : {
              status: 'error',
              message: nonJsonErrorMessage(response, rawText),
              errorCode: response.status
            };
      throw new ApiError(response.status, payload, response.headers.get('retry-after'));
    }

    // 2xx. JSON-parse failure here is genuinely unexpected (the server claimed
    // success but didn't send JSON) — log + throw, but include the status so
    // the caller knows it wasn't an HTTP-level failure.
    if (parseError) {
      this._logger.error('Failed to parse 2xx response body as JSON:', parseError, {
        status: response.status,
        bodyExcerpt: rawText.slice(0, 200)
      });
      throw new Error(
        `Failed to parse response body (HTTP ${response.status}): ${
          (parseError as Error).message ?? String(parseError)
        }`
      );
    }
    return parsedBody as JSONValue;
  }

  get<T = JSONValue>(path: string, query: Record<string, any> = {}): Promise<T> {
    return this.request<T>(this.formatUrl(path, query));
  }

  delete<T = JSONValue>(path: string): Promise<T> {
    return this.request<T>(this.formatUrl(path), { method: 'DELETE' });
  }

  post<T = JSONValue>(
    path: string,
    body: Record<string, unknown> = {},
    options: RestPostOptions = {}
  ): Promise<T> {
    const { headers = {}, ...requestOptions } = options;
    return this.request<T>(this.formatUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body),
      ...requestOptions
    });
  }
}

export default RestClient;
