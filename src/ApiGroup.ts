import { AbstractProvider } from 'ethers';
import ApiClient from './ApiClient';
import EIP712Helper from './lib/EIP712Helper';
import TypedEventEmitter, { EventMap } from './lib/TypedEventEmitter';

export interface ApiConfig {
  client: ApiClient;
  provider: AbstractProvider;
  eip712: EIP712Helper;
}

abstract class ApiGroup<E extends EventMap = {}> extends TypedEventEmitter<E> {
  protected client: ApiClient;
  protected provider: AbstractProvider;
  protected eip712: EIP712Helper;

  constructor(config: ApiConfig) {
    super();
    this.client = config.client;
    this.provider = config.provider;
    this.eip712 = config.eip712;
  }
}

export default ApiGroup;
