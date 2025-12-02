import { Logger } from '../../../lib/DefaultLogger';
import getUUID from '../../../lib/getUUID';
import { AuthenticatedData, SocketEventMap, SocketEventName } from '../events';
import { MessageType, SocketMessageMap } from '../messages';
import { Balances } from '../../../Account/types';
import {
  ChannelMessage,
  Heartbeat,
  MessageEnvelope,
  SocketEventReceived,
  SendSocketMessage
} from './types';

interface StartingEvents {
  authenticated?: AuthenticatedData;
  balanceUpdate?: Balances;
  swarmModels?: Record<string, number>;
}

interface WSCoordinatorCallbacks {
  /**
   * Invoked when authentication state changes (authenticated/unauthenticated).
   * @param isAuthenticated - true if client is authenticated, false if not.
   */
  onAuthChanged: (isAuthenticated: boolean) => void;
  /**
   * Invoked when role changes (primary/secondary).
   * @param isPrimary - true if client is primary, false if secondary.
   */
  onRoleChange: (isPrimary: boolean) => void;
  /**
   * Invoked when connection state must change (connected/disconnected).
   * @param isConnected
   */
  onConnectionToggle: (isConnected: boolean) => void;
  /**
   * Invoked when secondary client receives a socket event from primary.
   * @param message
   */
  onMessageFromPrimary: (message: SocketEventReceived | Heartbeat) => void;
  /**
   * Invoked when primary client receives a socket send request from secondary.
   * @param message
   */
  onSendRequest: (message: SendSocketMessage) => Promise<void>;
}

class WSCoordinator {
  private static readonly HEARTBEAT_INTERVAL = 2000;
  private static readonly PRIMARY_TIMEOUT = 5000;
  private static readonly CHANNEL_NAME = 'sogni-websocket-clients';
  private static readonly ACK_TIMEOUT = 5000;

  private id: string;
  private callbacks: WSCoordinatorCallbacks;
  private channel: BroadcastChannel;
  private _isPrimary: boolean;
  private _isConnected = false;
  private lastPrimaryHeartbeat: number = 0;
  private logger: Logger;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private primaryCheckInterval: NodeJS.Timeout | null = null;
  private startingEvents: StartingEvents = {};
  private ackCallbacks: Record<string, (error?: any) => void> = {};
  private initialized = false;

  constructor(callbacks: WSCoordinatorCallbacks, logger: Logger) {
    this.id = getUUID();
    this.logger = logger;
    this.callbacks = callbacks;
    this.channel = new BroadcastChannel(WSCoordinator.CHANNEL_NAME);
    this.channel.onmessage = this.handleMessage.bind(this);
    this._isPrimary = false;

    // Listen for tab closing to gracefully release primary role
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    }
  }

  /**
   * Initialize tab coordination and determine role
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return this._isPrimary;
    }
    this.initialized = true;
    this.logger.info(`WSCoordinator ${this.id} initializing...`);
    // Announce our presence
    this.broadcast({
      type: 'announce'
    });

    // Wait to see if there's an existing primary
    await this.waitForPrimaryResponse();
    if (!this._isPrimary) {
      this.logger.info(`Client ${this.id} is secondary, primary exists`);
      this.startPrimaryCheck();
    } else {
      this.logger.info(`Client ${this.id} becoming primary`);
      this.stopPrimaryCheck();
      this.becomePrimary();
    }

    return this._isPrimary;
  }

  connect() {
    if (this._isPrimary) {
      throw new Error('Primary should connect the socket directly.');
    }
    this.broadcast({
      type: 'connection-toggle',
      payload: { connected: true }
    });
  }

  disconnect() {
    if (this._isPrimary) {
      throw new Error('Primary should disconnect socket directly.');
    }
    this.broadcast({
      type: 'connection-toggle',
      payload: { connected: false }
    });
  }

  async changeAuthState(isAuthenticated: boolean) {
    this.broadcast({
      type: 'authentication',
      payload: { authenticated: isAuthenticated }
    });
  }

  /**
   * Wait briefly to see if a primary tab responds
   */
  private waitForPrimaryResponse(): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // No primary responded, we become primary
        this._isPrimary = true;
        resolve();
      }, 500);

      const messageHandler = (e: MessageEvent<MessageEnvelope>) => {
        const envelope = e.data;
        const message = envelope.payload;
        if (message.type === 'primary-present' || message.type === 'primary-claim') {
          // Primary exists
          this._isPrimary = false;
          this.lastPrimaryHeartbeat = envelope.timestamp;
          clearTimeout(timeout);
          this.channel.removeEventListener('message', messageHandler);
          resolve();
        }
      };

      this.channel.addEventListener('message', messageHandler);
    });
  }

  /**
   * Become the primary tab
   */
  private becomePrimary() {
    this._isPrimary = true;
    this.callbacks.onRoleChange(true);

    // Broadcast that we're claiming primary role
    this.broadcast({
      type: 'primary-claim'
    });

    // Start sending heartbeats
    this.startHeartbeat();
  }

  /**
   * Release primary role (when closing)
   */
  private releasePrimary() {
    if (this._isPrimary) {
      this.broadcast({
        type: 'primary-release'
      });
      this.stopHeartbeat();
    }
  }

  /**
   * Start sending heartbeat messages as primary
   */
  private startHeartbeat() {
    if (this.heartbeatInterval) {
      throw new Error('Heartbeat interval already started. This should never happen.');
    }
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({
        type: 'primary-present',
        payload: { connected: this._isConnected }
      });
    }, WSCoordinator.HEARTBEAT_INTERVAL);
  }

  /**
   * Stop sending heartbeat messages
   */
  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Start checking for primary heartbeat (as secondary)
   */
  private startPrimaryCheck() {
    this.primaryCheckInterval = setInterval(() => {
      const timeSinceLastHeartbeat = Date.now() - this.lastPrimaryHeartbeat;
      if (timeSinceLastHeartbeat > WSCoordinator.PRIMARY_TIMEOUT) {
        this.logger.warn(`Primary tab timeout, becoming primary`);
        this.stopPrimaryCheck();
        this.becomePrimary();
      }
    }, 1000);
  }

  /**
   * Stop checking for primary heartbeat
   */
  private stopPrimaryCheck() {
    if (this.primaryCheckInterval) {
      clearInterval(this.primaryCheckInterval);
      this.primaryCheckInterval = null;
    }
  }

  private handleMessage(e: MessageEvent<MessageEnvelope>) {
    const envelope = e.data;
    const message = envelope.payload;
    // If a message sent to specific recipient and not to us, ignore it
    if (!!envelope.recipientId && envelope.recipientId !== this.id) {
      return;
    }
    switch (message.type) {
      case 'announce':
        if (this._isPrimary) {
          this.broadcast({
            type: 'primary-present',
            payload: { connected: this._isConnected }
          });
          // Re-broadcast starting events for the new tab
          Object.entries(this.startingEvents).forEach(([eventType, payload]) => {
            this.broadcast(
              {
                type: 'socket-event',
                payload: { eventType: eventType as SocketEventName, payload }
              },
              envelope.senderId
            );
          });
        }
        return;
      case 'primary-claim':
      case 'primary-present':
        this.lastPrimaryHeartbeat = envelope.timestamp;
        if (this._isPrimary) {
          this.logger.info(`Stepping down from primary, ${envelope.senderId} claimed it`);
          this.stopHeartbeat();
          this._isPrimary = false;
          this.callbacks.onRoleChange(false);
          this.startPrimaryCheck();
        }
        return;
      case 'primary-release':
        if (!this._isPrimary) {
          // Wait random time (0 - 300ms) before claiming "primary" role, so not all tabs try to claim at the same time
          setTimeout(
            () => {
              const timeSinceRelease = Date.now() - envelope.timestamp;
              const timeSinceLastHeartbeat = Date.now() - this.lastPrimaryHeartbeat;
              if (timeSinceLastHeartbeat > timeSinceRelease) {
                this.logger.info(`Primary released, becoming primary`);
                this.stopPrimaryCheck();
                this.becomePrimary();
              } else {
                this.logger.info(`Another primary exists, do nothing`);
              }
            },
            Math.round(Math.random() * 300)
          );
        }
        return;
      case 'authentication':
        this.callbacks.onAuthChanged(message.payload.authenticated);
        return;
      case 'connection-toggle':
        if (this._isPrimary) {
          this.logger.info(
            `Should ${message.payload.connected ? 'connect' : 'disconnect'} socket.`
          );
          this.callbacks.onConnectionToggle(message.payload.connected);
        }
        return;
      case 'socket-event': {
        if (!this._isPrimary) {
          this.callbacks.onMessageFromPrimary(message);
        }
        return;
      }
      case 'socket-send': {
        if (this._isPrimary) {
          this.callbacks
            .onSendRequest(message)
            .then(() => {
              //Acknowledge the request
              this.broadcast({
                type: 'socket-ack',
                payload: {
                  envelopeId: envelope.id
                }
              });
            })
            .catch((e) => {
              this.logger.error(`Error sending socket message: ${e}`);
              this.broadcast({
                type: 'socket-ack',
                payload: {
                  envelopeId: envelope.id,
                  error: e.message
                }
              });
            });
        }
        return;
      }
      case 'socket-ack': {
        if (!this._isPrimary) {
          if (this.ackCallbacks[message.payload.envelopeId]) {
            this.ackCallbacks[message.payload.envelopeId](message.payload.error);
          }
        }
      }
    }
  }

  private broadcast(message: ChannelMessage, recipientId?: string): string {
    const envelope: MessageEnvelope = {
      id: getUUID(),
      senderId: this.id,
      timestamp: Date.now(),
      payload: message
    };
    if (recipientId) {
      envelope.recipientId = recipientId;
    }
    this.channel.postMessage(envelope);
    return envelope.id;
  }

  /**
   * Send a message to be transmitted over the socket (from secondary to primary)
   */
  sendToSocket<T extends MessageType = MessageType>(messageType: T, data: SocketMessageMap[T]) {
    if (this._isPrimary) {
      throw new Error('Primary tab should send directly');
    }
    this.logger.debug(`Sending socket message ${messageType}`, data);
    const messageId = this.broadcast({
      type: 'socket-send',
      payload: { messageType, data }
    });
    return new Promise<void>((resolve, reject) => {
      const ackTimeout = setTimeout(() => {
        //If callback is not called within 5 seconds, call it with an error
        if (this.ackCallbacks[messageId]) {
          this.ackCallbacks[messageId](new Error('Message delivery timeout'));
        }
      }, WSCoordinator.ACK_TIMEOUT);
      this.ackCallbacks[messageId] = (error?: any) => {
        delete this.ackCallbacks[messageId];
        clearTimeout(ackTimeout);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
    });
  }

  /**
   * Broadcast a socket event from primary to all secondaries
   */
  broadcastSocketEvent<E extends SocketEventName = SocketEventName>(
    eventType: E,
    payload: SocketEventMap[E]
  ) {
    if (!this._isPrimary) {
      throw new Error('Only primary tab can broadcast socket events');
    }
    if (eventType === 'connected') {
      this._isConnected = true;
    } else if (eventType === 'disconnected') {
      this._isConnected = false;
    }
    this.updateStartingState(eventType, payload);
    this.logger.debug(`Broadcasting socket event ${eventType}`, payload);
    this.broadcast({
      type: 'socket-event',
      payload: { eventType, payload }
    });
  }

  private updateStartingState<E extends SocketEventName>(eventType: E, payload: SocketEventMap[E]) {
    if (eventType === 'authenticated') {
      this.startingEvents.authenticated = payload as AuthenticatedData;
    } else if (eventType === 'balanceUpdate') {
      this.startingEvents.balanceUpdate = payload as Balances;
    } else if (eventType === 'swarmModels') {
      this.startingEvents.swarmModels = payload as Record<string, number>;
    }
  }

  isPrimary() {
    return this._isPrimary;
  }

  /**
   * Handle tab closing event
   */
  private handleBeforeUnload = () => {
    if (this._isPrimary) {
      this.logger.info(`Client ${this.id} closing, releasing primary role`);
      this.releasePrimary();
    }
  };
}

export default WSCoordinator;
