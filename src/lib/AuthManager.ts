import { decodeToken, decodeRefreshToken } from './utils';
import { ApiError, ApiErrorResponse } from '../ApiClient';
import { Logger } from './DefaultLogger';
import isNodejs from './isNodejs';
import Cookie from 'js-cookie';
import TypedEventEmitter from './TypedEventEmitter';

/**
 * Tokens object, containing the token and refresh token
 * @typedef {Object} Tokens
 * @property {string} [token] - The JWT token. Optonal, if missing it will be retrieved from the server
 * @property {string} refreshToken - The refresh token
 */
export interface Tokens {
  token?: string;
  refreshToken: string;
}

export type AuthUpdatedEvent =
  | { token: string; refreshToken: string; walletAddress: string }
  | { token: null; refreshToken: null; walletAddress: null };

interface AuthManagerEvents {
  updated: AuthUpdatedEvent;
  refreshFailed: ApiErrorResponse;
}

class AuthManager extends TypedEventEmitter<AuthManagerEvents> {
  private _token?: string;
  private _tokenExpiresAt: Date = new Date(0);
  private _refreshToken?: string;
  private _refreshTokenExpiresAt: Date = new Date(0);
  private _logger: Logger;
  private _baseUrl: string;
  private _walletAddress?: string;
  private _renewTokenPromise?: Promise<string>;

  constructor(baseUrl: string, logger: Logger) {
    super();
    this._logger = logger;
    this._baseUrl = baseUrl;
  }

  get refreshToken() {
    return this._refreshToken;
  }

  get walletAddress() {
    return this._walletAddress;
  }

  get isAuthenticated() {
    return !!this._refreshToken && this._refreshTokenExpiresAt > new Date();
  }

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

  async setTokens({ refreshToken, token }: { refreshToken: string; token?: string }) {
    if (token) {
      this._updateTokens({ token, refreshToken });
      return;
    }
    this._refreshToken = refreshToken;
    const { expiresAt: refreshExpiresAt } = decodeRefreshToken(refreshToken);
    this._refreshTokenExpiresAt = refreshExpiresAt;
    await this.renewToken();
  }

  async getToken(): Promise<string | undefined> {
    //If there is a token, and it is not expired, return it
    if (this._token && this._tokenExpiresAt > new Date()) {
      return this._token;
    }
    //If there is no refresh token, return undefined, to make unauthorized requests
    if (!this._refreshToken) {
      return;
    }
    //If there is a refresh token, try to renew the token
    return this.renewToken();
  }

  async renewToken(): Promise<string> {
    if (this._renewTokenPromise) {
      return this._renewTokenPromise;
    }
    this._renewTokenPromise = this._renewToken();
    this._renewTokenPromise.finally(() => {
      this._renewTokenPromise = undefined;
    });
    return this._renewTokenPromise;
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
    this._walletAddress = undefined;
    this.emit('updated', { token: null, refreshToken: null, walletAddress: null });
  }

  private _updateTokens({ token, refreshToken }: { token: string; refreshToken: string }) {
    // Prevent duplicate events
    if (this._token === token && this._refreshToken === refreshToken) {
      return;
    }
    this._token = token;
    const { expiresAt, walletAddress } = decodeToken(token);
    this._walletAddress = walletAddress;
    this._tokenExpiresAt = expiresAt;
    this._refreshToken = refreshToken;
    const { expiresAt: refreshExpiresAt } = decodeRefreshToken(refreshToken);
    this._refreshTokenExpiresAt = refreshExpiresAt;
    this._updateCookies();
    this.emit('updated', { token, refreshToken, walletAddress });
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
    let responseData: any;
    try {
      responseData = await response.json();
    } catch (e) {
      this.emit('refreshFailed', {
        status: 'error',
        errorCode: 0,
        message: 'Failed to parse response'
      });
      this._logger.error('Failed to parse response:', e);
      throw new Error('Failed to parse response');
    }
    if (!response.ok) {
      this.emit('refreshFailed', responseData);
      this.clear();
      throw new ApiError(response.status, responseData as ApiErrorResponse);
    }
    const { token, refreshToken } = responseData.data;
    this._updateTokens({ token, refreshToken });
    return this._token!;
  }
}

export default AuthManager;
