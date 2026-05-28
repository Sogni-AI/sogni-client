import ErrorCode from './WebSocketClient/ErrorCode.js';
import { SupernetType } from './WebSocketClient/types.js';

export type ApiClientEvents = {
  /**
   * @event ApiClient#connecting - The client is attempting to connect to the server.
   */
  connecting: {
    network: SupernetType;
  };
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
