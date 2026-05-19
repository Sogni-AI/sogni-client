import { MessageType, SocketMessageMap } from './messages.js';
import RestClient from '../../lib/RestClient.js';
import { SocketEventMap } from './events.js';
import type { SocketEventSubscriptionInput } from './eventSubscriptions.js';

export type SupernetType = 'relaxed' | 'fast';

export interface IWebSocketClient extends RestClient<SocketEventMap> {
  appId: string;
  baseUrl: string;
  isConnected: boolean;
  supernetType: SupernetType;

  connect(): Promise<void>;
  disconnect(): void;
  send<T extends MessageType>(messageType: T, data: SocketMessageMap[T]): Promise<void>;
  setSocketEventSubscriptions(update: SocketEventSubscriptionInput): Promise<void>;
  switchNetwork(supernetType: SupernetType): Promise<SupernetType>;
}
