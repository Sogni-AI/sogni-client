import ApiClient from './ApiClient/index.js';
import EIP712Helper from './lib/EIP712Helper.js';
import TypedEventEmitter, { EventMap } from './lib/TypedEventEmitter.js';
import { buildSogniAttributionHeaders, resolveWorkloadAttribution } from './lib/attribution.js';
import type { WorkloadAttributionInput } from './types/attribution.js';

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

  protected resolveWorkloadAttribution(
    override?: WorkloadAttributionInput,
    fallbackOperationId?: string
  ) {
    return resolveWorkloadAttribution(
      this.client.attribution?.workload,
      override,
      fallbackOperationId
    );
  }

  protected attributionHeaders(
    appSource: string | undefined,
    override?: WorkloadAttributionInput,
    fallbackOperationId?: string
  ): Record<string, string> {
    return buildSogniAttributionHeaders({
      appSource,
      connection: this.client.attribution?.connection,
      workload: this.resolveWorkloadAttribution(override, fallbackOperationId)
    });
  }
}

export default ApiGroup;
