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
 * Keys for a project's input files.
 * @internal
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

/** The key material of an input file, from its content. */
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

/** Random key material, for a large input. */
export function randomInputMaterial(): InputMediaMaterial {
  return split(randomBytes(MATERIAL_BYTES));
}

/** Largest input whose key material comes from its content. */
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
