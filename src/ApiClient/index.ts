import RestClient from '../lib/RestClient.js';
import WebSocketClient from './WebSocketClient/index.js';
import TypedEventEmitter from '../lib/TypedEventEmitter.js';
import { ApiClientEvents } from './events.js';
import { ServerConnectData, ServerDisconnectData } from './WebSocketClient/events.js';
import { ErrorCode, isNotRecoverable } from './WebSocketClient/ErrorCode.js';
import { JSONValue } from '../types/json.js';
import { IWebSocketClient, SupernetType } from './WebSocketClient/types.js';
import type {
  SocketEventSubscriptionInput,
  SocketEventSubscriptions
} from './WebSocketClient/eventSubscriptions.js';
import { Logger } from '../lib/DefaultLogger.js';
import ApiKeyAuthManager from '../lib/AuthManager/ApiKeyAuthManager.js';
import CookieAuthManager from '../lib/AuthManager/CookieAuthManager.js';
import { AuthManager, TokenAuthManager } from '../lib/AuthManager/index.js';
import isNodejs from '../lib/isNodejs.js';
import BrowserWebSocketClient from './WebSocketClient/BrowserWebSocketClient/index.js';
import {
  buildSogniAttributionHeaders,
  normalizeConnectionAttribution,
  resolveWorkloadAttribution,
  type NormalizedConnectionAttribution
} from '../lib/attribution.js';
import type {
  SogniAttributionConfig,
  WorkloadAttributionDefaults,
  WorkloadAttributionInput
} from '../types/attribution.js';
import { apiErrorExtras, parseRetryAfterHeader } from '../lib/apiErrorFields.js';

/**
 * Reconnect backoff for recoverable socket drops. Attempts continue for as
 * long as the session stays authenticated: an in-flight generation survives a
 * network blip, a sleeping laptop, or a socket deploy, and the server hands it
 * back on reconnect.
 */
const WS_RECONNECT_BASE_DELAY_MS = 1000;
const WS_RECONNECT_MAX_DELAY_MS = 15000;

export interface ApiResponse<D = JSONValue> {
  status: 'success';
  data: D;
}

/** @inline */
export interface ApiErrorResponse {
  status: 'error';
  message: string;
  errorCode: number;
  /** Seconds to wait before sending the request again, when the server gave one. */
  retryAfter?: number;
  /** Structured context for the error, when the server sent any. */
  details?: Record<string, unknown>;
}

/**
 * A non-2xx response from a Sogni REST endpoint.
 *
 * `status` is the HTTP status and `payload` the error body. When the server
 * says how long to wait — a `429`, or a `503` during a restart — `retryAfter`
 * carries that wait in seconds, taken from the body or, failing that, from the
 * `Retry-After` header. Wait at least that long before retrying: a request sent
 * sooner is refused again. `details` carries any structured context the server
 * attached (for example the counts behind a capacity refusal).
 *
 * ```typescript
 * try {
 *   await sogni.workflows.start({ input });
 * } catch (error) {
 *   if (error instanceof ApiError && error.retryAfter !== undefined) {
 *     await new Promise((resolve) => setTimeout(resolve, error.retryAfter! * 1000));
 *     // ...then retry, reusing the same idempotencyKey.
 *   }
 * }
 * ```
 */
export class ApiError extends Error {
  status: number;
  payload: ApiErrorResponse;
  /** Seconds to wait before retrying. Absent when the server gave no wait. */
  retryAfter?: number;
  /** Structured context the server attached to the error, when present. */
  details?: Record<string, unknown>;
  /**
   * @param retryAfterHeader - The response's `Retry-After` header, used only
   * when the body carries no `retryAfter`.
   */
  constructor(status: number, payload: ApiErrorResponse, retryAfterHeader?: string | null) {
    super(payload.message);
    this.status = status;
    this.payload = payload;
    const extras = apiErrorExtras(payload);
    const retryAfter = extras.retryAfter ?? parseRetryAfterHeader(retryAfterHeader);
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
    if (extras.details) this.details = extras.details;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  socketUrl: string;
  appId: string;
  appSource?: string;
  attribution?: SogniAttributionConfig;
  socketEventSubscriptions?: SocketEventSubscriptions;
  networkType: SupernetType;
  logger: Logger;
  authType: 'token' | 'cookies' | 'apiKey';
  disableSocket?: boolean;
  multiInstance?: boolean;
}

class ApiClient extends TypedEventEmitter<ApiClientEvents> {
  readonly appId: string;
  readonly appSource?: string;
  readonly attribution: Readonly<{
    connection?: Readonly<NormalizedConnectionAttribution>;
    workload?: Readonly<WorkloadAttributionDefaults>;
  }>;
  readonly logger: Logger;
  private _rest: RestClient;
  private _socket: IWebSocketClient;
  private _auth: AuthManager;
  private _reconnectAttempt = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _onlineListener: (() => void) | null = null;
  private _disableSocket: boolean = false;

  constructor({
    baseUrl,
    socketUrl,
    appId,
    appSource,
    attribution,
    socketEventSubscriptions,
    networkType,
    authType,
    logger,
    disableSocket = false,
    multiInstance = false
  }: ApiClientOptions) {
    super();
    this.appId = appId;
    this.appSource = appSource?.trim() || undefined;
    const connectionAttribution = normalizeConnectionAttribution(attribution?.connection);
    this.attribution = Object.freeze({
      ...(connectionAttribution ? { connection: Object.freeze(connectionAttribution) } : {}),
      ...(attribution?.workload ? { workload: Object.freeze({ ...attribution.workload }) } : {})
    });
    this.logger = logger;
    if (authType === 'apiKey') {
      this._auth = new ApiKeyAuthManager(logger);
    } else if (authType === 'token') {
      this._auth = new TokenAuthManager(baseUrl, logger);
    } else {
      this._auth = new CookieAuthManager(logger);
    }
    this._rest = new RestClient(baseUrl, this._auth, logger);
    const supportMultiInstance = !isNodejs && this._auth instanceof CookieAuthManager;
    if (supportMultiInstance && multiInstance) {
      // Use coordinated WebSocket client to share single connection between tabs
      this._socket = new BrowserWebSocketClient(
        socketUrl,
        this._auth,
        appId,
        networkType,
        logger,
        this.appSource,
        socketEventSubscriptions,
        this.attribution.connection
      );
    } else {
      this._socket = new WebSocketClient(
        socketUrl,
        this._auth,
        appId,
        networkType,
        logger,
        this.appSource,
        socketEventSubscriptions,
        this.attribution.connection
      );
    }
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

  get socket(): IWebSocketClient {
    return this._socket;
  }

  get rest(): RestClient {
    return this._rest;
  }

  get socketEnabled(): boolean {
    return !this._disableSocket;
  }

  resolveWorkloadAttribution(override?: WorkloadAttributionInput, fallbackOperationId?: string) {
    return resolveWorkloadAttribution(this.attribution.workload, override, fallbackOperationId);
  }

  attributionHeaders(
    appSource: string | undefined,
    override?: WorkloadAttributionInput,
    fallbackOperationId?: string
  ): Record<string, string> {
    return buildSogniAttributionHeaders({
      appSource,
      connection: this.attribution.connection,
      workload: this.resolveWorkloadAttribution(override, fallbackOperationId)
    });
  }

  setSocketEventSubscriptions(update: SocketEventSubscriptionInput): Promise<void> {
    return this.socket.setSocketEventSubscriptions(update);
  }

  handleSocketConnecting() {
    this.emit('connecting', { network: this.socket.supernetType });
  }

  handleSocketConnect({ network }: ServerConnectData) {
    this._reconnectAttempt = 0;
    this._clearReconnect();
    this.emit('connected', { network });
  }

  handleSocketDisconnect(data: ServerDisconnectData) {
    // If user is not authenticated, we don't need to reconnect
    if (!this.auth.isAuthenticated || data.code === 1000) {
      this._clearReconnect();
      this.emit('disconnected', data);
      return;
    }
    if (!data.code || isNotRecoverable(data.code)) {
      // SWITCH_CONNECTION (4015) means another connection claimed our app-id.
      // In browser mode this is a tab handoff (the new primary tab took over).
      // In node/server mode (sogni-api pool) it happens when sogni-socket
      // boots a stale entry on reconnect or when the consumer pool is
      // rebuilding. In BOTH cases the auth token is still valid for REST
      // calls keyed off the same API key — clearing it would force a
      // re-login and break in-flight non-socket work for no benefit.
      //
      // Browser-side: signal disconnected so the coordinator handles tab
      // demotion, do nothing else (no auth clear, no reconnect that would
      // just trigger another 4015).
      //
      // Node-side: signal disconnected so consumers (e.g. sogni-api's
      // SogniClientSessionService) can invalidate their pool entry and
      // build a fresh client with a fresh nonced app-id on the next
      // acquire. Auto-reconnecting here with the same app-id would race
      // sogni-socket's boot-duplicate logic and end in another 4015 storm.
      if (data.code === ErrorCode.SWITCH_CONNECTION) {
        if (this._socket instanceof BrowserWebSocketClient) {
          this.logger.debug('Switching network connection (tab handoff), not reconnecting');
        } else {
          this.logger.warn(
            'SWITCH_CONNECTION (4015): another connection claimed our app-id; ' +
              'yielding without auth clear so consumer can invalidate + rebuild on next request',
            data
          );
        }
        this.emit('disconnected', data);
        return;
      }
      this.auth.clear();
      this.emit('disconnected', data);
      this.logger.error('Not recoverable socket error', data);
      return;
    }
    // Recoverable drop: keep trying with capped exponential backoff while the
    // session is authenticated. Consumers see `connecting` before each attempt;
    // `disconnected` is reserved for terminal outcomes.
    this._scheduleReconnect();
  }

  private _scheduleReconnect() {
    this._clearReconnect();
    const attempt = this._reconnectAttempt++;
    const base = Math.min(WS_RECONNECT_BASE_DELAY_MS * 2 ** attempt, WS_RECONNECT_MAX_DELAY_MS);
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.handleSocketConnecting();
    const connect = () => {
      this._reconnectTimer = null;
      if (!this.auth.isAuthenticated || this._disableSocket) return;
      this.socket.connect().catch((error) => {
        this.logger.warn('WebSocket reconnect attempt failed', error);
        this._scheduleReconnect();
      });
    };
    if (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      navigator.onLine === false
    ) {
      // Offline: a timer would only burn attempts. Wake up when the browser is back online.
      this._onlineListener = () => {
        this._onlineListener = null;
        connect();
      };
      window.addEventListener('online', this._onlineListener, { once: true });
      return;
    }
    this._reconnectTimer = setTimeout(connect, delay);
  }

  private _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._onlineListener && typeof window !== 'undefined') {
      window.removeEventListener('online', this._onlineListener);
      this._onlineListener = null;
    }
  }

  handleAuthUpdated(isAuthenticated: boolean) {
    if (!isAuthenticated) {
      this._clearReconnect();
      if (this.socket.isConnected) {
        this.socket.disconnect();
      }
    } else if (!this._disableSocket && !this.socket.isConnected) {
      this.handleSocketConnecting();
      void this.socket.connect();
    }
  }

  /**
   * Dispose of this client, disconnecting the socket and removing all event listeners.
   * After calling this method, the client should not be used.
   */
  dispose() {
    this._clearReconnect();
    this._socket.disconnect();
    this._socket.removeAllListeners();
    this._auth.removeAllListeners();
    this.removeAllListeners();
    this._auth.clear();
  }
}

export default ApiClient;
