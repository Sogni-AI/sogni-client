import { getBytes, Wallet } from 'ethers';
import ApiGroup, { ApiConfig } from '../ApiGroup.js';
import type AccountApi from '../Account/index.js';
import {
  AccountKeyStore,
  AccountMediaKey,
  MAX_INPUT_KEYS,
  MEDIA_ENCRYPTION_VERSION,
  MEDIA_KEY_BYTES,
  MediaEncryptionError,
  MediaEncryptionHeader,
  MediaSource,
  bytesToBase64,
  createDefaultAccountKeyStore,
  decryptMedia,
  deriveAccountKey,
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
  /** An account key became available on this device. */
  unlocked: void;
  /** The account key was removed from this device. */
  locked: void;
  /** The server's answer to whether this account may encrypt changed. */
  availabilityChanged: boolean;
}

/** `mediaEncryption` field of the `jobRequest` socket message. */
export interface MediaEncryptionWireParams {
  version: number;
  /** Base64 project key. */
  key: string;
  /** Base64 recipient stanza embedded in every result of the project. */
  recipient: string;
  /** Base64 keys of the project's input files, each wrapped under the project key. */
  inputKeys?: string[];
}

/**
 * Encrypts one project's uploads.
 * @internal
 */
export interface ProjectMediaEncryption {
  /** The job request's field. Complete only once every input has been encrypted. */
  wire(): MediaEncryptionWireParams;
  /**
   * Encrypt one input under its own key (see `lib/mediaEncryption/inputKeys`).
   * Asking again for the same media object returns the same encrypted file.
   */
  encrypt(media: MediaSource, contentType?: string): Promise<Blob>;
}

/**
 * Encryption of project media in storage and in transit.
 *
 * A project created with `mediaEncryption: true` has its input media encrypted
 * on this device before upload and its results encrypted by the worker before
 * they are stored, so storage and download links hold only ciphertext, and a
 * device holding the account key opens them. Each project's own key is sent
 * with the project, through Sogni's servers, so the rendering worker can use it.
 *
 * The account key is derived from the account's login secret during
 * {@link AccountApi.login}, so a normal username/password login needs no extra
 * step. A session resumed without the password (cookies, tokens, API key) is
 * "locked" until {@link MediaEncryptionApi.unlock} is called once; in browsers
 * the key is then remembered on the device until logout.
 *
 * @example Create an encrypted project and read its result
 * ```typescript
 * await sogni.account.login('username', 'password');
 * const project = await sogni.projects.create({ ...params, mediaEncryption: true });
 * await project.waitForCompletion();
 * const image = await project.jobs[0].getResultData(); // decrypted Blob
 * ```
 */
class MediaEncryptionApi extends ApiGroup<MediaEncryptionApiEvents> {
  private account: AccountApi;
  private store: AccountKeyStore;
  private accountKey: AccountMediaKey | null = null;
  /** Wallet the in-memory key belongs to; outlives `currentAccount` being cleared on logout. */
  private keyWalletAddress: string | null = null;
  /**
   * Last wallet seen signed in. Logout clears `currentAccount` before this
   * group hears about it, and the stored key has to be removed even when it
   * was never loaded during this page load.
   */
  private lastWalletAddress: string | null = null;
  /** The integrator supplied the key; a later password login must not replace it. */
  private explicitKey = false;
  /** Stored-key removals still in progress; see {@link MediaEncryptionApi.lock}. */
  private removal: Promise<void> = Promise.resolve();
  /** The last `mediaEncryptionAvailable` the server sent on this connection. */
  private serverAvailable = false;

  constructor(config: ApiConfig, account: AccountApi, store?: AccountKeyStore) {
    super(config);
    this.account = account;
    this.store = store ?? createDefaultAccountKeyStore();
    // Deriving the media key must never fail a login; without it the account is simply locked.
    account._onWalletDerived = (wallet) =>
      this.adoptWallet(wallet).catch((error) =>
        this.client.logger.warn('Media encryption key could not be derived at login', error)
      );
    account.currentAccount.on('updated', () => {
      const walletAddress = account.currentAccount.walletAddress;
      if (walletAddress) this.lastWalletAddress = walletAddress;
    });
    this.client.auth.on('updated', (isAuthenticated) => {
      if (!isAuthenticated) {
        this.setServerAvailable(false);
        this.lock().catch((error) =>
          this.client.logger.warn('Failed to remove the stored media key', error)
        );
      }
    });
    this.client.socket.on('authenticated', (data) => {
      this.setServerAvailable(data.mediaEncryptionAvailable === true);
    });
  }

  /**
   * Whether the server currently accepts `mediaEncryption` projects from this
   * account, as it said when this connection authenticated. `false` until it
   * says so, and on servers that do not send it. Apps that turn encryption on
   * by default should do so only while this is `true`; the server refuses an
   * encrypted project it does not accept with
   * {@link MEDIA_ENCRYPTION_ERROR_CODES.UNSUPPORTED}.
   */
  get available(): boolean {
    return this.serverAvailable;
  }

  private setServerAvailable(available: boolean) {
    if (this.serverAvailable === available) return;
    this.serverAvailable = available;
    this.emit('availabilityChanged', available);
  }

  /**
   * Whether {@link MediaEncryptionApi.unlock} can work for the signed-in
   * account: `false` when it signs in only with a provider (Google, Apple) and
   * has no password. `true` when the server does not say.
   */
  async canUnlockWithPassword(): Promise<boolean> {
    const me = await this.account.me();
    return !Array.isArray(me.authMethods) || me.authMethods.includes('password');
  }

  /** True when this data starts with the encrypted-media signature. Needs the first 8 bytes. */
  isEncrypted(bytes: Uint8Array | ArrayBuffer): boolean {
    return isEncryptedMedia(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  }

  /**
   * Whether this device can encrypt and decrypt the signed-in account's media
   * right now. `false` means {@link MediaEncryptionApi.unlock} is needed.
   */
  async isUnlocked(): Promise<boolean> {
    return (await this.loadAccountKey()) !== null;
  }

  /**
   * Make the signed-in account's media key available on this device, using the
   * account password. The password is checked locally against the account's
   * wallet address and is never sent anywhere.
   */
  async unlock(password: string): Promise<void> {
    let { username, walletAddress } = this.account.currentAccount;
    if (!username || !walletAddress) {
      const me = await this.account.me();
      username = me.username;
      walletAddress = me.walletAddress;
    }
    if (!username || !walletAddress) {
      throw new MediaEncryptionError('locked', 'Sign in before unlocking media encryption');
    }
    const wallet = this.account.getWallet(username, password);
    if (wallet.address.toLowerCase() !== walletAddress.toLowerCase()) {
      if (!(await this.canUnlockWithPassword())) {
        throw new MediaEncryptionError(
          'password_unavailable',
          'This account signs in with Google or Apple and has no password, so its media key cannot be derived on this device'
        );
      }
      throw new MediaEncryptionError(
        'invalid_password',
        'That password does not match the signed-in account'
      );
    }
    // An explicit unlock is a deliberate choice of the password-derived key.
    this.explicitKey = false;
    await this.adoptWallet(wallet);
  }

  /**
   * Use your own 32-byte secret as the account key instead of one derived from
   * the password. For headless integrations; every device that should open the
   * media needs the same secret. It stays in use until {@link MediaEncryptionApi.lock}
   * or logout: a later `account.login()` does not replace it.
   */
  async setAccountKey(secret: Uint8Array): Promise<void> {
    const walletAddress = this.account.currentAccount.walletAddress;
    this.explicitKey = true;
    await this.setKey(await importAccountKey(secret), walletAddress ?? null);
  }

  /** Forget the account key on this device. Encrypted media stays encrypted. */
  async lock(): Promise<void> {
    const walletAddresses = new Set(
      [this.keyWalletAddress, this.account.currentAccount.walletAddress, this.lastWalletAddress]
        .filter((address): address is string => !!address)
        .map((address) => address.toLowerCase())
    );
    const hadKey = this.accountKey !== null;
    this.accountKey = null;
    this.keyWalletAddress = null;
    this.lastWalletAddress = null;
    this.explicitKey = false;
    // Logging out locks on its own, without anyone waiting for it. Chaining
    // lets a caller that does wait (before leaving the page, say) know every
    // earlier removal has finished too, not only its own.
    const removal = this.removal
      .catch(() => undefined)
      .then(async () => {
        for (const walletAddress of walletAddresses) await this.store.remove(walletAddress);
      });
    this.removal = removal;
    if (hadKey) this.emit('locked', undefined);
    await removal;
  }

  /**
   * Decrypt media downloaded from a result, preview or input URL. Returns a
   * Blob typed with the media's real MIME type. Pass `key` only for media that
   * was encrypted without an account recipient.
   */
  async decrypt(media: MediaSource, options: { key?: Uint8Array } = {}): Promise<Blob> {
    const { data } = await decryptMedia(media, (header) => this.resolveProjectKey(header, options));
    return data;
  }

  /**
   * Download a URL and return its content decrypted. Content that is not
   * encrypted is returned as downloaded, so callers can use one path for both.
   * Pass `requireEncrypted` for media you know belongs to an encrypted project
   * (`job.encrypted`): unencrypted content is then an error rather than
   * something to display.
   */
  async fetchDecrypted(
    url: string,
    options: { init?: RequestInit; requireEncrypted?: boolean } = {}
  ): Promise<Blob> {
    const response = await fetch(url, options.init);
    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (isEncryptedMedia(signature)) return this.decrypt(blob);
    if (options.requireEncrypted) {
      throw new MediaEncryptionError('not_encrypted', 'Media is not Sogni-encrypted');
    }
    return blob;
  }

  /**
   * Start encrypting a new project: mint its key and wrap it for the account.
   * @internal
   */
  async _createProjectEncryption(): Promise<ProjectMediaEncryption> {
    const accountKey = await this.requireAccountKey();
    const projectKey = randomBytes(MEDIA_KEY_BYTES);
    const recipient = await wrapProjectKey(accountKey, projectKey);
    // Input key (base64) -> that key wrapped for the worker. Two inputs with the same content share one.
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

  private async resolveProjectKey(
    header: MediaEncryptionHeader,
    options: { key?: Uint8Array }
  ): Promise<Uint8Array> {
    if (options.key) return options.key;
    return unwrapProjectKey(await this.requireAccountKey(), header.recipient);
  }

  private async requireAccountKey(): Promise<AccountMediaKey> {
    const key = await this.loadAccountKey();
    if (!key) {
      throw new MediaEncryptionError(
        'locked',
        'Media encryption is locked on this device. Call mediaEncryption.unlock(password) first'
      );
    }
    return key;
  }

  private async loadAccountKey(): Promise<AccountMediaKey | null> {
    const walletAddress = this.account.currentAccount.walletAddress;
    if (this.accountKey) {
      // A key set before the account was known (setAccountKey) belongs to whoever signs in.
      if (!this.keyWalletAddress || !walletAddress) return this.accountKey;
      if (this.keyWalletAddress.toLowerCase() === walletAddress.toLowerCase()) {
        return this.accountKey;
      }
      // A different account signed in on this client; its key is not this one.
      this.accountKey = null;
      this.keyWalletAddress = null;
    }
    if (!walletAddress) return null;
    let stored: AccountMediaKey | null;
    try {
      stored = await this.store.load(walletAddress);
    } catch (error) {
      // Storage blocked or unavailable: the same as having no stored key.
      this.client.logger.warn('Media key storage could not be read', error);
      return null;
    }
    if (!stored) return null;
    this.accountKey = stored;
    this.keyWalletAddress = walletAddress;
    this.emit('unlocked', undefined);
    return stored;
  }

  private async adoptWallet(wallet: Wallet): Promise<void> {
    // Reached from login as well: a key the integrator set must survive it.
    if (this.explicitKey) return;
    const walletKey = getBytes(wallet.privateKey);
    try {
      await this.setKey(await deriveAccountKey(walletKey), wallet.address);
    } finally {
      walletKey.fill(0);
    }
  }

  private async setKey(key: AccountMediaKey, walletAddress: string | null): Promise<void> {
    this.accountKey = key;
    this.keyWalletAddress = walletAddress;
    if (walletAddress) {
      try {
        await this.store.save(walletAddress, key);
      } catch (error) {
        // The key still works for this page load; the artist is asked again next visit.
        this.client.logger.warn('Media key could not be stored on this device', error);
      }
    }
    this.emit('unlocked', undefined);
  }
}

export default MediaEncryptionApi;
