import ErrorCode from './WebSocketClient/ErrorCode';
import { SupernetType } from './WebSocketClient/types';

export type ApiClientEvents = {
  /**
   * @event ApiClient#connected - The client has been connected to the server.
   */
  connected: {
    network: SupernetType;
  };
  /**
   * @event ApiClient#disconnected - The client has been disconnected by the server,
   * either authentication is lost or the server is unreachable.This event is not triggered
   * when the client manually disconnects.
   */
  disconnected: {
    code: ErrorCode;
    reason: string;
  };
};
