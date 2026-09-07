import { MessageType, SocketMessageMap } from './messages.js';
import { SocketEventMap } from './events.js';
import RestClient from '../../lib/RestClient.js';
import { IWebSocketClient, SupernetType } from './types.js';
import WebSocket, { CloseEvent, ErrorEvent, MessageEvent } from 'isomorphic-ws';
import { base64Decode, base64Encode } from '../../lib/base64.js';
import isNodejs from '../../lib/isNodejs.js';
import { isNotRecoverable } from './ErrorCode.js';
import { LIB_VERSION } from '../../version.js';
import { Logger } from '../../lib/DefaultLogger.js';
import { AuthManager } from '../../lib/AuthManager/index.js';
import {
  normalizeSocketEventSubscriptionUpdate,
  serializeSocketEventSubscriptions
} from './eventSubscriptions.js';
import type {
  SocketEventSubscriptionInput,
  SocketEventSubscriptions
} from './eventSubscriptions.js';
import {
  appendConnectionAttributionQuery,
  normalizeConnectionAttribution,
  type NormalizedConnectionAttribution
} from '../../lib/attribution.js';

const PROTOCOL_VERSION = '3.0.0';

const PING_INTERVAL = 15000;

/**
 * How long `send` waits for a socket that can carry work. Covers a socket
 * deploy (a ~6 s gap plus reconnect backoff) without hanging the caller on a
 * transport that is not coming back.
 */
const SEND_READY_TIMEOUT_MS = 30000;
/**
 * The server drops frames that arrive before its `authenticated` handshake.
 * Every current server sends that frame within milliseconds; if an open socket
 * stays silent this long, send anyway rather than stall on an older server.
 */
const AUTHENTICATED_FALLBACK_MS = 10000;
const READY_POLL_MS = 100;

class WebSocketClient extends RestClient<SocketEventMap> implements IWebSocketClient {
  appId: string;
  appSource?: string;
  connectionAttribution?: NormalizedConnectionAttribution;
  baseUrl: string;
  socketEventSubscriptions?: SocketEventSubscriptions;
  private socket: WebSocket | null = null;
  private _supernetType: SupernetType;
  private _pingInterval: NodeJS.Timeout | null = null;
  /** The socket the server has sent `authenticated` on, i.e. one that accepts work. */
  private _authenticatedSocket: WebSocket | null = null;
  private _openedAt = 0;
  /**
   * Set when the last close was recoverable while the session is
   * authenticated: the ApiClient owns the reconnect, so `send` waits for it
   * instead of racing it with a connection of its own (which would also reset
   * the reconnect backoff on every failed attempt).
   */
  private _reconnectExpected = false;

  constructor(
    baseUrl: string,
    auth: AuthManager,
    appId: string,
    supernetType: SupernetType,
    logger: Logger,
    appSource?: string,
    socketEventSubscriptions?: SocketEventSubscriptions,
    connectionAttribution?: NormalizedConnectionAttribution
  ) {
    const _baseUrl = new URL(baseUrl);
    switch (_baseUrl.protocol) {
      case 'http:':
      case 'ws:':
        _baseUrl.protocol = 'http:';
        break;
      case 'https:':
      case 'wss:':
        _baseUrl.protocol = 'https:';
        break;
      default:
        _baseUrl.protocol = 'https:';
    }
    super(_baseUrl.toString(), auth, logger);
    this.appId = appId;
    this.appSource = appSource?.trim() || undefined;
    this.connectionAttribution = normalizeConnectionAttribution(connectionAttribution);
    this.socketEventSubscriptions = socketEventSubscriptions;
    this.baseUrl = _baseUrl.toString();
    this._supernetType = supernetType;
    // Mirror the server's authoritative subscriptions snapshot so reconnects keep any
    // runtime updates applied via `setSocketEventSubscriptions` after the initial connect.
    this.on('socketEventSubscriptionsUpdated', (payload) => {
      if (payload && payload.socketEventSubscriptions) {
        this.socketEventSubscriptions = { ...payload.socketEventSubscriptions };
      }
    });
  }

  get supernetType(): SupernetType {
    return this._supernetType;
  }

  get isConnected(): boolean {
    return !!this.socket;
  }

  async connect() {
    if (this.socket) {
      this.disconnect();
    }
    this._reconnectExpected = false;
    this._authenticatedSocket = null;
    const userAgent = `Sogni/${PROTOCOL_VERSION} (sogni-client) ${LIB_VERSION}`;
    const url = new URL(this.baseUrl);
    const isNotSecure = url.protocol === 'http:' || url.protocol === 'ws:';
    url.protocol = isNotSecure ? 'ws:' : 'wss:';
    url.searchParams.set('appId', this.appId);
    if (this.appSource) {
      url.searchParams.set('appSource', this.appSource);
    }
    appendConnectionAttributionQuery(url, this.connectionAttribution);
    const socketEventSubscriptions = serializeSocketEventSubscriptions(
      this.socketEventSubscriptions
    );
    if (socketEventSubscriptions) {
      url.searchParams.set('socketEventSubscriptions', socketEventSubscriptions);
    }
    url.searchParams.set('clientName', userAgent);
    url.searchParams.set('clientType', 'artist');
    //At this point 'relaxed' does not work as expected, so we use 'fast' or empty
    url.searchParams.set('forceWorkerId', this._supernetType === 'fast' ? 'fast' : '');
    const params = await this.auth.socketOptions();
    this.socket = new WebSocket(url.toString(), params);
    this.socket.onerror = this.handleError.bind(this);
    this.socket.onmessage = this.handleMessage.bind(this);
    this.socket.onopen = this.handleOpen.bind(this);
    this.socket.onclose = this.handleClose.bind(this);
    this.startPing(this.socket);
  }

  disconnect() {
    if (!this.socket) {
      return;
    }
    const socket = this.socket;
    this.socket = null;
    socket.onmessage = null;
    socket.onopen = null;
    // Keep an error handler attached across close(). Closing a socket that is
    // still CONNECTING makes `ws` emit 'error' ("WebSocket was closed before the
    // connection was established"), and an 'error' event with no listener is
    // rethrown by EventEmitter, which takes the whole host process down. That is
    // reachable from any dispose() that lands before the handshake completes.
    // Log at debug, not error: tearing down a pending connection is expected.
    socket.onerror = () => {
      this._logger.debug('WebSocket error while closing a pending connection');
    };
    this.stopPing();
    socket.close(1000, 'Client disconnected');
  }

  private startPing(socket: WebSocket) {
    if (!isNodejs) {
      return;
    }
    this._pingInterval = setInterval(() => {
      socket.ping();
    }, PING_INTERVAL);
  }

  private stopPing() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  switchNetwork(supernetType: SupernetType): Promise<SupernetType> {
    return new Promise<SupernetType>(async (resolve) => {
      this.once('changeNetwork', ({ network }) => {
        this._supernetType = network;
        resolve(network);
      });
      await this.send('changeNetwork', supernetType);
    });
  }

  async setSocketEventSubscriptions(update: SocketEventSubscriptionInput): Promise<void> {
    const normalizedUpdate = normalizeSocketEventSubscriptionUpdate(update);
    await this.send('setSocketEventSubscriptions', normalizedUpdate);
  }

  /** The current socket is open and the server has accepted it for work. */
  private isReadyForWork(): boolean {
    return (
      !!this.socket &&
      this.socket.readyState === WebSocket.OPEN &&
      this._authenticatedSocket === this.socket
    );
  }

  /**
   * Wait until the socket can carry work. An open socket is not enough: the
   * server drops frames that arrive before its `authenticated` handshake. A
   * recoverable close (a socket deploy, a network blip) keeps the wait alive
   * while the ApiClient reconnects, so work submitted during the gap goes out
   * on the next connection instead of failing. A terminal close, a signed-out
   * session, or the deadline ends it.
   * @private
   */
  private waitForConnection(timeoutMs = SEND_READY_TIMEOUT_MS): Promise<void> {
    if (this.isReadyForWork()) return Promise.resolve();
    if (!this.socket && !this._reconnectExpected) {
      return Promise.reject(new Error('WebSocket not connected'));
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        clearInterval(poll);
        offAuthenticated();
        offDisconnected();
        if (error) reject(error);
        else resolve();
      };
      const deadline = setTimeout(
        () => finish(new Error('WebSocket connection timeout')),
        timeoutMs
      );
      const poll = setInterval(() => {
        if (this.isReadyForWork()) {
          finish();
        } else if (
          this.socket?.readyState === WebSocket.OPEN &&
          Date.now() - this._openedAt >= AUTHENTICATED_FALLBACK_MS
        ) {
          finish();
        }
      }, READY_POLL_MS);
      const offAuthenticated = this.on('authenticated', () => {
        if (this.isReadyForWork()) finish();
      });
      const offDisconnected = this.on('disconnected', () => {
        if (!this._reconnectExpected) finish(new Error('WebSocket connection failed'));
      });
    });
  }

  private handleOpen() {
    this._openedAt = Date.now();
    this.emit('connected', { network: this._supernetType });
  }

  private handleClose(e: CloseEvent) {
    const socket = e.target;
    socket.onerror = null;
    socket.onmessage = null;
    socket.onopen = null;
    if (socket === this.socket || !this.socket) {
      this._logger.info('WebSocket disconnected, cleanup', { code: e.code, wasClean: e.wasClean });
      if (socket === this.socket) {
        this.stopPing();
        this.socket = null;
      }
      this._authenticatedSocket = null;
      this._reconnectExpected =
        this.auth.isAuthenticated && !!e.code && e.code !== 1000 && !isNotRecoverable(e.code);
      this.emit('disconnected', {
        code: e.code,
        reason: e.reason
      });
    }
  }

  private handleError(e: ErrorEvent) {
    // Node's ws ErrorEvent retains the ClientRequest, including authentication
    // headers. Never send the event, target, request, stack or raw message to a
    // logger. Preserve only the bounded HTTP upgrade status when available.
    const match =
      typeof e.message === 'string'
        ? /^Unexpected server response: (\d{3})$/.exec(e.message)
        : null;
    this._logger.error('WebSocket connection error', match ? { status: Number(match[1]) } : {});
  }

  private handleMessage(e: MessageEvent) {
    const source = e.target;
    let dataPromise: Promise<string>;
    // In Node.js, e.data is a Buffer, while in browser it's a Blob
    if (isNodejs) {
      dataPromise = Promise.resolve(e.data.toString());
    } else {
      const data = e.data as unknown as Blob;
      dataPromise = data.text();
    }
    dataPromise
      .then((str: string) => {
        const data = JSON.parse(str);
        let payload = null;
        if (data.data) {
          payload = JSON.parse(base64Decode(data.data));
        }
        // Convert jobID and imgID to uppercase for consistency
        ['jobID', 'imgID'].forEach((idKey) => {
          if (payload[idKey]) {
            payload[idKey] = payload[idKey].toUpperCase();
          }
        });
        this._logger.debug('WebSocket:', data.type, payload);
        if (data.type === 'authenticated' && source === this.socket) {
          this._authenticatedSocket = this.socket;
        }
        this.emit(data.type, payload);
      })
      .catch((err: any) => {
        this._logger.error('Failed to parse WebSocket message:', err);
      });
  }

  async send<T extends MessageType>(messageType: T, data: SocketMessageMap[T]) {
    if (!this.isConnected && !this._reconnectExpected) {
      await this.connect();
    }
    await this.waitForConnection();
    this._logger.debug('WebSocket send:', messageType, data);
    this.socket!.send(
      JSON.stringify({ type: messageType, data: base64Encode(JSON.stringify(data)) })
    );
  }
}

export default WebSocketClient;
