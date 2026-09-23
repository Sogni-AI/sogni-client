import { Logger } from '../DefaultLogger.js';
import TypedEventEmitter from '../TypedEventEmitter.js';
import { ClientOptions } from 'ws';

interface AuthManagerEvents {
  updated: boolean;
  sessionChanged: void;
}

abstract class AuthManagerBase<AuthData = never> extends TypedEventEmitter<AuthManagerEvents> {
  protected _logger: Logger;
  private _sessionVersion = 0;
  private _sessionIdentity?: string;
  constructor(logger: Logger) {
    super();
    this._logger = logger;
    let authenticated = false;
    this.on('updated', (next) => {
      if (next !== authenticated) this._sessionVersion += 1;
      authenticated = next;
    });
  }

  /** @internal Distinguishes sign-in sessions without treating token renewal as a new session. */
  get sessionVersion(): number {
    return this._sessionVersion;
  }

  /** @internal Account identity supplied by credentials or the authenticated account response. */
  _setSessionIdentity(identity: string): void {
    if (this._sessionIdentity !== undefined && this._sessionIdentity !== identity) {
      this._sessionVersion += 1;
      this._sessionIdentity = identity;
      this.emit('sessionChanged', undefined);
      return;
    }
    this._sessionIdentity = identity;
  }

  /** @internal A sibling tab changed accounts without a preceding sign-out. */
  _invalidateSession(): void {
    this._sessionVersion += 1;
    this._sessionIdentity = undefined;
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
