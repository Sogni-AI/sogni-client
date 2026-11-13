import ApiGroup, { ApiConfig } from '../ApiGroup.js';
import type { ApiResponse } from '../ApiClient/index.js';
import { captureRequestSession, RequestSessionError } from '../lib/requestSession.js';
import {
  openRemoteEncryptedMedia,
  type DecryptedMediaReader
} from '../lib/mediaEncryption/remote.js';
import {
  AccountMediaKey,
  MAX_INPUT_KEYS,
  MEDIA_ENCRYPTION_VERSION,
  MEDIA_KEY_BYTES,
  MediaEncryptionError,
  MediaEncryptionHeader,
  MediaSource,
  base64ToBytes,
  bytesToBase64,
  decryptMedia,
  encryptMedia,
  importAccountKey,
  inputMaterialForMedia,
  isEncryptedMedia,
  randomBytes,
  unwrapProjectKey,
  wrapInputKey,
  wrapProjectKey
} from '../lib/mediaEncryption/index.js';

export interface MediaEncryptionApiEvents {
  /** An account key became available to this client. */
  unlocked: void;
  /** This client let go of the account key. Encrypted media stays encrypted. */
  locked: void;
  /** The server's answer to whether this account may encrypt changed. */
  availabilityChanged: boolean;
}

/** `mediaEncryption` field of the `jobRequest` socket message. */
export interface MediaEncryptionWireParams {
  version: number;
  /** Base64 project key. */
  key: string;
  /** Base64 recipient record. */
  recipient: string;
  /** Base64 keys of the project's input files. */
  inputKeys?: string[];
}

/**
 * Encrypts one project's uploads.
 * @internal
 */
export interface ProjectMediaEncryption {
  /** The job request's field. Complete only once every input has been encrypted. */
  wire(): MediaEncryptionWireParams;
  /** Encrypt one input. Asking again for the same media object returns the same file. */
  encrypt(media: MediaSource, contentType?: string): Promise<Blob>;
}

/** @internal */
interface AccountMediaKeyResponse {
  version: number;
  current: { id: string; key: string; createdAt?: number };
  previous?: { id: string; key: string; retiredAt?: number }[];
}

const ACCOUNT_MEDIA_KEY_PATH = '/v1/account/media-key';
const ACCOUNT_MEDIA_KEY_VERSION = 1;
/** After a failed key request, the next one waits this long, or for the next sign-in. */
const ACCOUNT_KEY_RETRY_MS = 5 * 60 * 1000;
/** How long a new project waits for a key request already in flight. */
const KEY_WAIT_MS = 5000;

/** The account keys held for one sign-in session: the current key first. */
interface Keyring {
  keys: AccountMediaKey[];
  session: number;
}

/**
 * Optional encryption of project media for the signed-in account.
 *
 * Create the client with `mediaEncryption: 'auto'` to encrypt every eligible
 * project once media encryption is available for the account. Without it, the
 * client works as before. See {@link SogniClientConfig.mediaEncryption}.
 *
 * @example Encrypt every eligible project, and read a result
 * ```typescript
 * const sogni = await SogniClient.createInstance({ appId, mediaEncryption: 'auto' });
 * await sogni.account.login('username', 'password');
 * const project = await sogni.projects.create(params);
 * await project.waitForCompletion();
 * const image = await project.jobs[0].getResultData(); // decrypted Blob
 * ```
 */
class MediaEncryptionApi extends ApiGroup<MediaEncryptionApiEvents> {
  private keyring: Keyring | null = null;
  /** Invalidates asynchronous key work when the key is replaced or dropped. */
  private keyGeneration = 0;
  private readonly mediaReaders = new Set<AbortController>();
  /** The last `mediaEncryptionAvailable` the server sent on this connection. */
  private serverAvailable = false;
  /** The account-key request in flight, for the session that started it. */
  private keyRequest: { session: number; promise: Promise<boolean> } | null = null;
  /** No new account-key request before this time, unless the account signs in again. */
  private keyRetryAt = 0;
  /** Media encryption was turned off for the account: no key is requested again this session. */
  private keyTurnedOff = false;

  constructor(config: ApiConfig) {
    super(config);
    this.client.auth.on('updated', (isAuthenticated) => {
      if (isAuthenticated) return;
      this.setServerAvailable(false);
      this.forgetKeys();
    });
    this.client.auth.on('sessionChanged', () => {
      // A different account: its own connection says whether it may encrypt.
      this.setServerAvailable(false);
      this.forgetKeys();
    });
    this.client.socket.on('authenticated', (data) => {
      this.setServerAvailable(data.mediaEncryptionAvailable === true);
    });
    this.client.socket.on('mediaEncryptionAvailabilityUpdated', (available) => {
      this.setServerAvailable(available === true);
    });
    if (this.declaresCapability) {
      this.client._setMediaCapability({ declared: () => this.holdsKey() });
    }
  }

  /**
   * `true` when this client was created with `mediaEncryption: 'auto'`.
   * @internal
   */
  get automatic(): boolean {
    return this.client.mediaEncryption === 'auto';
  }

  /** An 'auto' client that tells the servers it reads encrypted media. */
  private get declaresCapability(): boolean {
    return this.automatic && this.client.declareMediaCapability;
  }

  /**
   * Whether media encryption is available for this account right now. A
   * client created with `mediaEncryption: 'auto'` encrypts new projects only
   * while this is `true`.
   */
  get available(): boolean {
    return this.serverAvailable;
  }

  private setServerAvailable(available: boolean) {
    if (this.serverAvailable === available) return;
    this.serverAvailable = available;
    this.emit('availabilityChanged', available);
    // Available: get the key now. No longer available: keep it for reading.
    if (available && this.automatic) void this.ensureAccountKey();
  }

  /** True when this data starts with the encrypted-media signature. Needs the first 8 bytes. */
  isEncrypted(bytes: Uint8Array | ArrayBuffer): boolean {
    return isEncryptedMedia(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  }

  /** Whether this client can open the signed-in account's encrypted media. */
  async isUnlocked(): Promise<boolean> {
    if (this.automatic) await this.ensureAccountKey();
    return this.holdsKey();
  }

  /**
   * Use these 32 bytes as the signed-in account's media key. A client created
   * with `mediaEncryption: 'auto'` manages the key itself. The key is dropped
   * when the account signs out or changes.
   */
  async setAccountKey(secret: Uint8Array): Promise<void> {
    if (!this.client.auth.isAuthenticated) {
      throw new MediaEncryptionError('locked', 'Sign in before setting the media key');
    }
    const isCurrent = this.beginKeyChange();
    const key = await importAccountKey(secret);
    this.assertCurrentKeyChange(isCurrent);
    this.setKeyring([key]);
  }

  /**
   * Drop the account key from this client. With `mediaEncryption: 'auto'` it
   * is obtained again the next time it is needed.
   */
  async lock(): Promise<void> {
    this.forgetKeys();
  }

  /**
   * Decrypt media downloaded from a result, preview or input URL. Returns a
   * Blob typed with the media's real MIME type. Pass `key` only for media that
   * the account key cannot open.
   */
  async decrypt(media: MediaSource, options: { key?: Uint8Array } = {}): Promise<Blob> {
    const assertCurrent = this.captureMediaSession();
    const { data } = await decryptMedia(media, (header) => this.resolveProjectKey(header, options));
    assertCurrent();
    return data;
  }

  /**
   * Open encrypted video/audio for seeking without downloading the whole file.
   * The URL must support HTTP byte ranges and expose Content-Range to this
   * origin. Close the reader when playback no longer needs it; locking or
   * changing the account also closes it and aborts pending requests.
   *
   * Ranges use [start, end) offsets in the DECRYPTED file. Apps can serve these
   * through their service worker to a normal audio/video element. Prefer
   * `stream()` for long ranges; `read()` collects the requested range in memory.
   */
  async openDecrypted(
    url: string,
    options: { init?: RequestInit } = {}
  ): Promise<DecryptedMediaReader> {
    const assertCurrent = this.captureMediaSession();
    const lifetime = new AbortController();
    this.mediaReaders.add(lifetime);
    const abort = () => lifetime.abort();
    options.init?.signal?.addEventListener('abort', abort, { once: true });
    if (options.init?.signal?.aborted) abort();
    const onClose = () => {
      this.mediaReaders.delete(lifetime);
      options.init?.signal?.removeEventListener('abort', abort);
    };
    return openRemoteEncryptedMedia(url, (header) => this.resolveProjectKey(header, {}), {
      init: { ...options.init, signal: lifetime.signal },
      assertCurrent,
      onClose
    });
  }

  /**
   * Download a URL and return its content decrypted. Content that is not
   * encrypted is returned as downloaded, so callers can use one path for both.
   * Pass `requireEncrypted` to treat unencrypted content as an error instead.
   */
  async fetchDecrypted(
    url: string,
    options: { init?: RequestInit; requireEncrypted?: boolean } = {}
  ): Promise<Blob> {
    const assertCurrent = this.captureMediaSession();
    const response = await fetch(url, options.init);
    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    assertCurrent();
    return this._openIfEncrypted(blob, options.requireEncrypted);
  }

  /**
   * Decrypt downloaded media when it is encrypted, and return anything else as it is.
   * @internal
   */
  async _openIfEncrypted(blob: Blob, requireEncrypted = false): Promise<Blob> {
    const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (isEncryptedMedia(signature)) return this.decrypt(blob);
    if (requireEncrypted) {
      throw new MediaEncryptionError('not_encrypted', 'Media is not Sogni-encrypted');
    }
    return blob;
  }

  /**
   * For `mediaEncryption: 'auto'`: whether a project submitted now can be encrypted.
   * @internal
   */
  async _canEncryptAutomatically(): Promise<boolean> {
    if (!this.automatic || !this.serverAvailable) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), KEY_WAIT_MS);
    });
    try {
      await Promise.race([this.ensureAccountKey(), waited]);
    } finally {
      clearTimeout(timer);
    }
    return this.holdsKey() && this.serverAvailable;
  }

  /**
   * Start encrypting a new project.
   * @internal
   */
  async _createProjectEncryption(): Promise<ProjectMediaEncryption> {
    const accountKey = (await this.requireAccountKeys())[0];
    const projectKey = randomBytes(MEDIA_KEY_BYTES);
    const recipient = await wrapProjectKey(accountKey, projectKey);
    // One entry per distinct input.
    const inputKeys = new Map<string, string>();
    const sealedInputs = new WeakMap<object, Promise<Blob>>();
    const encryptInput = async (media: MediaSource, contentType = '') => {
      const material = await inputMaterialForMedia(accountKey, media, contentType);
      const id = bytesToBase64(material.key);
      if (!inputKeys.has(id)) {
        if (inputKeys.size >= MAX_INPUT_KEYS) {
          throw new MediaEncryptionError(
            'unsupported',
            `An encrypted project can carry at most ${MAX_INPUT_KEYS} different input files`
          );
        }
        inputKeys.set(id, bytesToBase64(await wrapInputKey(projectKey, material.key)));
      }
      return encryptMedia(media, {
        key: material.key,
        contentType,
        recipient: await wrapProjectKey(accountKey, material.key, material.recipientNonce),
        deterministic: { salt: material.salt, noncePrefix: material.noncePrefix }
      });
    };
    return {
      wire: () => ({
        version: MEDIA_ENCRYPTION_VERSION,
        key: bytesToBase64(projectKey),
        recipient: bytesToBase64(recipient),
        ...(inputKeys.size ? { inputKeys: [...inputKeys.values()] } : {})
      }),
      encrypt: (media, contentType) => {
        let sealed = sealedInputs.get(media);
        if (!sealed) {
          sealed = encryptInput(media, contentType);
          sealedInputs.set(media, sealed);
        }
        return sealed;
      }
    };
  }

  private holdsKey(): boolean {
    return (
      !!this.keyring &&
      this.keyring.session === this.client.auth.sessionVersion &&
      this.client.auth.isAuthenticated
    );
  }

  /**
   * For `mediaEncryption: 'auto'`: get the signed-in account's key once media
   * encryption is available for it. Resolves `false`, and never throws, when
   * there is no key to use.
   */
  private ensureAccountKey(): Promise<boolean> {
    if (this.holdsKey()) return Promise.resolve(true);
    if (!this.automatic || !this.client.auth.isAuthenticated || !this.serverAvailable) {
      return Promise.resolve(false);
    }
    const session = this.client.auth.sessionVersion;
    if (this.keyRequest?.session === session) return this.keyRequest.promise;
    if (this.keyTurnedOff || Date.now() < this.keyRetryAt) return Promise.resolve(false);
    const promise = this.fetchAccountKey().finally(() => {
      if (this.keyRequest?.promise === promise) this.keyRequest = null;
    });
    this.keyRequest = { session, promise };
    return promise;
  }

  private async fetchAccountKey(): Promise<boolean> {
    const assertSession = captureRequestSession(this.client.auth);
    const generation = this.keyGeneration;
    try {
      const response =
        await this.client.rest.get<ApiResponse<AccountMediaKeyResponse>>(ACCOUNT_MEDIA_KEY_PATH);
      assertSession();
      const keys = await importAccountKeys(response?.data);
      assertSession();
      // Replaced or dropped while the request was out: keep what is there now.
      if (generation !== this.keyGeneration) return this.holdsKey();
      this.keyRetryAt = 0;
      this.setKeyring(keys);
      return true;
    } catch (error) {
      // A request that outlived its sign-in belongs to nobody; the next sign-in asks again.
      if (error instanceof RequestSessionError) return false;
      const { status, payload } = error as { status?: number; payload?: { errorCode?: unknown } };
      if (status === 409) {
        // Turned off for the account; only the account holder turns it back on.
        this.keyTurnedOff = true;
        this.client.logger.warn(
          'Media encryption is turned off for this account; projects are sent unencrypted'
        );
        return false;
      }
      this.keyRetryAt = Date.now() + ACCOUNT_KEY_RETRY_MS;
      this.client.logger.warn(
        'Media key unavailable; projects are sent unencrypted until it can be fetched',
        status !== undefined
          ? { status, errorCode: payload?.errorCode }
          : (error as Error)?.message || error
      );
      return false;
    }
  }

  private async resolveProjectKey(
    header: MediaEncryptionHeader,
    options: { key?: Uint8Array }
  ): Promise<Uint8Array> {
    if (options.key) return options.key;
    return unwrapProjectKey(await this.requireAccountKeys(), header.recipient);
  }

  private async requireAccountKeys(): Promise<AccountMediaKey[]> {
    if (this.automatic) await this.ensureAccountKey();
    if (!this.holdsKey()) {
      throw new MediaEncryptionError(
        'locked',
        this.automatic
          ? 'The media key for this account is not available right now'
          : "This client has no media key for the signed-in account. Create it with mediaEncryption: 'auto'"
      );
    }
    return this.keyring!.keys;
  }

  private setKeyring(keys: AccountMediaKey[]) {
    this.keyring = { keys, session: this.client.auth.sessionVersion };
    this.emit('unlocked', undefined);
    // An open socket that connected without the capability declares it now.
    if (this.automatic) this.client._declareMediaCapability();
  }

  private forgetKeys() {
    this.closeMediaReaders();
    this.keyGeneration++;
    this.keyRequest = null;
    // The next sign-in asks for its key at once.
    this.keyRetryAt = 0;
    this.keyTurnedOff = false;
    const hadKey = this.keyring !== null;
    this.keyring = null;
    if (hadKey) this.emit('locked', undefined);
  }

  private beginKeyChange(): () => boolean {
    this.closeMediaReaders();
    const generation = ++this.keyGeneration;
    const session = this.client.auth.sessionVersion;
    return () => generation === this.keyGeneration && session === this.client.auth.sessionVersion;
  }

  private closeMediaReaders(): void {
    for (const reader of this.mediaReaders) reader.abort();
    this.mediaReaders.clear();
  }

  private captureMediaSession(): () => void {
    const generation = this.keyGeneration;
    const session = this.client.auth.sessionVersion;
    return () =>
      this.assertCurrentKeyChange(
        () => generation === this.keyGeneration && session === this.client.auth.sessionVersion
      );
  }

  private assertCurrentKeyChange(isCurrent: () => boolean): void {
    if (!isCurrent()) {
      throw new MediaEncryptionError(
        'locked',
        'Media encryption was locked or the account changed'
      );
    }
  }
}

/** The account's keys, current first. */
async function importAccountKeys(
  data: AccountMediaKeyResponse | undefined
): Promise<AccountMediaKey[]> {
  if (data?.version !== ACCOUNT_MEDIA_KEY_VERSION || typeof data.current?.key !== 'string') {
    throw new MediaEncryptionError('malformed', 'The media key response is not recognized');
  }
  const encoded = [
    data.current.key,
    ...(Array.isArray(data.previous) ? data.previous.map((entry) => entry?.key) : [])
  ];
  const keys: AccountMediaKey[] = [];
  for (const value of encoded) {
    if (typeof value !== 'string') {
      throw new MediaEncryptionError('malformed', 'The media key response is not recognized');
    }
    const secret = base64ToBytes(value);
    try {
      keys.push(await importAccountKey(secret));
    } finally {
      secret.fill(0);
    }
  }
  return keys;
}

export default MediaEncryptionApi;
