import { ApiError, ApiErrorResponse } from '../ApiClient';
import TypedEventEmitter, { EventMap } from './TypedEventEmitter';
import { JSONValue } from '../types/json';
import { Logger } from './DefaultLogger';

export interface AuthData {
  token: string;
}

class RestClient<E extends EventMap = never> extends TypedEventEmitter<E> {
  readonly baseUrl: string;
  protected _auth: AuthData | null = null;
  protected _logger: Logger;

  constructor(baseUrl: string, logger: Logger) {
    super();
    this.baseUrl = baseUrl;
    this._logger = logger;
  }

  get auth(): AuthData | null {
    return this._auth;
  }

  set auth(auth: AuthData | null) {
    this._auth = auth;
  }

  private formatUrl(relativeUrl: string, query: Record<string, string> = {}): string {
    const url = new URL(relativeUrl, this.baseUrl);
    Object.keys(query).forEach((key) => {
      url.searchParams.append(key, query[key]);
    });
    return url.toString();
  }

  private request<T = JSONValue>(url: string, options: RequestInit = {}): Promise<T> {
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(this.auth ? { Authorization: this.auth.token } : {})
      }
    }).then((r) => this.processResponse(r) as T);
  }

  private async processResponse(response: Response): Promise<JSONValue> {
    let responseData;
    try {
      responseData = await response.json();
    } catch (e) {
      this._logger.error('Failed to parse response:', e);
      throw new Error('Failed to parse response');
    }
    if (!response.ok) {
      throw new ApiError(response.status, responseData as ApiErrorResponse);
    }
    return responseData as JSONValue;
  }

  get<T = JSONValue>(path: string, query: Record<string, any> = {}): Promise<T> {
    return this.request<T>(this.formatUrl(path, query), query);
  }

  post<T = JSONValue>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>(this.formatUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  }
}

export default RestClient;
