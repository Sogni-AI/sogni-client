import { IWebSocketClient, SupernetType } from '../types.js';
import {
  AuthManager,
  CookieAuthManager,
  TokenAuthManager
} from '../../../lib/AuthManager/index.js';
import { Logger } from '../../../lib/DefaultLogger.js';
import WebSocketClient from '../index.js';
import RestClient from '../../../lib/RestClient.js';
import { SocketEventMap } from '../events.js';
import { MessageType, SocketMessageMap } from '../messages.js';
import ChannelCoordinator from './ChannelCoordinator.js';
import type {
  SocketEventSubscriptionInput,
  SocketEventSubscriptions
} from '../eventSubscriptions.js';

interface SocketSend<T extends MessageType = MessageType> {
  type: 'socket-send';
  payload: { type: T; data: SocketMessageMap[T] };
}

interface SocketConnect {
  type: 'connect';
}

interface SocketDisconnect {
  type: 'disconnect';
}

interface SwitchNetwork {
  type: 'switchNetwork';
  payload: SupernetType;
}

interface SetSocketEventSubscriptions {
  type: 'setSocketEventSubscriptions';
  payload: SocketEventSubscriptionInput;
}

type Message =
  | SocketConnect
  | SocketDisconnect
  | SocketSend
  | SwitchNetwork
  | SetSocketEventSubscriptions;

interface EventNotification<T extends keyof SocketEventMap = keyof SocketEventMap> {
  type: 'socket-event';
  payload: { type: T; data: SocketEventMap[T] };
}

interface AuthStateChanged {
  type: 'auth-state-changed';
  payload: boolean;
}

type Notification = EventNotification | AuthStateChanged;

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
  private coordinator: ChannelCoordinator<Message, Notification>;
  // Tracks whether the consumer (ApiClient + auth) wants the shared socket to
  // be open. Secondary tabs don't own the WebSocket directly, so they answer
  // `isConnected` from this flag; primaries answer from the live socket.
  // Also used so that a tab promoted to primary on legitimate primary death
  // actually rebinds its WebSocket (`handleRoleChange(true)`).
  private _wantConnected = false;
  private _supernetType: SupernetType;
  // Last balanceUpdate the primary observed. Socket events are only forwarded
  // to secondaries live, so a tab that joins after the balance arrived would
  // otherwise sit on CurrentAccount's default zero-balance object. Cached here
  // so the primary can replay it when a secondary (re)connects.
  private _lastBalanceUpdate: SocketEventMap['balanceUpdate'] | null = null;
  // Last swarmModels the primary observed. The Projects API builds
  // `availableModels` purely from this live event, so a late-joining tab would
  // show an empty model picker until the next server broadcast — which can be
  // a long wait, since the server skips swarmModels for artists that have
  // active jobs. Cached and replayed like the balance snapshot.
  private _lastSwarmModels: SocketEventMap['swarmModels'] | null = null;
  // Last subscription entitlement snapshot observed on the primary tab. Replayed
  // to late-joining secondaries so CurrentAccount reflects purchases made after
  // the shared socket originally connected.
  private _lastSubscriptionEntitlement: SocketEventMap['subscriptionEntitlementUpdated'] | null =
    null;

  constructor(
    baseUrl: string,
    auth: AuthManager,
    appId: string,
    supernetType: SupernetType,
    logger: Logger,
    appSource?: string,
    socketEventSubscriptions?: SocketEventSubscriptions
  ) {
    const socketClient = new WrappedClient(
      baseUrl,
      auth,
      appId,
      supernetType,
      logger,
      appSource,
      socketEventSubscriptions
    );
    super(socketClient.baseUrl, auth, logger);
    this.socketClient = socketClient;
    this.appId = appId;
    this.baseUrl = socketClient.baseUrl;
    this._supernetType = supernetType;
    this.coordinator = new ChannelCoordinator({
      callbacks: {
        onRoleChange: this.handleRoleChange.bind(this),
        onMessage: this.handleMessage.bind(this),
        onNotification: this.handleNotification.bind(this)
      },
      logger
    });
    this.auth.on('updated', this.handleAuthUpdated.bind(this));
    this.socketClient.intercept(this.handleSocketEvent.bind(this));
    // Keep this tab's WrappedClient subscription state in sync with the server's authoritative
    // snapshot, even when this tab is currently a secondary. If we get promoted to primary, the
    // next `connect()` will serialize the up-to-date state into the URL query string.
    this.on('socketEventSubscriptionsUpdated', (payload) => {
      if (payload && payload.socketEventSubscriptions) {
        this.socketClient.socketEventSubscriptions = { ...payload.socketEventSubscriptions };
      }
    });
  }

  get isConnected() {
    return this.coordinator.isPrimary ? this.socketClient.isConnected : this._wantConnected;
  }

  get supernetType() {
    return this.coordinator.isPrimary ? this.socketClient.supernetType : this._supernetType;
  }

  async connect(): Promise<void> {
    this._wantConnected = true;
    await this.coordinator.isReady();
    if (this.coordinator.isPrimary) {
      await this.socketClient.connect();
    } else {
      return this.coordinator.sendMessage({
        type: 'connect'
      });
    }
  }

  async disconnect() {
    this._wantConnected = false;
    await this.coordinator.isReady();
    if (this.coordinator.isPrimary) {
      this.socketClient.disconnect();
    } else {
      this.coordinator.sendMessage({
        type: 'disconnect'
      });
    }
  }

  async switchNetwork(supernetType: SupernetType): Promise<SupernetType> {
    await this.coordinator.isReady();
    if (this.coordinator.isPrimary) {
      return this.socketClient.switchNetwork(supernetType);
    }
    await this.coordinator.sendMessage({
      type: 'switchNetwork',
      payload: supernetType
    });
    this._supernetType = supernetType;
    return supernetType;
  }

  async setSocketEventSubscriptions(update: SocketEventSubscriptionInput): Promise<void> {
    await this.coordinator.isReady();
    if (this.coordinator.isPrimary) {
      return this.socketClient.setSocketEventSubscriptions(update);
    }
    return this.coordinator.sendMessage({
      type: 'setSocketEventSubscriptions',
      payload: update
    });
  }

  async send<T extends MessageType>(messageType: T, data: SocketMessageMap[T]): Promise<void> {
    await this.coordinator.isReady();
    if (this.coordinator.isPrimary) {
      if (!this.socketClient.isConnected) {
        await this.socketClient.connect();
      }
      return this.socketClient.send(messageType, data);
    }
    return this.coordinator.sendMessage({
      type: 'socket-send',
      payload: { type: messageType, data }
    });
  }

  private async handleMessage(message: Message) {
    this._logger.debug('Received control message', message);
    switch (message.type) {
      case 'socket-send': {
        if (!this.socketClient.isConnected) {
          await this.socketClient.connect();
        }
        return this.socketClient.send(message.payload.type, message.payload.data);
      }
      case 'connect': {
        if (!this.socketClient.isConnected) {
          await this.socketClient.connect();
        } else {
          // Socket is already open under this primary, so connecting is a
          // no-op and fires no fresh 'connected' event. A secondary tab that
          // joined after the primary was already connected would otherwise
          // never learn the live state: its CurrentAccount stays stuck at the
          // construction-time 'disconnected' default and the app shows an
          // "offline" banner. (Before we stopped forcing a primary handoff on
          // every new tab, the handoff's reconnect emitted this event for
          // free.) Replay current status so the requesting tab syncs.
          this.coordinator.notify({
            type: 'socket-event',
            payload: {
              type: 'connected',
              data: { network: this.socketClient.supernetType }
            }
          });
          // Same live-only forwarding applies to balance: replay the last
          // value the primary saw, or the joining tab keeps the default
          // zero-balance object until the next live balanceUpdate.
          if (this._lastBalanceUpdate) {
            this.coordinator.notify({
              type: 'socket-event',
              payload: { type: 'balanceUpdate', data: this._lastBalanceUpdate }
            });
          }
          // Likewise replay the model availability snapshot so the joining
          // tab's model picker is populated immediately instead of empty.
          if (this._lastSwarmModels) {
            this.coordinator.notify({
              type: 'socket-event',
              payload: { type: 'swarmModels', data: this._lastSwarmModels }
            });
          }
          if (this._lastSubscriptionEntitlement) {
            this.coordinator.notify({
              type: 'socket-event',
              payload: {
                type: 'subscriptionEntitlementUpdated',
                data: this._lastSubscriptionEntitlement
              }
            });
          }
        }
        return;
      }
      case 'disconnect': {
        if (this.socketClient.isConnected) {
          this.socketClient.disconnect();
        }
        return;
      }
      case 'switchNetwork': {
        await this.switchNetwork(message.payload);
        return;
      }
      case 'setSocketEventSubscriptions': {
        await this.socketClient.setSocketEventSubscriptions(message.payload);
        return;
      }
      default: {
        this._logger.error('Received unknown message type:', message);
      }
    }
  }

  private async handleNotification(notification: Notification) {
    this._logger.debug('Received notification', notification.type, notification.payload);
    switch (notification.type) {
      case 'socket-event': {
        this.emit(notification.payload.type, notification.payload.data);
        return;
      }
      case 'auth-state-changed': {
        this.handleAuthChanged(notification.payload);
        return;
      }
      default: {
        this._logger.error('Received unknown notification type:', notification);
      }
    }
  }

  private handleAuthChanged(isAuthenticated: boolean) {
    if (this.auth instanceof TokenAuthManager) {
      throw new Error('TokenAuthManager is not supported in multi client mode');
    }
    if (this.auth.isAuthenticated !== isAuthenticated) {
      if (isAuthenticated && this.auth instanceof CookieAuthManager) {
        this.auth.authenticate();
      } else if (!isAuthenticated) {
        this.auth.clear();
      }
    }
  }

  private handleSocketEvent(eventType: keyof SocketEventMap, payload: any) {
    if (this.coordinator.isPrimary) {
      if (eventType === 'balanceUpdate') {
        this._lastBalanceUpdate = payload;
      } else if (eventType === 'swarmModels') {
        this._lastSwarmModels = payload;
      } else if (eventType === 'subscriptionEntitlementUpdated') {
        this._lastSubscriptionEntitlement = payload;
      } else if (eventType === 'authenticated' && payload?.subscriptionEntitlement) {
        this._lastSubscriptionEntitlement = payload.subscriptionEntitlement;
      }
      this.coordinator.notify({
        type: 'socket-event',
        payload: { type: eventType, data: payload }
      });
      this.emit(eventType, payload);
    }
  }

  private handleAuthUpdated(isAuthenticated: boolean) {
    this.coordinator.notify({
      type: 'auth-state-changed',
      payload: isAuthenticated
    });
  }

  private handleRoleChange(isPrimary: boolean) {
    // Promoted to primary (e.g. previous primary died and we won the
    // re-election): if the consumer wants the session open, open the
    // underlying WebSocket. Without this, the new primary stays silent until
    // somebody calls send(), which auto-connects — but if the consumer never
    // explicitly sends, no socket ever opens and the session goes dark.
    if (isPrimary && !this.socketClient.isConnected && this._wantConnected) {
      this.socketClient.connect();
    } else if (!isPrimary && this.socketClient.isConnected) {
      this.socketClient.disconnect();
    }
  }
}

export default BrowserWebSocketClient;
