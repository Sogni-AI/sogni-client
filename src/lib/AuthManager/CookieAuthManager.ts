import AuthManagerBase from './AuthManagerBase';

class CookieAuthManager extends AuthManagerBase<undefined> {
  private _isAuthenticated = false;

  /**
   * For cookie authentication, there is no way to detect if the user is authenticated or not,
   * except when a call to API was successful. So the REST client will set this property to true.
   */
  async authenticate(): Promise<void> {
    this._isAuthenticated = true;
    this.emit('updated', true);
  }

  clear() {
    this._isAuthenticated = false;
    this.emit('updated', false);
  }

  get isAuthenticated() {
    return this._isAuthenticated;
  }

  backup(): Promise<undefined> {
    throw new Error('Not supported with cookie authentication');
  }

  async authenticateRequest(options: RequestInit): Promise<RequestInit> {
    return {
      ...options,
      credentials: 'include'
    };
  }

  async socketOptions(): Promise<undefined> {
    return undefined;
  }
}

export default CookieAuthManager;
