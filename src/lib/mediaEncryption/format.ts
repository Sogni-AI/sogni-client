/**
 * `SOGNIE2E` v1 container: a streaming AEAD file format for project media.
 *
 * Same construction as Tink's AES256_GCM_HKDF_1MB: a per-file key is derived
 * from the project key and a random salt, the plaintext is split into
 * fixed-size segments, and each segment is sealed with AES-256-GCM under a
 * nonce that carries its index and a last-segment flag. Segments cannot be
 * reordered, dropped or truncated without failing authentication.
 *
 * Layout (integers big-endian):
 *
 *   0    8   magic "SOGNIE2E"
 *   8    1   version (1)
 *   9    1   segmentSizeLog2 (plaintext bytes per segment = 2^n, 16..24)
 *   10   32  salt
 *   42   7   noncePrefix
 *   49   1   contentTypeLength C
 *   50   C   contentType (UTF-8 MIME type of the plaintext)
 *   50+C 2   recipientLength R
 *   52+C R   recipient stanza (opaque here; see recipient.ts)
 *   ...      segments: AES-256-GCM ciphertext || 16-byte tag
 *
 * The Comfy worker carries a byte-identical implementation on node:crypto.
 * Change nothing here without changing both and the shared test vectors.
 */

export const MEDIA_ENCRYPTION_VERSION = 1;
export const MEDIA_ENCRYPTION_MAGIC = new Uint8Array([
  0x53, 0x4f, 0x47, 0x4e, 0x49, 0x45, 0x32, 0x45
]); // "SOGNIE2E"
export const MEDIA_KEY_BYTES = 32;
export const SALT_BYTES = 32;
export const NONCE_PREFIX_BYTES = 7;
export const TAG_BYTES = 16;
export const DEFAULT_SEGMENT_SIZE_LOG2 = 20;
export const MIN_SEGMENT_SIZE_LOG2 = 16;
export const MAX_SEGMENT_SIZE_LOG2 = 24;
export const MAX_CONTENT_TYPE_BYTES = 255;
/**
 * The header is the HKDF `info`, which Node caps at 1024 bytes: 52 fixed bytes,
 * up to 255 of content type, and the recipient. 512 keeps every valid header under it.
 */
export const MAX_RECIPIENT_BYTES = 512;
/** Fixed-size part of the header, before the content type. */
const FIXED_HEADER_BYTES = 50;

export interface MediaEncryptionHeader {
  version: number;
  segmentSizeLog2: number;
  salt: Uint8Array;
  noncePrefix: Uint8Array;
  /** MIME type of the plaintext; empty when the producer did not know it. */
  contentType: string;
  /** Project key wrapped for the artist's account key; empty when absent. */
  recipient: Uint8Array;
  /** Exact header bytes. Bound into the file key, so they are part of what is authenticated. */
  bytes: Uint8Array;
}

export class MediaEncryptionError extends Error {
  /**
   * - `not_encrypted`: the data does not start with the container magic.
   * - `unsupported_version`: a newer container than this SDK understands.
   * - `malformed`: the header or segment framing is invalid.
   * - `authentication_failed`: wrong key, or the data was modified or truncated.
   * - `locked`: no account key is available on this device.
   * - `wrong_account_key`: the media was encrypted for a different account key.
   * - `no_recipient`: the media carries no recipient stanza; an explicit key is needed.
   * - `invalid_password`: the password does not belong to the signed-in account.
   * - `password_unavailable`: the account signs in only with a provider (Google,
   *   Apple) and has no password to derive its media key from.
   * - `unsupported`: this account, model or runtime cannot use media encryption.
   */
  code:
    | 'not_encrypted'
    | 'unsupported_version'
    | 'malformed'
    | 'authentication_failed'
    | 'locked'
    | 'wrong_account_key'
    | 'no_recipient'
    | 'invalid_password'
    | 'password_unavailable'
    | 'unsupported';

  constructor(code: MediaEncryptionError['code'], message: string) {
    super(message);
    this.name = 'MediaEncryptionError';
    this.code = code;
  }
}

// Created on first use: some runtimes an app may import the SDK into (jsdom
// test environments, older embedded engines) have no TextEncoder, and only
// media encryption needs one.
let textEncoder: TextEncoder | undefined;
let textDecoder: TextDecoder | undefined;

/** Bytes of a constant ASCII label, built without TextEncoder so it can run at import. */
export function ascii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 0x7f) throw new Error(`Not an ASCII label: ${value}`);
    bytes[i] = code;
  }
  return bytes;
}

export function utf8(value: string): Uint8Array {
  return (textEncoder ??= new TextEncoder()).encode(value);
}

/** True when `bytes` begins with the container magic. Needs only the first 8 bytes. */
export function isEncryptedMedia(bytes: Uint8Array): boolean {
  if (bytes.length < MEDIA_ENCRYPTION_MAGIC.length) return false;
  for (let i = 0; i < MEDIA_ENCRYPTION_MAGIC.length; i++) {
    if (bytes[i] !== MEDIA_ENCRYPTION_MAGIC[i]) return false;
  }
  return true;
}

export function encodeHeader(fields: {
  segmentSizeLog2: number;
  salt: Uint8Array;
  noncePrefix: Uint8Array;
  contentType: string;
  recipient: Uint8Array;
}): Uint8Array {
  const { segmentSizeLog2, salt, noncePrefix, recipient } = fields;
  if (
    !Number.isInteger(segmentSizeLog2) ||
    segmentSizeLog2 < MIN_SEGMENT_SIZE_LOG2 ||
    segmentSizeLog2 > MAX_SEGMENT_SIZE_LOG2
  ) {
    throw new MediaEncryptionError('malformed', 'Unsupported media encryption segment size');
  }
  if (salt.length !== SALT_BYTES || noncePrefix.length !== NONCE_PREFIX_BYTES) {
    throw new MediaEncryptionError('malformed', 'Invalid media encryption salt or nonce prefix');
  }
  const contentType = utf8(fields.contentType);
  if (contentType.length > MAX_CONTENT_TYPE_BYTES) {
    throw new MediaEncryptionError('malformed', 'Media content type is too long to encrypt');
  }
  if (recipient.length > MAX_RECIPIENT_BYTES) {
    throw new MediaEncryptionError('malformed', 'Media encryption recipient is too long');
  }
  const header = new Uint8Array(FIXED_HEADER_BYTES + contentType.length + 2 + recipient.length);
  let offset = 0;
  header.set(MEDIA_ENCRYPTION_MAGIC, offset);
  offset += MEDIA_ENCRYPTION_MAGIC.length;
  header[offset++] = MEDIA_ENCRYPTION_VERSION;
  header[offset++] = segmentSizeLog2;
  header.set(salt, offset);
  offset += SALT_BYTES;
  header.set(noncePrefix, offset);
  offset += NONCE_PREFIX_BYTES;
  header[offset++] = contentType.length;
  header.set(contentType, offset);
  offset += contentType.length;
  header[offset++] = (recipient.length >> 8) & 0xff;
  header[offset++] = recipient.length & 0xff;
  header.set(recipient, offset);
  return header;
}

/**
 * Parse the header at the start of `bytes`. `bytes` may be the whole file or
 * any prefix long enough to hold the header (at most 819 bytes).
 */
export function parseHeader(bytes: Uint8Array): MediaEncryptionHeader {
  if (!isEncryptedMedia(bytes)) {
    throw new MediaEncryptionError('not_encrypted', 'Media is not Sogni-encrypted');
  }
  if (bytes.length < FIXED_HEADER_BYTES) {
    throw new MediaEncryptionError('malformed', 'Encrypted media header is truncated');
  }
  let offset = MEDIA_ENCRYPTION_MAGIC.length;
  const version = bytes[offset++];
  if (version !== MEDIA_ENCRYPTION_VERSION) {
    throw new MediaEncryptionError(
      'unsupported_version',
      `Encrypted media version ${version} is not supported by this SDK version`
    );
  }
  const segmentSizeLog2 = bytes[offset++];
  if (segmentSizeLog2 < MIN_SEGMENT_SIZE_LOG2 || segmentSizeLog2 > MAX_SEGMENT_SIZE_LOG2) {
    throw new MediaEncryptionError('malformed', 'Encrypted media segment size is invalid');
  }
  const salt = bytes.slice(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const noncePrefix = bytes.slice(offset, offset + NONCE_PREFIX_BYTES);
  offset += NONCE_PREFIX_BYTES;
  const contentTypeLength = bytes[offset++];
  if (bytes.length < offset + contentTypeLength + 2) {
    throw new MediaEncryptionError('malformed', 'Encrypted media header is truncated');
  }
  let contentType: string;
  try {
    contentType = (textDecoder ??= new TextDecoder('utf-8', { fatal: true })).decode(
      bytes.subarray(offset, offset + contentTypeLength)
    );
  } catch {
    throw new MediaEncryptionError('malformed', 'Encrypted media content type is not valid UTF-8');
  }
  offset += contentTypeLength;
  const recipientLength = (bytes[offset] << 8) | bytes[offset + 1];
  offset += 2;
  if (recipientLength > MAX_RECIPIENT_BYTES || bytes.length < offset + recipientLength) {
    throw new MediaEncryptionError('malformed', 'Encrypted media header is truncated');
  }
  const recipient = bytes.slice(offset, offset + recipientLength);
  offset += recipientLength;
  return {
    version,
    segmentSizeLog2,
    salt,
    noncePrefix,
    contentType,
    recipient,
    bytes: bytes.slice(0, offset)
  };
}

/** Largest possible header, so callers can fetch a prefix and still parse it. */
export const MAX_HEADER_BYTES =
  FIXED_HEADER_BYTES + MAX_CONTENT_TYPE_BYTES + 2 + MAX_RECIPIENT_BYTES;

export function segmentNonce(noncePrefix: Uint8Array, index: number, isLast: boolean): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce.set(noncePrefix, 0);
  nonce[7] = (index >>> 24) & 0xff;
  nonce[8] = (index >>> 16) & 0xff;
  nonce[9] = (index >>> 8) & 0xff;
  nonce[10] = index & 0xff;
  nonce[11] = isLast ? 1 : 0;
  return nonce;
}
