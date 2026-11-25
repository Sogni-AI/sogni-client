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
 * The account's media key, and the recipient record that lets it open a file.
 */

const DERIVATION_SALT = ascii('sogni-media-encryption');
const KEY_CHECK_SECRET_INFO = ascii('key-check-secret-v1');
const INPUT_SECRET_INFO = ascii('input-secret-v1');
const KEY_CHECK_INFO = ascii('key-check-v1');
const RECIPIENT_AAD = ascii('sogni-media-recipient-v1');
const RECIPIENT_VERSION = 1;
const KEY_CHECK_BYTES = 8;
const NONCE_BYTES = 12;
const WRAPPED_KEY_BYTES = MEDIA_KEY_BYTES + 16;
export const RECIPIENT_BYTES = 1 + KEY_CHECK_BYTES + NONCE_BYTES + WRAPPED_KEY_BYTES;

/** An account media key ready for use. */
export interface AccountMediaKey {
  /** @internal */
  key: CryptoKey;
  /** @internal */
  checkKey: CryptoKey;
  /** @internal */
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

/** Turn 32 bytes into an account media key. */
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

export async function wrapProjectKey(
  account: AccountMediaKey,
  projectKey: Uint8Array,
  /** @internal Fixed value, for input files and known-answer tests. */
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

/** Open a recipient record with the account's key. */
export async function unwrapProjectKey(
  accounts: AccountMediaKey | readonly AccountMediaKey[],
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
  const keyCheck = stanza.subarray(1, 1 + KEY_CHECK_BYTES);
  const wrapped = stanza.subarray(1 + KEY_CHECK_BYTES + NONCE_BYTES);
  for (const account of 'key' in accounts ? [accounts] : accounts) {
    const expected = await deriveKeyCheck(account, nonce);
    let mismatch = 0;
    for (let i = 0; i < KEY_CHECK_BYTES; i++) mismatch |= keyCheck[i] ^ expected[i];
    if (mismatch === 0) return aesGcmDecrypt(account.key, nonce, wrapped, RECIPIENT_AAD);
  }
  throw new MediaEncryptionError(
    'wrong_account_key',
    'This media was encrypted for a different account key'
  );
}
