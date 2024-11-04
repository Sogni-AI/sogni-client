import { AbstractProvider, JsonRpcProvider, getDefaultProvider } from 'ethers';
import AccountApi from './Account';
import ApiClient, { ApiError } from './ApiClient/ApiClient';
import { ApiConfig } from './ApiGroup';
import EIP712Helper from './lib/EIP712Helper';
import ProjectsApi from './Projects';
import { AvailableModel } from './Projects/types';
import CurrentAccount from './Account/CurrentAccount';
import DataEntity from './lib/DataEntity';
import Project, { ProjectStatus } from './Projects/Project';
import Job, { JobStatus } from './Projects/Job';
import { SupernetType } from './ApiClient/WebSocketClient/types';
import ErrorData from './types/ErrorData';
import * as ProjectApiEvents from './Projects/types/events';

export type {
  AvailableModel,
  CurrentAccount,
  DataEntity,
  ErrorData,
  Job,
  JobStatus,
  ProjectApiEvents,
  ProjectStatus,
  Project,
  SupernetType
};

export { ApiError };

export interface BaseConfig {
  appId: string;
  restEndpoint: string;
  socketEndpoint: string;
}

export interface SimpleConfig extends BaseConfig {
  testnet: boolean;
}

export interface FullConfig extends BaseConfig {
  jsonRpcUrl: string;
}

export type SogniClientConfig = SimpleConfig | FullConfig;

export class SogniClient {
  account: AccountApi;
  projects: ProjectsApi;

  private constructor(config: ApiConfig) {
    this.account = new AccountApi(config);
    this.projects = new ProjectsApi(config);
  }

  get currentAccount() {
    return this.account.currentAccount;
  }

  /**
   * Instance creation may involve async operations, so we use a static method
   * @param config
   */
  static async createInstance(config: SogniClientConfig): Promise<SogniClient> {
    const client = new ApiClient(config.restEndpoint, config.socketEndpoint, config.appId);
    let provider: AbstractProvider;
    if ('jsonRpcUrl' in config) {
      provider = new JsonRpcProvider(config.jsonRpcUrl);
    } else {
      provider = getDefaultProvider(config.testnet ? 84532 : 8453);
    }
    const chainId = await provider.getNetwork().then((network) => network.chainId);
    const eip712 = new EIP712Helper({
      name: 'Sogni-testnet',
      version: '1',
      chainId: chainId.toString()
    });
    return new SogniClient({ client, provider, eip712 });
  }
}

export default SogniClient;
