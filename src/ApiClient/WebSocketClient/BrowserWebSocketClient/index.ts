import { IWebSocketClient, SupernetType } from '../types';
import { AuthManager, TokenAuthManager } from '../../../lib/AuthManager';
import { Logger } from '../../../lib/DefaultLogger';
import WebSocketClient from '../index';
import RestClient from '../../../lib/RestClient';
import { ServerDisconnectData, SocketEventMap } from '../events';
import WSCoordinator from './WSCoordinator';
import { MessageType, SocketMessageMap } from '../messages';
import { Heartbeat, SocketEventReceived, SendSocketMessage } from './types';

type EventInterceptor<T extends keyof SocketEventMap = keyof SocketEventMap> = (
  eventType: T,
  payload: SocketEventMap[T]
) => void;

class WrappedClient extends WebSocketClient {
  private interceptor: EventInterceptor | undefined = undefined;
  intercept(interceptor: EventInterceptor) {
    this.interceptor = interceptor;
  }
  protected emit<T extends keyof SocketEventMap>(event: T, data: SocketEventMap[T]) {
    super.emit(event, data);
    if (this.interceptor) {
      this.interceptor(event, data);
    }
  }
}

class BrowserWebSocketClient extends RestClient<SocketEventMap> implements IWebSocketClient {
  appId: string;
  baseUrl: string;
  private socketClient: WrappedClient;
  private coordinator: WSCoordinator;
  private isPrimary = false;
  private _isConnected = false;
  private _supernetType: SupernetType;

  constructor(
    baseUrl: string,
    auth: AuthManager,
    appId: string,
    supernetType: SupernetType,
    logger: Logger
  ) {
    const socketClient = new WrappedClient(baseUrl, auth, appId, supernetType, logger);
    super(socketClient.baseUrl, auth, logger);
    this.socketClient = socketClient;
    this.appId = appId;
    this.baseUrl = socketClient.baseUrl;
    this._supernetType = supernetType;
    this.coordinator = new WSCoordinator(
      {
        onAuthChanged: this.handleAuthChanged.bind(this),
        onRoleChange: this.handleRoleChange.bind(this),
        onConnectionToggle: this.handleConnectionToggle.bind(this),
        onMessageFromPrimary: this.handleMessageFromPrimary.bind(this),
        onSendRequest: this.handleSendRequest.bind(this)
      },
      logger
    );
    this.auth.on('updated', this.handleAuthUpdated.bind(this));
    this.socketClient.intercept(this.handleSocketEvent.bind(this));
  }

  get isConnected() {
    return this.isPrimary ? this.socketClient.isConnected : this._isConnected;
  }

  get supernetType() {
    return this.isPrimary ? this.socketClient.supernetType : this._supernetType;
  }

  async connect(): Promise<void> {
    const isPrimary = await this.coordinator.initialize();
    this.isPrimary = isPrimary;
    if (isPrimary) {
      await this.socketClient.connect();
    } else {
      this.coordinator.connect();
    }
  }

  disconnect() {
    if (this.isPrimary) {
      this.socketClient.disconnect();
    } else {
      this.coordinator.disconnect();
    }
  }

  async switchNetwork(supernetType: SupernetType): Promise<SupernetType> {
    if (this.isPrimary) {
      return this.socketClient.switchNetwork(supernetType);
    }
    return new Promise<SupernetType>(async (resolve) => {
      this.once('changeNetwork', ({ network }) => {
        this._supernetType = network;
        resolve(network);
      });
      await this.send('changeNetwork', supernetType);
    });
  }

  async send<T extends MessageType>(messageType: T, data: SocketMessageMap[T]): Promise<void> {
    if (this.isPrimary) {
      return this.socketClient.send(messageType, data);
    }
    return this.coordinator.sendToSocket(messageType, data);
  }

  private handleAuthChanged(isAuthenticated: boolean) {
    if (this.auth instanceof TokenAuthManager) {
      throw new Error('TokenAuthManager is not supported in multi client mode');
    }
    if (this.auth.isAuthenticated !== isAuthenticated) {
      if (isAuthenticated) {
        this.auth.authenticate();
      } else {
        this.auth.clear();
      }
    }
  }

  private handleSocketEvent(eventType: keyof SocketEventMap, payload: any) {
    if (this.isPrimary) {
      this.coordinator.broadcastSocketEvent(eventType, payload);
      this.emit(eventType, payload);
    }
  }

  private handleAuthUpdated(isAuthenticated: boolean) {
    this.coordinator.changeAuthState(isAuthenticated);
  }

  private handleRoleChange(isPrimary: boolean) {
    this.isPrimary = isPrimary;
    if (isPrimary && !this.socketClient.isConnected && this.isConnected) {
      this.socketClient.connect();
    } else if (!isPrimary && this.socketClient.isConnected) {
      this.socketClient.disconnect();
    }
  }

  private handleConnectionToggle(isConnected: boolean) {
    if (this.isPrimary) {
      if (isConnected && !this.socketClient.isConnected) {
        this.socketClient.connect();
      } else if (!isConnected && this.socketClient.isConnected) {
        this.socketClient.disconnect();
      }
    }
  }

  /**
   * Emit events from socket to listeners
   * @param message
   */
  private handleMessageFromPrimary(message: SocketEventReceived | Heartbeat) {
    if (this.isPrimary) {
      throw new Error('Received message from primary socket, but it is primary');
    }
    this._logger.debug('Received message from primary client:', message.type, message.payload);
    if (message.type === 'primary-present') {
      const shouldUpdateStatus = message.payload.connected !== this._isConnected;
      if (shouldUpdateStatus) {
        this._isConnected = message.payload.connected;
        if (message.payload.connected) {
          this._logger.debug('Primary socket is active emitting connected event');
          this.emit('connected', { network: this._supernetType });
        } else {
          this._logger.debug('Primary socket is inactive emitting disconnected event');
          this.emit('disconnected', { code: 5000, reason: 'Primary socket disconnected' });
        }
      }
      return;
    }
    const event = message.payload;
    switch (event.eventType) {
      case 'connected': {
        if (!this._isConnected) {
          this._isConnected = true;
          this.emit('connected', { network: this._supernetType });
        }
        return;
      }
      case 'disconnected': {
        this._isConnected = false;
        this.emit('disconnected', event.payload as ServerDisconnectData);
        return;
      }
      default: {
        this.emit(event.eventType, event.payload as any);
      }
    }
  }

  private handleSendRequest(message: SendSocketMessage) {
    if (!this.isPrimary) {
      // Should never happen, but just in case
      return Promise.resolve();
    }
    return this.socketClient.send(message.payload.messageType, message.payload.data);
  }
}

export default BrowserWebSocketClient;
