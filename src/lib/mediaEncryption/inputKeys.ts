import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  importAesGcmKey,
  randomBytes,
  subtle,
  type MediaSource
} from './crypto.js';
import { MEDIA_KEY_BYTES, MediaEncryptionError, ascii, utf8 } from './format.js';
import type { AccountMediaKey } from './recipient.js';

/**
 * Input media keys.
 *
 * A project's results are encrypted under its own random project key. Its
 * INPUTS are not: the same picture is often used for many projects, and a file
 * encrypted under a per-project key would have to be uploaded again for each.
 *
 * So every input file has a key of its own, derived on the artist's device
 * from the account key and the file's content. The salt, nonce prefix and
 * recipient nonce are derived with it, which makes the whole encrypted file a
 * pure function of (account, content, content type): the same artist uploading
 * the same file again produces the same bytes, and the upload library
 * recognises them by their hash without ever learning the hash of the
 * plaintext. Another account's copy of the same file shares nothing with it.
 *
 * Reusing the salt and nonces is safe exactly because the key is derived from
 * the content alongside them: that key never encrypts anything else.
 *
 * The worker rendering a project receives the input keys wrapped under the
 * project key (`wrapInputKey`), in the job request's `mediaEncryption.inputKeys`.
 * A wrapped key is useless without the project key, so unlike the project key
 * it needs no special handling on the way there.
 *
 * Wrapped input key, 60 bytes:
 *   nonce(12) || AES-256-GCM(projectKey, nonce, inputKey, aad)(48)
 */

const INPUT_MATERIAL_INFO_PREFIX = 'input-media-v1\0';
const INPUT_KEY_AAD = ascii('sogni-media-input-key-v1');
const SALT_BYTES = 32;
const NONCE_PREFIX_BYTES = 7;
const NONCE_BYTES = 12;
const MATERIAL_BYTES = MEDIA_KEY_BYTES + SALT_BYTES + NONCE_PREFIX_BYTES + NONCE_BYTES;
export const WRAPPED_INPUT_KEY_BYTES = NONCE_BYTES + MEDIA_KEY_BYTES + 16;
/** The most input keys one project may carry. */
export const MAX_INPUT_KEYS = 32;

/** Everything that decides the bytes of one encrypted input file. */
export interface InputMediaMaterial {
  key: Uint8Array;
  salt: Uint8Array;
  noncePrefix: Uint8Array;
  recipientNonce: Uint8Array;
}

function split(material: Uint8Array): InputMediaMaterial {
  let offset = 0;
  const take = (length: number) => material.slice(offset, (offset += length));
  return {
    key: take(MEDIA_KEY_BYTES),
    salt: take(SALT_BYTES),
    noncePrefix: take(NONCE_PREFIX_BYTES),
    recipientNonce: take(NONCE_BYTES)
  };
}

/** The key material of an input file, from the SHA-256 of its plaintext. */
export async function deriveInputMaterial(
  account: AccountMediaKey,
  plaintextSha256: Uint8Array,
  contentType: string
): Promise<InputMediaMaterial> {
  if (plaintextSha256.length !== 32) {
    throw new MediaEncryptionError('malformed', 'Input media hashes must be 32 bytes');
  }
  const bits = await subtle().deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: plaintextSha256 as BufferSource,
      info: utf8(INPUT_MATERIAL_INFO_PREFIX + contentType) as BufferSource
    },
    account.inputKey,
    MATERIAL_BYTES * 8
  );
  return split(new Uint8Array(bits));
}

/** Random material, for an input too large to be hashed in one piece (it cannot be reused anyway). */
export function randomInputMaterial(): InputMediaMaterial {
  return split(randomBytes(MATERIAL_BYTES));
}

/**
 * Web Crypto hashes a whole buffer at once, so deriving a key from the content
 * means holding the file in memory. The upload library only keeps files up to
 * this size, so nothing larger could be reused anyway.
 */
export const MAX_CONTENT_KEYED_INPUT_BYTES = 100 * 1024 * 1024;

/** The key material for one input: from its content when it can be reused, random otherwise. */
export async function inputMaterialForMedia(
  account: AccountMediaKey,
  media: MediaSource,
  contentType: string
): Promise<InputMediaMaterial> {
  const length =
    media instanceof Uint8Array
      ? media.length
      : media instanceof ArrayBuffer
        ? media.byteLength
        : media.size;
  if (length > MAX_CONTENT_KEYED_INPUT_BYTES) return randomInputMaterial();
  const bytes =
    media instanceof Uint8Array || media instanceof ArrayBuffer ? media : await media.arrayBuffer();
  const digest = await subtle().digest('SHA-256', bytes as BufferSource);
  return deriveInputMaterial(account, new Uint8Array(digest), contentType);
}

export async function wrapInputKey(
  projectKey: Uint8Array,
  inputKey: Uint8Array,
  /** @internal Fixed nonce, for known-answer tests only. */
  deterministicNonce?: Uint8Array
): Promise<Uint8Array> {
  if (projectKey.length !== MEDIA_KEY_BYTES || inputKey.length !== MEDIA_KEY_BYTES) {
    throw new MediaEncryptionError('malformed', 'Media encryption keys must be 32 bytes');
  }
  const nonce = deterministicNonce ?? randomBytes(NONCE_BYTES);
  const sealed = await aesGcmEncrypt(
    await importAesGcmKey(projectKey),
    nonce,
    inputKey,
    INPUT_KEY_AAD
  );
  const wrapped = new Uint8Array(WRAPPED_INPUT_KEY_BYTES);
  wrapped.set(nonce, 0);
  wrapped.set(sealed, NONCE_BYTES);
  return wrapped;
}

export async function unwrapInputKey(
  projectKey: Uint8Array,
  wrapped: Uint8Array
): Promise<Uint8Array> {
  if (wrapped.length !== WRAPPED_INPUT_KEY_BYTES) {
    throw new MediaEncryptionError('malformed', 'Wrapped input media key is not recognized');
  }
  return aesGcmDecrypt(
    await importAesGcmKey(projectKey),
    wrapped.subarray(0, NONCE_BYTES),
    wrapped.subarray(NONCE_BYTES),
    INPUT_KEY_AAD
  );
}
