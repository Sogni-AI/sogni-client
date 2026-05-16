import { MessageType, SocketMessageMap } from './messages';
import RestClient from '../../lib/RestClient';
import { SocketEventMap } from './events';
import type { SocketEventSubscriptionInput } from './eventSubscriptions';

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
