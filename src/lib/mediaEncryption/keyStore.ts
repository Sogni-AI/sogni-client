import type { AccountMediaKey } from './recipient.js';

/** Where an account's media key is kept between page loads. */
export interface AccountKeyStore {
  load(walletAddress: string): Promise<AccountMediaKey | null>;
  save(walletAddress: string, key: AccountMediaKey): Promise<void>;
  remove(walletAddress: string): Promise<void>;
}

/** Process memory only. Used outside browsers. */
export class MemoryAccountKeyStore implements AccountKeyStore {
  private keys = new Map<string, AccountMediaKey>();

  async load(walletAddress: string) {
    return this.keys.get(walletAddress.toLowerCase()) ?? null;
  }

  async save(walletAddress: string, key: AccountMediaKey) {
    this.keys.set(walletAddress.toLowerCase(), key);
  }

  async remove(walletAddress: string) {
    this.keys.delete(walletAddress.toLowerCase());
  }
}

const DB_NAME = 'sogni-media-encryption';
const STORE_NAME = 'account-keys';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * IndexedDB store. The CryptoKeys are non-extractable and are persisted by
 * structured clone, so the key survives reloads without its bytes ever being
 * readable by script.
 */
export class IndexedDbAccountKeyStore implements AccountKeyStore {
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Media key storage is blocked by another tab'));
    });
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.open();
    try {
      const transaction = db.transaction(STORE_NAME, mode);
      // A request succeeding is not the change being saved: only the transaction
      // completing is, and a page that navigates away in between can lose it.
      const committed = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Media key storage transaction was aborted'));
      });
      committed.catch(() => undefined);
      const result = await request(run(transaction.objectStore(STORE_NAME)));
      await committed;
      return result;
    } finally {
      db.close();
    }
  }

  async load(walletAddress: string): Promise<AccountMediaKey | null> {
    const record = await this.withStore<Partial<AccountMediaKey> | undefined>('readonly', (store) =>
      store.get(walletAddress.toLowerCase())
    );
    // A record missing any part cannot encrypt or open everything; the account is simply locked.
    if (!record?.key || !record.checkKey || !record.inputKey) return null;
    return { key: record.key, checkKey: record.checkKey, inputKey: record.inputKey };
  }

  async save(walletAddress: string, key: AccountMediaKey): Promise<void> {
    await this.withStore('readwrite', (store) =>
      store.put(
        { key: key.key, checkKey: key.checkKey, inputKey: key.inputKey },
        walletAddress.toLowerCase()
      )
    );
  }

  async remove(walletAddress: string): Promise<void> {
    await this.withStore('readwrite', (store) => store.delete(walletAddress.toLowerCase()));
  }
}

export function createDefaultAccountKeyStore(): AccountKeyStore {
  return typeof indexedDB === 'undefined'
    ? new MemoryAccountKeyStore()
    : new IndexedDbAccountKeyStore();
}
