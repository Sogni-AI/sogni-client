import ApiClient from './ApiClient';
import EIP712Helper from './lib/EIP712Helper';
import TypedEventEmitter, { EventMap } from './lib/TypedEventEmitter';

export interface ApiConfig {
  client: ApiClient;
  eip712: EIP712Helper;
}

abstract class ApiGroup<E extends EventMap = {}> extends TypedEventEmitter<E> {
  protected client: ApiClient;
  protected eip712: EIP712Helper;

  constructor(config: ApiConfig) {
    super();
    this.client = config.client;
    this.eip712 = config.eip712;
  }
}

export default ApiGroup;
