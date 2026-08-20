import { MessageType, SocketMessageMap } from './messages.js';
import { SocketEventMap } from './events.js';
import RestClient from '../../lib/RestClient.js';
import { IWebSocketClient, SupernetType } from './types.js';
import WebSocket, { CloseEvent, ErrorEvent, MessageEvent } from 'isomorphic-ws';
import { base64Decode, base64Encode } from '../../lib/base64.js';
import isNodejs from '../../lib/isNodejs.js';
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

class WebSocketClient extends RestClient<SocketEventMap> implements IWebSocketClient {
  appId: string;
  appSource?: string;
  connectionAttribution?: NormalizedConnectionAttribution;
  baseUrl: string;
  socketEventSubscriptions?: SocketEventSubscriptions;
  private socket: WebSocket | null = null;
  private _supernetType: SupernetType;
  private _pingInterval: NodeJS.Timeout | null = null;

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
    socket.onerror = (e: ErrorEvent) => {
      this._logger.debug('WebSocket error while closing:', e?.message ?? e);
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

  /**
   * Ensure the WebSocket connection is open, waiting if necessary and throwing an error if it fails
   * @private
   */
  private async waitForConnection(): Promise<void> {
    if (!this.socket) {
      throw new Error('WebSocket not connected');
    }
    if (this.socket.readyState === WebSocket.OPEN) {
      return;
    }
    let attempts = 10;
    while (this.socket?.readyState === WebSocket.CONNECTING) {
      this._logger.info('Waiting for WebSocket connection...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts--;
      if (attempts === 0) {
        this.disconnect();
        throw new Error('WebSocket connection timeout');
      }
    }
    //@ts-expect-error State may change between checks
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.disconnect();
      throw new Error('WebSocket connection failed');
    }
  }

  private handleOpen() {
    this.emit('connected', { network: this._supernetType });
  }

  private handleClose(e: CloseEvent) {
    const socket = e.target;
    socket.onerror = null;
    socket.onmessage = null;
    socket.onopen = null;
    if (socket === this.socket || !this.socket) {
      this._logger.info('WebSocket disconnected, cleanup', e);
      if (socket === this.socket) {
        this.stopPing();
        this.socket = null;
      }
      this.emit('disconnected', {
        code: e.code,
        reason: e.reason
      });
    }
  }

  private handleError(e: ErrorEvent) {
    this._logger.error('WebSocket error:', e);
  }

  private handleMessage(e: MessageEvent) {
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
        this.emit(data.type, payload);
      })
      .catch((err: any) => {
        this._logger.error('Failed to parse WebSocket message:', err);
      });
  }

  async send<T extends MessageType>(messageType: T, data: SocketMessageMap[T]) {
    if (!this.isConnected) {
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
