import { Logger } from '../DefaultLogger';
import TypedEventEmitter from '../TypedEventEmitter';
import { ClientOptions } from 'ws';

interface AuthManagerEvents {
  updated: boolean;
}

abstract class AuthManagerBase<AuthData = never> extends TypedEventEmitter<AuthManagerEvents> {
  protected _logger: Logger;
  constructor(logger: Logger) {
    super();
    this._logger = logger;
  }

  abstract get isAuthenticated(): boolean;

  abstract authenticateRequest(option: RequestInit): Promise<RequestInit>;

  abstract socketOptions(): Promise<ClientOptions | undefined>;

  /**
   * Get the current authentication data to persist it
   * @returns
   */
  abstract backup(): Promise<AuthData>;

  /**
   * Restore authentication from the data that was previously backed up
   * @param data
   */
  abstract authenticate(data: AuthData): Promise<void>;

  abstract clear(): void;
}

export default AuthManagerBase;
