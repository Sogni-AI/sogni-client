import { AbstractProvider, JsonRpcProvider, getDefaultProvider } from 'ethers';
import Account from './Account';
import ApiClient from './ApiClient/ApiClient';
import { ApiConfig } from './ApiGroup';
import EIP712Helper from './lib/EIP712Helper';
import Projects from './Projects';

interface BaseConfig {
  appId: string;
  restEndpoint: string;
  socketEndpoint: string;
}

interface SimpleConfig extends BaseConfig {
  testnet: boolean;
}

interface FullConfig extends BaseConfig {
  jsonRpcUrl: string;
}

type SogniClientConfig = SimpleConfig | FullConfig;

class SogniClient {
  account: Account;
  projects: Projects;

  private constructor(config: ApiConfig) {
    this.account = new Account(config);
    this.projects = new Projects(config);
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
