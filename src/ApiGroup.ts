import { AbstractProvider } from 'ethers';
import ApiClient from './ApiClient/ApiClient';
import EIP712Helper from './lib/EIP712Helper';

export interface ApiConfig {
  client: ApiClient;
  provider: AbstractProvider;
  eip712: EIP712Helper;
}

abstract class ApiGroup {
  protected client: ApiClient;
  protected provider: AbstractProvider;
  protected eip712: EIP712Helper;

  constructor(config: ApiConfig) {
    this.client = config.client;
    this.provider = config.provider;
    this.eip712 = config.eip712;
  }
}

export default ApiGroup;
