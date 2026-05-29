import ApiKeyAuthManager from './ApiKeyAuthManager.js';
import CookieAuthManager from './CookieAuthManager.js';
import TokenAuthManager, { TokenAuthData } from './TokenAuthManager.js';

export type { TokenAuthData };

export { ApiKeyAuthManager, CookieAuthManager, TokenAuthManager };

export type AuthManager = ApiKeyAuthManager | CookieAuthManager | TokenAuthManager;
