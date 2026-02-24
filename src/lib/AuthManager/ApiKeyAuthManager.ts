import AuthManagerBase from './AuthManagerBase';
import { Logger } from '../DefaultLogger';
import { ClientOptions } from 'ws';

class ApiKeyAuthManager extends AuthManagerBase<string | null> {
  private _apiKey?: string;

  constructor(logger: Logger) {
    super(logger);
  }

  get isAuthenticated() {
    return !!this._apiKey;
  }

  async authenticate(apiKey: string): Promise<void> {
    this._apiKey = apiKey;
    this.emit('updated', true);
  }

  clear() {
    if (!this._apiKey) {
      return;
    }
    this._apiKey = undefined;
    this.emit('updated', false);
  }

  async backup(): Promise<string | null> {
    return this._apiKey || null;
  }

  async authenticateRequest(options: RequestInit): Promise<RequestInit> {
    if (!this._apiKey) {
      return options;
    }
    return {
      ...options,
      headers: { ...options.headers, 'api-key': this._apiKey }
    };
  }

  async socketOptions(): Promise<ClientOptions | undefined> {
    if (!this._apiKey) {
      return undefined;
    }
    return {
      headers: {
        'api-key': this._apiKey
      }
    };
  }
}

export default ApiKeyAuthManager;
