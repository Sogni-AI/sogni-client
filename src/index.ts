// Account API
import AccountApi from './Account';
import CurrentAccount from './Account/CurrentAccount';
// ApiClient
import ApiClient, { ApiError, ApiResponse } from './ApiClient';
import { SupernetType } from './ApiClient/WebSocketClient/types';
import { ApiConfig } from './ApiGroup';
// Utils
import { DefaultLogger, Logger, LogLevel } from './lib/DefaultLogger';
import EIP712Helper from './lib/EIP712Helper';
// Projects API
import ProjectsApi from './Projects';
import Job, { JobStatus } from './Projects/Job';
import Project, { ProjectStatus } from './Projects/Project';
import {
  AvailableModel,
  OutputFormat,
  ProjectParams,
  Scheduler,
  TimeStepSpacing
} from './Projects/types';
// Stats API
import StatsApi from './Stats';
// Base Types
import ErrorData from './types/ErrorData';
import { TokenType } from './types/token';
import { CookieAuthManager, TokenAuthData, TokenAuthManager } from './lib/AuthManager';
import { MeData } from './Account/types';

export type {
  AvailableModel,
  ErrorData,
  JobStatus,
  Logger,
  LogLevel,
  OutputFormat,
  ProjectParams,
  ProjectStatus,
  Scheduler,
  SupernetType,
  TimeStepSpacing,
  TokenType
};

export { ApiError, CurrentAccount, Job, Project };

export interface SogniClientConfig {
  /**
   * The application ID string. Must be unique, multiple connections with the same ID will be rejected.
   */
  appId: string;
  /**
   * Override the default REST API endpoint
   * @internal
   */
  restEndpoint?: string;
  /**
   * Override the default WebSocket API endpoint
   * @internal
   */
  socketEndpoint?: string;
  /**
   * Disable WebSocket connection. Useful for testing or when WebSocket is not needed.
   * Note that many may not work without WebSocket connection.
   * @experimental
   * @internal
   */
  disableSocket?: boolean;
  /**
   * Which network to use after logging in. Can be 'fast' or 'relaxed'
   */
  network: SupernetType;
  /**
   * Logger to use. If not provided, a default console logger will be used
   */
  logger?: Logger;
  /**
   * Log level to use. This option is ignored if a logger is provided
   * @default 'warn'
   **/
  logLevel?: LogLevel;
  /**
   * If true, the client will connect to the testnet. Ignored if jsonRpcUrl is provided
   */
  testnet?: boolean;
  /**
   * Authentication type to use. Can be 'token' or 'cookie'. If not provided, 'token' will be used.
   * `token` authentication relies on a token stored in the client instance. This is what 3rd party
   * Node.js apps should use.
   * `cookie` authentication relies on htmlOnly cookie, set by the server. This will only work for
   * browser apps located on .sogni.ai subdomains due to CORS restrictions.
   * @default 'token'
   * @experimental
   */
  authType?: 'token' | 'cookies';
}

export class SogniClient {
  account: AccountApi;
  projects: ProjectsApi;
  stats: StatsApi;

  apiClient: ApiClient;

  private constructor(config: ApiConfig) {
    this.account = new AccountApi(config);
    this.projects = new ProjectsApi(config);
    this.stats = new StatsApi(config);

    this.apiClient = config.client;
  }

  get currentAccount() {
    return this.account.currentAccount;
  }

  /**
   * When using token authentication, this method can be used to set the tokens.
   * This is useful when the tokens are stored in a secure location and you want to resume the session.
   * @param tokens
   */
  async setTokens(tokens: TokenAuthData): Promise<void> {
    const auth = this.apiClient.auth;
    if (!(auth instanceof TokenAuthManager)) {
      throw new Error('setTokens can only be used with token authentication');
    }
    await auth.authenticate(tokens);
    await this.account.me();
  }

  /**
   * When using cookie authentication, client has no way to detect if the user is authenticated or not.
   * This method can be used to check if the user is authenticated and populate the currentAccount.
   * @returns
   */
  async checkAuth(): Promise<boolean> {
    const auth = this.apiClient.auth;
    if (!(auth instanceof CookieAuthManager)) {
      throw Error('This method should only be called when using cookie auth');
    }
    try {
      await this.apiClient.rest.get<ApiResponse<MeData>>('/v1/account/me');
      await auth.authenticate();
      await this.account.me();
      return true;
    } catch (e) {
      this.apiClient.logger.info('Client is not authenticated');
      return false;
    }
  }

  /**
   * Create client instance, with default configuration
   * @param config
   */
  static async createInstance(config: SogniClientConfig): Promise<SogniClient> {
    const restEndpoint = config.restEndpoint || 'https://api.sogni.ai';
    const socketEndpoint = config.socketEndpoint || 'wss://socket.sogni.ai';
    const network = config.network || 'fast';
    const logger = config.logger || new DefaultLogger(config.logLevel || 'warn');
    const isTestnet = config.testnet !== undefined ? config.testnet : false;

    const client = new ApiClient({
      baseUrl: restEndpoint,
      socketUrl: socketEndpoint,
      appId: config.appId,
      networkType: network,
      logger,
      authType: config.authType || 'token',
      disableSocket: config.disableSocket
    });
    const eip712 = new EIP712Helper({
      name: isTestnet ? 'Sogni-testnet' : 'Sogni AI',
      version: '1',
      chainId: isTestnet ? '84532' : '8453'
    });
    return new SogniClient({ client, eip712 });
  }
}
