import ApiKeyAuthManager from './ApiKeyAuthManager';
import CookieAuthManager from './CookieAuthManager';
import TokenAuthManager, { TokenAuthData } from './TokenAuthManager';

export type { TokenAuthData };

export { ApiKeyAuthManager, CookieAuthManager, TokenAuthManager };

export type AuthManager = ApiKeyAuthManager | CookieAuthManager | TokenAuthManager;
