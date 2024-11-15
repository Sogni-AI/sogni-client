import { MessageType, SocketMessageMap } from './messages';
import { SocketEventMap } from './events';
import RestClient, { AuthData } from '../../lib/RestClient';
import { SupernetType } from './types';
import WebSocket, { CloseEvent, ErrorEvent, MessageEvent } from 'isomorphic-ws';
import { base64Decode, base64Encode } from '../../lib/base64';
import isNodejs from '../../lib/isNodejs';
import Cookie from 'js-cookie';
import { LIB_VERSION } from '../../version';

const PING_INTERVAL = 15000;

class WebSocketClient extends RestClient<SocketEventMap> {
  appId: string;
  baseUrl: string;
  private socket: WebSocket | null = null;
  private _supernetType: SupernetType;
  private _pingInterval: NodeJS.Timeout | null = null;

  constructor(baseUrl: string, appId: string, supernetType: SupernetType = 'fast') {
    super(baseUrl);
    this.appId = appId;
    this.baseUrl = baseUrl;
    this._supernetType = supernetType;
  }

  set auth(auth: AuthData | null) {
    //In browser, set the cookie
    if (!isNodejs) {
      if (auth) {
        Cookie.set('authorization', auth.token, {
          domain: '.sogni.ai',
          expires: 1
        });
      } else {
        Cookie.remove('authorization', {
          domain: '.sogni.ai'
        });
      }
    }
    this._auth = auth;
  }

  get supernetType(): SupernetType {
    return this._supernetType;
  }

  get isConnected(): boolean {
    return !!this.socket;
  }

  connect() {
    if (this.socket) {
      this.disconnect();
    }
    const userAgent = `Sogni/${LIB_VERSION} (sogni-client)`;
    const url = new URL(this.baseUrl);
    url.searchParams.set('appId', this.appId);
    url.searchParams.set('clientName', userAgent);
    url.searchParams.set('clientType', 'artist');
    //At this point 'relaxed' does not work as expected, so we use 'fast' or empty
    url.searchParams.set('forceWorkerId', this._supernetType === 'fast' ? 'fast' : '');
    let params;
    // In Node.js, ws package is used, so we need to set the auth header
    if (isNodejs) {
      params = {
        headers: {
          Authorization: this._auth?.token,
          'User-Agent': userAgent
        }
      };
    }
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
    socket.onerror = null;
    socket.onmessage = null;
    socket.onopen = null;
    this.stopPing();
    socket.close();
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

  switchNetwork(supernetType: SupernetType) {
    this._supernetType = supernetType;
    this.disconnect();
    this.connect();
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
      console.info('Waiting for WebSocket connection...');
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
    if (e.target === this.socket) {
      console.info('WebSocket disconnected, cleanup', e);
      this.disconnect();
      this.emit('disconnected', {
        code: e.code,
        reason: e.reason
      });
    }
  }

  private handleError(e: ErrorEvent) {
    console.error('WebSocket error:', e);
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
        console.log('WebSocket message:', data.type, payload);
        this.emit(data.type, payload);
      })
      .catch((err: any) => {
        console.error('Failed to parse WebSocket message:', err);
      });
  }

  async send<T extends MessageType>(messageType: T, data: SocketMessageMap[T]) {
    await this.waitForConnection();
    this.socket!.send(
      JSON.stringify({ type: messageType, data: base64Encode(JSON.stringify(data)) })
    );
  }
}

export default WebSocketClient;
