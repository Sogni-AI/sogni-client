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
   * @event ApiClient#disconnected - The connection ended and the client will not retry on its
   * own: authentication was lost or rejected, the server closed with a non-recoverable code,
   * or the client disconnected deliberately. Recoverable drops (network blips, server
   * restarts) do not emit this; the client keeps reconnecting with backoff and emits
   * `connecting` before each attempt, then `connected`.
   */
  disconnected: {
    code: ErrorCode;
    reason: string;
  };
};
