import RestClient from '../lib/RestClient';
import WebSocketClient from './WebSocketClient';
import { jwtDecode } from 'jwt-decode';
import TypedEventEmitter from '../lib/TypedEventEmitter';
import { ApiClientEvents } from './events';
import { ServerConnectData, ServerDisconnectData } from './WebSocketClient/events';
import { isNotRecoverable } from './WebSocketClient/ErrorCode';
import { JSONValue } from '../types/json';
import { SupernetType } from './WebSocketClient/types';

const WS_RECONNECT_ATTEMPTS = 5;

export interface ApiReponse<D = JSONValue> {
  status: 'success';
  data: D;
}

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

interface AuthData {
  token: string;
  walletAddress: string;
  expiresAt: Date;
}

class ApiClient extends TypedEventEmitter<ApiClientEvents> {
  readonly appId: string;
  private _rest: RestClient;
  private _socket: WebSocketClient;
  private _auth: AuthData | null = null;
  private _reconnectAttempts = WS_RECONNECT_ATTEMPTS;

  constructor(baseUrl: string, socketUrl: string, appId: string, networkType: SupernetType) {
    super();
    this.appId = appId;
    this._rest = new RestClient(baseUrl);
    this._socket = new WebSocketClient(socketUrl, appId, networkType);
    this._socket.on('connected', this.handleSocketConnect.bind(this));
    this._socket.on('disconnected', this.handleSocketDisconnect.bind(this));
  }

  get isAuthenticated(): boolean {
    return !!this._auth && this._auth.expiresAt > new Date();
  }

  get auth(): AuthData | null {
    return this._auth && this._auth.expiresAt > new Date() ? this._auth : null;
  }

  get socket(): WebSocketClient {
    return this._socket;
  }

  get rest(): RestClient {
    return this._rest;
  }

  authenticate(token: string) {
    const decoded = jwtDecode<{ addr: string; env: string; iat: number; exp: number }>(token);
    this._auth = {
      token,
      walletAddress: decoded.addr,
      expiresAt: new Date(decoded.exp * 1000)
    };
    this.rest.auth = { token };
    this.socket.auth = { token };
    this.socket.connect();
  }

  removeAuth() {
    this._auth = null;
    this.socket.disconnect();
  }

  handleSocketConnect({ network }: ServerConnectData) {
    this._reconnectAttempts = WS_RECONNECT_ATTEMPTS;
    this.emit('connected', { network });
  }

  handleSocketDisconnect(data: ServerDisconnectData) {
    if (!data.code || isNotRecoverable(data.code)) {
      this.removeAuth();
      this.emit('disconnected', data);
      console.error('Not recoverable socket error', data);
      return;
    }
    if (this._reconnectAttempts <= 0) {
      this.emit('disconnected', data);
      this._reconnectAttempts = WS_RECONNECT_ATTEMPTS;
      return;
    }
    this._reconnectAttempts--;
    setTimeout(() => this.socket.connect(), 1000);
  }
}

export default ApiClient;
