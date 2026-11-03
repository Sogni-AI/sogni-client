import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  hkdfSha256,
  importAesGcmKey,
  randomBytes,
  subtle
} from './crypto.js';
import { MEDIA_KEY_BYTES, MediaEncryptionError, ascii } from './format.js';

/**
 * Account key and recipient stanza.
 *
 * The account key never leaves the artist's device. Every encrypted file
 * carries the project key wrapped under it (the "recipient stanza"), so any
 * device that can derive the account key can open any of the account's files
 * without asking a server for keys.
 *
 * Stanza v1, 69 bytes:
 *   0x01 || keyCheck(8) || nonce(12) || AES-256-GCM(accountKey, nonce, projectKey, aad)(48)
 *
 * `keyCheck` lets the holder of an account key tell "this was encrypted for a
 * different account key" from "this is corrupt". It is derived from the
 * stanza's own random nonce, so it differs for every project: workers and
 * storage see the stanza, and a value that stayed the same would let them link
 * all of an account's projects together.
 */

const DERIVATION_SALT = ascii('sogni-media-encryption');
const ACCOUNT_KEY_INFO = ascii('account-key-v1');
const KEY_CHECK_SECRET_INFO = ascii('key-check-secret-v1');
const INPUT_SECRET_INFO = ascii('input-secret-v1');
const KEY_CHECK_INFO = ascii('key-check-v1');
const RECIPIENT_AAD = ascii('sogni-media-recipient-v1');
const RECIPIENT_VERSION = 1;
const KEY_CHECK_BYTES = 8;
const NONCE_BYTES = 12;
const WRAPPED_KEY_BYTES = MEDIA_KEY_BYTES + 16;
export const RECIPIENT_BYTES = 1 + KEY_CHECK_BYTES + NONCE_BYTES + WRAPPED_KEY_BYTES;

/**
 * An account key ready for use. Every part is a non-extractable CryptoKey, so
 * they can be kept in IndexedDB and used by the page without their bytes being
 * readable.
 */
export interface AccountMediaKey {
  /** AES-256-GCM key that wraps project and input keys. */
  key: CryptoKey;
  /** HKDF key that derives each stanza's `keyCheck`. */
  checkKey: CryptoKey;
  /** HKDF key that derives the key of each input file from its content (see `inputKeys.ts`). */
  inputKey: CryptoKey;
}

async function deriveKeyCheck(account: AccountMediaKey, nonce: Uint8Array): Promise<Uint8Array> {
  const bits = await subtle().deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: nonce as BufferSource,
      info: KEY_CHECK_INFO as BufferSource
    },
    account.checkKey,
    KEY_CHECK_BYTES * 8
  );
  return new Uint8Array(bits);
}

/** Turn 32 secret bytes into an account key. The input bytes are not retained. */
export async function importAccountKey(secret: Uint8Array): Promise<AccountMediaKey> {
  if (secret.length !== MEDIA_KEY_BYTES) {
    throw new MediaEncryptionError('malformed', 'Account media keys must be 32 bytes');
  }
  const importHkdfKey = async (info: Uint8Array) => {
    const derived = await hkdfSha256(secret, DERIVATION_SALT, info, MEDIA_KEY_BYTES);
    try {
      return await subtle().importKey('raw', derived as BufferSource, 'HKDF', false, [
        'deriveBits'
      ]);
    } finally {
      derived.fill(0);
    }
  };
  return {
    key: await importAesGcmKey(secret),
    checkKey: await importHkdfKey(KEY_CHECK_SECRET_INFO),
    inputKey: await importHkdfKey(INPUT_SECRET_INFO)
  };
}

/**
 * Derive the account key from the account's wallet private key (32 bytes).
 * The wallet key is already derived from the username and password at login,
 * so this needs no extra secret from the artist.
 */
export async function deriveAccountKey(walletPrivateKey: Uint8Array): Promise<AccountMediaKey> {
  if (walletPrivateKey.length !== MEDIA_KEY_BYTES) {
    throw new MediaEncryptionError('malformed', 'Wallet key must be 32 bytes');
  }
  const secret = await hkdfSha256(
    walletPrivateKey,
    DERIVATION_SALT,
    ACCOUNT_KEY_INFO,
    MEDIA_KEY_BYTES
  );
  try {
    return await importAccountKey(secret);
  } finally {
    secret.fill(0);
  }
}

export async function wrapProjectKey(
  account: AccountMediaKey,
  projectKey: Uint8Array,
  /**
   * @internal A fixed nonce. Only for a key that is itself derived together
   * with this nonce (an input key, see `inputKeys.ts`), so the pair never wraps
   * two different keys; and for known-answer tests.
   */
  deterministicNonce?: Uint8Array
): Promise<Uint8Array> {
  if (projectKey.length !== MEDIA_KEY_BYTES) {
    throw new MediaEncryptionError('malformed', 'Media encryption keys must be 32 bytes');
  }
  const nonce = deterministicNonce ?? randomBytes(NONCE_BYTES);
  const wrapped = await aesGcmEncrypt(account.key, nonce, projectKey, RECIPIENT_AAD);
  const stanza = new Uint8Array(RECIPIENT_BYTES);
  stanza[0] = RECIPIENT_VERSION;
  stanza.set(await deriveKeyCheck(account, nonce), 1);
  stanza.set(nonce, 1 + KEY_CHECK_BYTES);
  stanza.set(wrapped, 1 + KEY_CHECK_BYTES + NONCE_BYTES);
  return stanza;
}

export async function unwrapProjectKey(
  account: AccountMediaKey,
  stanza: Uint8Array
): Promise<Uint8Array> {
  if (stanza.length === 0) {
    throw new MediaEncryptionError(
      'no_recipient',
      'This media was encrypted without an account recipient; its project key is required'
    );
  }
  if (stanza.length !== RECIPIENT_BYTES || stanza[0] !== RECIPIENT_VERSION) {
    throw new MediaEncryptionError('malformed', 'Encrypted media recipient is not recognized');
  }
  const nonce = stanza.subarray(1 + KEY_CHECK_BYTES, 1 + KEY_CHECK_BYTES + NONCE_BYTES);
  const expected = await deriveKeyCheck(account, nonce);
  const keyCheck = stanza.subarray(1, 1 + KEY_CHECK_BYTES);
  let mismatch = 0;
  for (let i = 0; i < KEY_CHECK_BYTES; i++) mismatch |= keyCheck[i] ^ expected[i];
  if (mismatch !== 0) {
    throw new MediaEncryptionError(
      'wrong_account_key',
      'This media was encrypted for a different account key'
    );
  }
  const wrapped = stanza.subarray(1 + KEY_CHECK_BYTES + NONCE_BYTES);
  return aesGcmDecrypt(account.key, nonce, wrapped, RECIPIENT_AAD);
}
