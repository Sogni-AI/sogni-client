import { SocketEventMap, SocketEventName } from '../events';
import { MessageType, SocketMessageMap } from '../messages';

/**
 * Primary tab to broadcast socket events to secondary tabs.
 * @param eventType - The event type.
 * @param payload - The event payload. See {@link SocketEventMap} for the list of available events.
 */
export interface SocketEventReceived<T extends SocketEventName = SocketEventName> {
  type: 'socket-event';
  payload: { eventType: T; payload: SocketEventMap[T] };
}

/**
 * Sent by secondary tabs to the primary tab to send a message to WebSocket.
 * @param messageType - The message type.
 * @param data - The message payload. See {@link SocketMessageMap} for the list of available messages.
 */
export interface SendSocketMessage<T extends MessageType = MessageType> {
  type: 'socket-send';
  payload: { messageType: T; data: SocketMessageMap[T] };
}

/**
 * Sent by the primary tab to acknowledge that a message was sent to WebSocket.
 */
export interface SocketMessageAck {
  type: 'socket-ack';
  payload: { envelopeId: string; error?: any };
}

/**
 * Sent by the primary tab to notify the secondary tabs that the primary tab is still alive.
 * @param connected - true if the primary tab is connected to the server, false otherwise.
 */
export interface Heartbeat {
  type: 'primary-present';
  payload: { connected: boolean };
}

/**
 * Used to tell the primary tab to connect/disconnect socket.
 * @param connected - true to connect, false to disconnect.
 */
export interface ConnectionToggle {
  type: 'connection-toggle';
  payload: { connected: boolean };
}

/**
 * Sent by tab when it is opened to notify other tabs. If another tab is present,
 * it will respond with {@link Heartbeat}.
 */
export interface ClientAnnounce {
  type: 'announce';
}

/**
 * Sent by the client to let other know that it is claiming the primary role.
 */
export interface PrimaryClaim {
  type: 'primary-claim';
}

/**
 * Sent by the client to let other know that it is releasing the primary role.
 * This usually happens when the tab is closed.
 */
export interface PrimaryRelease {
  type: 'primary-release';
}

/**
 * Sent by the tab where user has auth state changed.
 * @param authenticated - true if the user is authenticated, false otherwise.
 */
export interface AuthenticationChange {
  type: 'authentication';
  payload: { authenticated: boolean };
}

export type ChannelMessage =
  | AuthenticationChange
  | SocketEventReceived
  | SendSocketMessage
  | SocketMessageAck
  | ConnectionToggle
  | Heartbeat
  | ClientAnnounce
  | PrimaryClaim
  | PrimaryRelease;

/**
 * Envelope for messages sent between tabs.
 * @param id - Unique message ID.
 * @param senderId - ID of the tab that sent the message.
 * @param recipientId - ID of the tab that should receive the message. If not specified, the message will be broadcasted to all tabs.
 * @param timestamp - Timestamp of the message.
 * @param payload - Message payload.
 */
export interface MessageEnvelope {
  id: string;
  senderId: string;
  recipientId?: string;
  timestamp: number;
  payload: ChannelMessage;
}
