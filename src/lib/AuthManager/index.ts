import CookieAuthManager from './CookieAuthManager';
import TokenAuthManager, { TokenAuthData } from './TokenAuthManager';

export type { TokenAuthData };

export { CookieAuthManager, TokenAuthManager };

export type AuthManager = CookieAuthManager | TokenAuthManager;
