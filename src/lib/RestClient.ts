import { ApiError, ApiErrorResponse } from '../ApiClient/index.js';
import TypedEventEmitter, { EventMap } from './TypedEventEmitter.js';
import { JSONValue } from '../types/json.js';
import { Logger } from './DefaultLogger.js';
import { AuthManager } from './AuthManager/index.js';

interface RestRequestInit extends RequestInit {
  timeoutMs?: number;
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

  private formatUrl(relativeUrl: string, query: Record<string, string> = {}): string {
    const url = new URL(relativeUrl, this.baseUrl);
    Object.keys(query).forEach((key) => {
      url.searchParams.append(key, query[key]);
    });
    return url.toString();
  }

  private async request<T = JSONValue>(url: string, options: RestRequestInit = {}): Promise<T> {
    const { timeoutMs = 30000, ...requestOptions } = options;
    const init = await this.auth.authenticateRequest(requestOptions);

    // Add a timeout to detect hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeoutId);
      return this.processResponse(response) as T;
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  }

  private async processResponse(response: Response): Promise<JSONValue> {
    // 401 means that the client instance is not authenticated, so we clear the
    // authentication. Do this before parsing so we still clear on HTML error
    // pages that the upstream sometimes serves on 401.
    if (response.status === 401 && this.auth.isAuthenticated) {
      this.auth.clear();
    }

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
      // ApiErrorResponse from the HTTP status + a truncated body excerpt so
      // callers and operators can see what came back.
      const payload: ApiErrorResponse =
        parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
          ? (parsedBody as unknown as ApiErrorResponse)
          : {
              status: 'error',
              message:
                response.statusText ||
                `HTTP ${response.status}` +
                  (rawText ? `: ${rawText.slice(0, 200).replace(/\s+/g, ' ').trim()}` : ''),
              errorCode: response.status
            };
      throw new ApiError(response.status, payload);
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

  post<T = JSONValue>(
    path: string,
    body: Record<string, unknown> = {},
    options: Pick<RestRequestInit, 'timeoutMs'> = {}
  ): Promise<T> {
    return this.request<T>(this.formatUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      ...options
    });
  }
}

export default RestClient;
