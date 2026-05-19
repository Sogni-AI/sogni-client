import { decodeToken, decodeRefreshToken } from '../utils/index.js';
import { ApiError, ApiErrorResponse } from '../../ApiClient/index.js';
import { Logger } from '../DefaultLogger.js';
import isNodejs from '../isNodejs.js';
import Cookie from 'js-cookie';
import AuthManagerBase from './AuthManagerBase.js';
import { ClientOptions } from 'ws';

/**
 * Token object, containing the token and refresh token
 * @property {string} token - The JWT token
 * @property {string} refreshToken - The refresh token
 */
export interface TokenAuthData {
  token: string;
  refreshToken: string;
}

class TokenAuthManager extends AuthManagerBase<TokenAuthData | null> {
  private _token?: string;
  private _tokenExpiresAt: Date = new Date(0);
  private _refreshToken?: string;
  private _refreshTokenExpiresAt: Date = new Date(0);
  private _baseUrl: string;
  private _renewTokenPromise?: Promise<string>;

  constructor(baseUrl: string, logger: Logger) {
    super(logger);
    this._baseUrl = baseUrl;
  }

  get isAuthenticated() {
    return !!this._refreshToken && this._refreshTokenExpiresAt > new Date();
  }

  async backup() {
    if (this._token && this._refreshToken) {
      return { token: this._token, refreshToken: this._refreshToken };
    }
    return null;
  }

  async authenticate({ refreshToken, token }: TokenAuthData) {
    // If there is a token, and it is not expired, authenticate with it
    if (token) {
      const { expiresAt } = decodeToken(token);
      if (expiresAt > new Date()) {
        this._updateTokens({ token, refreshToken });
        return;
      }
    }
    // If token is expired, try to renew it with the refresh token
    this._refreshToken = refreshToken;
    const { expiresAt: refreshExpiresAt } = decodeRefreshToken(refreshToken);
    this._refreshTokenExpiresAt = refreshExpiresAt;
    await this._renewTokenSafe();
  }

  clear() {
    // Prevent duplicate events
    if (!this._token && !this._refreshToken) {
      return;
    }
    this._refreshToken = undefined;
    this._refreshTokenExpiresAt = new Date(0);
    this._token = undefined;
    this._tokenExpiresAt = new Date(0);
    this.emit('updated', false);
  }

  async authenticateRequest(option: RequestInit): Promise<RequestInit> {
    //If there is a token, and it is not expired, return it
    if (this._token && this._tokenExpiresAt > new Date()) {
      return { ...option, headers: { ...option.headers, Authorization: this._token } };
    }
    //If there is no refresh token, return undefined, to make unauthorized requests
    if (!this._refreshToken) {
      return option;
    }
    //If there is a refresh token, try to renew the token
    const token = await this._renewTokenSafe();
    return { ...option, headers: { ...option.headers, Authorization: token } };
  }

  async socketOptions(): Promise<ClientOptions | undefined> {
    if (!isNodejs) {
      return undefined;
    }
    const token = await this._getToken();
    if (!token) {
      return undefined;
    }
    return {
      headers: {
        Authorization: token
      }
    };
  }

  private async _getToken() {
    if (this._token && this._tokenExpiresAt > new Date()) {
      return this._token;
    }
    //If there is no refresh token, return undefined, to make unauthorized requests
    if (!this._refreshToken) {
      return undefined;
    }
    //If there is a refresh token, try to renew the token
    return this._renewTokenSafe();
  }

  private async _renewTokenSafe(): Promise<string> {
    if (this._renewTokenPromise) {
      return this._renewTokenPromise;
    }
    this._renewTokenPromise = this._renewToken();
    this._renewTokenPromise.finally(() => {
      this._renewTokenPromise = undefined;
    });
    return this._renewTokenPromise;
  }

  private _updateTokens({ token, refreshToken }: { token: string; refreshToken: string }) {
    // Prevent duplicate events
    if (this._token === token && this._refreshToken === refreshToken) {
      return;
    }
    this._token = token;
    const { expiresAt } = decodeToken(token);
    this._tokenExpiresAt = expiresAt;
    this._refreshToken = refreshToken;
    const { expiresAt: refreshExpiresAt } = decodeRefreshToken(refreshToken);
    this._refreshTokenExpiresAt = refreshExpiresAt;
    this._updateCookies();
    this.emit('updated', true);
  }

  /**
   * This is a fallback for browsers, where we can't set headers on WebSocket requests.
   * Normally a browser should use CookieAuthManager
   * @private
   */
  private _updateCookies() {
    if (isNodejs) {
      return;
    }
    const token = this._token;
    if (token) {
      Cookie.set('authorization', token, {
        domain: '.sogni.ai',
        expires: 1
      });
    } else {
      Cookie.remove('authorization', {
        domain: '.sogni.ai'
      });
    }
  }

  private async _renewToken(): Promise<string> {
    if (this._refreshTokenExpiresAt < new Date()) {
      throw new Error('Refresh token expired');
    }
    const url = new URL('/v1/account/refresh-token', this._baseUrl).toString();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refreshToken: this._refreshToken })
    });
    // Mirror RestClient.processResponse: read body once as text, attempt JSON
    // parse, prefer surfacing real HTTP status when an upstream gateway returns
    // an HTML error page instead of the generic "Failed to parse response".
    const rawText = await response.text();
    let parsedBody: any;
    let parseError: unknown;
    if (rawText) {
      try {
        parsedBody = JSON.parse(rawText);
      } catch (e) {
        parseError = e;
      }
    }
    if (!response.ok) {
      this.clear();
      const payload: ApiErrorResponse =
        parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
          ? (parsedBody as ApiErrorResponse)
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
    if (parseError || !parsedBody) {
      this.clear();
      this._logger.error('Failed to parse 2xx response body as JSON:', parseError, {
        status: response.status,
        bodyExcerpt: rawText.slice(0, 200)
      });
      throw new Error(
        `Failed to parse response body (HTTP ${response.status}): ${
          parseError ? ((parseError as Error).message ?? String(parseError)) : 'empty body'
        }`
      );
    }
    const { token, refreshToken } = parsedBody.data;
    this._updateTokens({ token, refreshToken });
    return this._token!;
  }
}

export default TokenAuthManager;
