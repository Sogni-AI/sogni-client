import RestClient from '../lib/RestClient';
import WebSocketClient from './WebSocketClient';
import TypedEventEmitter from '../lib/TypedEventEmitter';
import { ApiClientEvents } from './events';
import { ServerConnectData, ServerDisconnectData } from './WebSocketClient/events';
import { isNotRecoverable } from './WebSocketClient/ErrorCode';
import { JSONValue } from '../types/json';
import { SupernetType } from './WebSocketClient/types';
import { Logger } from '../lib/DefaultLogger';
import CookieAuthManager from '../lib/AuthManager/CookieAuthManager';
import { AuthManager, TokenAuthManager } from '../lib/AuthManager';

const WS_RECONNECT_ATTEMPTS = 5;

export interface ApiResponse<D = JSONValue> {
  status: 'success';
  data: D;
}

/** @inline */
export interface ApiErrorResponse {
  status: 'error';
  message: string;
  errorCode: number;
}

export class ApiError extends Error {
  status: number;
  payload: ApiErrorResponse;
  constructor(status: number, payload: ApiErrorResponse) {
    super(payload.message);
    this.status = status;
    this.payload = payload;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  socketUrl: string;
  appId: string;
  networkType: SupernetType;
  logger: Logger;
  authType: 'token' | 'cookies';
  disableSocket?: boolean;
}

class ApiClient extends TypedEventEmitter<ApiClientEvents> {
  readonly appId: string;
  readonly logger: Logger;
  private _rest: RestClient;
  private _socket: WebSocketClient;
  private _auth: AuthManager;
  private _reconnectAttempts = WS_RECONNECT_ATTEMPTS;
  private _disableSocket: boolean = false;

  constructor({
    baseUrl,
    socketUrl,
    appId,
    networkType,
    authType,
    logger,
    disableSocket = false
  }: ApiClientOptions) {
    super();
    this.appId = appId;
    this.logger = logger;
    this._auth =
      authType === 'token' ? new TokenAuthManager(baseUrl, logger) : new CookieAuthManager(logger);
    this._rest = new RestClient(baseUrl, this._auth, logger);
    this._socket = new WebSocketClient(socketUrl, this._auth, appId, networkType, logger);
    this._disableSocket = disableSocket;
    this._auth.on('updated', this.handleAuthUpdated.bind(this));
    this._socket.on('connected', this.handleSocketConnect.bind(this));
    this._socket.on('disconnected', this.handleSocketDisconnect.bind(this));
  }

  get isAuthenticated(): boolean {
    return this.auth.isAuthenticated;
  }

  get auth() {
    return this._auth;
  }

  get socket(): WebSocketClient {
    return this._socket;
  }

  get rest(): RestClient {
    return this._rest;
  }

  get socketEnabled(): boolean {
    return !this._disableSocket;
  }

  handleSocketConnect({ network }: ServerConnectData) {
    this._reconnectAttempts = WS_RECONNECT_ATTEMPTS;
    this.emit('connected', { network });
  }

  handleSocketDisconnect(data: ServerDisconnectData) {
    if (!data.code || isNotRecoverable(data.code)) {
      this.auth.clear();
      this.emit('disconnected', data);
      this.logger.error('Not recoverable socket error', data);
      return;
    }
    if (this._reconnectAttempts <= 0) {
      this.auth.clear();
      this.emit('disconnected', data);
      this._reconnectAttempts = WS_RECONNECT_ATTEMPTS;
      return;
    }
    this._reconnectAttempts--;
    setTimeout(() => this.socket.connect(), 1000);
  }

  handleAuthUpdated(isAuthenticated: boolean) {
    if (!isAuthenticated) {
      if (this.socket.isConnected) {
        this.socket.disconnect();
      }
    } else if (!this._disableSocket) {
      this.socket.connect();
    }
  }
}

export default ApiClient;
