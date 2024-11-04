import { MessageType, SocketMessageMap } from './messages';
import { SocketEventMap } from './events';
import RestClient, { AuthData } from '../../lib/RestClient';
import { SupernetType } from './types';
import WebSocket, { CloseEvent, ErrorEvent, MessageEvent } from 'isomorphic-ws';
import { base64Decode, base64Encode } from '../../lib/base64';
import isNodejs from '../../lib/isNodejs';
import Cookie from 'js-cookie';

class WebSocketClient extends RestClient<SocketEventMap> {
  appId: string;
  baseUrl: string;
  private socket: WebSocket | null = null;
  private _supernetType: SupernetType;

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
    const url = new URL(this.baseUrl);
    url.searchParams.set('appId', this.appId);
    url.searchParams.set('clientName', 'Sogni/3.0.22042');
    url.searchParams.set('clientType', 'artist');
    url.searchParams.set('forceWorkerId', this._supernetType);
    let params;
    // In Node.js, ws package is used, so we need to set the auth header
    if (isNodejs) {
      params = {
        headers: {
          Authorization: this._auth?.token
        }
      };
    }
    this.socket = new WebSocket(url.toString(), params);
    this.socket.onerror = this.handleError.bind(this);
    this.socket.onmessage = this.handleMessage.bind(this);
    this.socket.onopen = this.handleOpen.bind(this);
    this.socket.onclose = this.handleClose.bind(this);
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
    socket.close();
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
    const data = e.data as unknown as Blob;
    data
      .text()
      .then((str: string) => {
        const data = JSON.parse(str);
        let payload = null;
        if (data.data) {
          payload = JSON.parse(base64Decode(data.data));
        }

        console.log('WebSocket event:', data.type, payload);
        this.emit(data.type, payload);
      })
      .catch((err: any) => {
        console.error('Failed to parse WebSocket message:', err);
      });
    console.log('WebSocket message:', e);
  }

  async send<T extends MessageType>(messageType: T, data: SocketMessageMap[T]) {
    await this.waitForConnection();
    this.socket!.send(
      JSON.stringify({ type: messageType, data: base64Encode(JSON.stringify(data)) })
    );
  }
}

export default WebSocketClient;
