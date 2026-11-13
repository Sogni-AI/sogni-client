import type { SupernetType } from '../../ApiClient/WebSocketClient/types.js';

/** What a network supports for encrypted projects. @internal */
export interface WorkerMediaEncryptionCapability {
  /** Supported media encryption protocol; absent or 0 means none. */
  mediaEncryptionProtocol?: number;
  /** Present when the network supports encrypted projects' media. */
  mediaStorage?: string;
}

/** What each network supports. Relaxed does not support encrypted projects yet. */
export const NETWORK_WORKER_MEDIA_ENCRYPTION: Readonly<
  Record<SupernetType, WorkerMediaEncryptionCapability>
> = {
  fast: { mediaEncryptionProtocol: 1, mediaStorage: 'memory' },
  relaxed: {}
};

/** Whether this support is enough for encrypted projects. */
export function workersServeMediaEncryption(workers?: WorkerMediaEncryptionCapability): boolean {
  return !!workers && (workers.mediaEncryptionProtocol ?? 0) >= 1 && !!workers.mediaStorage;
}

/** Whether projects on this network may be encrypted. */
export function networkServesMediaEncryption(network: SupernetType | null | undefined): boolean {
  return (
    !!network &&
    Object.prototype.hasOwnProperty.call(NETWORK_WORKER_MEDIA_ENCRYPTION, network) &&
    workersServeMediaEncryption(NETWORK_WORKER_MEDIA_ENCRYPTION[network])
  );
}
