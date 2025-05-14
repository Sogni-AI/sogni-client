// Account API
import AccountApi from './Account';
import CurrentAccount from './Account/CurrentAccount';
// ApiClient
import ApiClient, { ApiError } from './ApiClient';
import { SupernetType } from './ApiClient/WebSocketClient/types';
import { ApiConfig } from './ApiGroup';
// Utils
import { DefaultLogger, Logger, LogLevel } from './lib/DefaultLogger';
import EIP712Helper from './lib/EIP712Helper';
// Projects API
import ProjectsApi from './Projects';
import Job, { JobStatus } from './Projects/Job';
import Project, { ProjectStatus } from './Projects/Project';
import { AvailableModel, ProjectParams, Scheduler, TimeStepSpacing } from './Projects/types';
// Stats API
import StatsApi from './Stats';
// Base Types
import ErrorData from './types/ErrorData';

export type {
  AvailableModel,
  ErrorData,
  JobStatus,
  Logger,
  LogLevel,
  ProjectParams,
  ProjectStatus,
  Scheduler,
  SupernetType,
  TimeStepSpacing
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
   * If provided, the client will connect to this JSON-RPC endpoint to interact with the blockchain
   * @deprecated This option is deprecated and is not used internally. Left for backward compatibility
   */
  jsonRpcUrl?: string;
  /**
   * If true, the client will connect to the testnet. While Sogni is on Testnet, do not set to `false`
   */
  testnet?: boolean;
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
   * Instance creation may involve async operations, so we use a static method
   * @param config
   */
  static async createInstance(config: SogniClientConfig): Promise<SogniClient> {
    const restEndpoint = config.restEndpoint || 'https://api.sogni.ai';
    const socketEndpoint = config.socketEndpoint || 'wss://socket.sogni.ai';
    const network = config.network || 'fast';
    const logger = config.logger || new DefaultLogger(config.logLevel || 'warn');
    const isTestnet = config.testnet !== undefined ? config.testnet : true;

    const client = new ApiClient(restEndpoint, socketEndpoint, config.appId, network, logger);
    const eip712 = new EIP712Helper({
      name: 'Sogni-testnet',
      version: '1',
      chainId: isTestnet ? '84532' : '8453'
    });
    return new SogniClient({ client, eip712 });
  }
}
