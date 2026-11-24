import {
  DEFAULT_SEGMENT_SIZE_LOG2,
  MAX_HEADER_BYTES,
  MEDIA_KEY_BYTES,
  MediaEncryptionError,
  MediaEncryptionHeader,
  NONCE_PREFIX_BYTES,
  SALT_BYTES,
  TAG_BYTES,
  encodeHeader,
  parseHeader,
  segmentNonce
} from './format.js';

export type MediaSource = Blob | ArrayBuffer | Uint8Array;

/** The Web Crypto API, or a clear error where it does not exist (a page without HTTPS, an old runtime). */
export function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) {
    throw new MediaEncryptionError(
      'unsupported',
      'Media encryption needs the Web Crypto API (a secure browser context, or Node.js 20+)'
    );
  }
  return api;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

export async function importAesGcmKey(raw: Uint8Array, extractable = false): Promise<CryptoKey> {
  if (raw.length !== MEDIA_KEY_BYTES) {
    throw new MediaEncryptionError('malformed', 'Media encryption keys must be 32 bytes');
  }
  return subtle().importKey('raw', raw as BufferSource, 'AES-GCM', extractable, [
    'encrypt',
    'decrypt'
  ]);
}

export async function aesGcmEncrypt(
  key: CryptoKey,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  additionalData?: Uint8Array
): Promise<Uint8Array> {
  const sealed = await subtle().encrypt(
    {
      name: 'AES-GCM',
      iv: nonce as BufferSource,
      tagLength: TAG_BYTES * 8,
      ...(additionalData ? { additionalData: additionalData as BufferSource } : {})
    },
    key,
    plaintext as BufferSource
  );
  return new Uint8Array(sealed);
}

export async function aesGcmDecrypt(
  key: CryptoKey,
  nonce: Uint8Array,
  sealed: Uint8Array,
  additionalData?: Uint8Array
): Promise<Uint8Array> {
  try {
    const opened = await subtle().decrypt(
      {
        name: 'AES-GCM',
        iv: nonce as BufferSource,
        tagLength: TAG_BYTES * 8,
        ...(additionalData ? { additionalData: additionalData as BufferSource } : {})
      },
      key,
      sealed as BufferSource
    );
    return new Uint8Array(opened);
  } catch {
    throw new MediaEncryptionError(
      'authentication_failed',
      'Encrypted media failed authentication: wrong key, or the data was changed or cut short'
    );
  }
}

function sourceLength(source: MediaSource): number {
  if (source instanceof Uint8Array) return source.length;
  if (source instanceof ArrayBuffer) return source.byteLength;
  return source.size;
}

/** Read `[start, end)` without holding the whole source in memory when it is a Blob. */
async function readRange(source: MediaSource, start: number, end: number): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source.subarray(start, end);
  if (source instanceof ArrayBuffer) return new Uint8Array(source, start, end - start);
  return new Uint8Array(await source.slice(start, end).arrayBuffer());
}

export async function deriveFileKey(projectKey: Uint8Array, header: Uint8Array, salt: Uint8Array) {
  const raw = await hkdfSha256(projectKey, salt, header, MEDIA_KEY_BYTES);
  try {
    return await importAesGcmKey(raw);
  } finally {
    raw.fill(0);
  }
}

export interface EncryptMediaOptions {
  /** 32-byte project key. */
  key: Uint8Array;
  /** MIME type of the plaintext, recorded in the authenticated header. */
  contentType?: string;
  /** Recipient record to embed, so the account key can open the file. */
  recipient?: Uint8Array;
  segmentSizeLog2?: number;
  /** @internal Fixed values, for input files and known-answer tests. */
  deterministic?: { salt: Uint8Array; noncePrefix: Uint8Array };
}

/** Encrypt media. The result is a Blob of type `application/octet-stream`. */
export async function encryptMedia(
  source: MediaSource,
  options: EncryptMediaOptions
): Promise<Blob> {
  if (options.key.length !== MEDIA_KEY_BYTES) {
    throw new MediaEncryptionError('malformed', 'Media encryption keys must be 32 bytes');
  }
  const segmentSizeLog2 = options.segmentSizeLog2 ?? DEFAULT_SEGMENT_SIZE_LOG2;
  const salt = options.deterministic?.salt ?? randomBytes(SALT_BYTES);
  const noncePrefix = options.deterministic?.noncePrefix ?? randomBytes(NONCE_PREFIX_BYTES);
  const header = encodeHeader({
    segmentSizeLog2,
    salt,
    noncePrefix,
    contentType: options.contentType ?? '',
    recipient: options.recipient ?? new Uint8Array(0)
  });
  const fileKey = await deriveFileKey(options.key, header, salt);
  const segmentSize = 2 ** segmentSizeLog2;
  const total = sourceLength(source);
  const segmentCount = Math.max(1, Math.ceil(total / segmentSize));
  const parts: Uint8Array[] = [header];
  for (let index = 0; index < segmentCount; index++) {
    const start = index * segmentSize;
    const plaintext = await readRange(source, start, Math.min(total, start + segmentSize));
    const isLast = index === segmentCount - 1;
    parts.push(await aesGcmEncrypt(fileKey, segmentNonce(noncePrefix, index, isLast), plaintext));
  }
  return new Blob(parts as BlobPart[], { type: 'application/octet-stream' });
}

export interface DecryptedMedia {
  /** Plaintext, typed with the MIME type recorded at encryption time. */
  data: Blob;
  contentType: string;
  header: MediaEncryptionHeader;
}

/** Read and parse just the header of an encrypted source. */
export async function readMediaHeader(source: MediaSource): Promise<MediaEncryptionHeader> {
  const prefix = await readRange(source, 0, Math.min(sourceLength(source), MAX_HEADER_BYTES));
  return parseHeader(prefix);
}

/** Decrypt media. `resolveKey` receives the parsed header and returns the file's key. */
export async function decryptMedia(
  source: MediaSource,
  resolveKey: (header: MediaEncryptionHeader) => Promise<Uint8Array> | Uint8Array
): Promise<DecryptedMedia> {
  const header = await readMediaHeader(source);
  const projectKey = await resolveKey(header);
  const fileKey = await deriveFileKey(projectKey, header.bytes, header.salt);
  const sealedSegmentSize = 2 ** header.segmentSizeLog2 + TAG_BYTES;
  const total = sourceLength(source);
  const bodyLength = total - header.bytes.length;
  if (bodyLength < TAG_BYTES) {
    throw new MediaEncryptionError('malformed', 'Encrypted media has no authenticated content');
  }
  const segmentCount = Math.ceil(bodyLength / sealedSegmentSize);
  const lastLength = bodyLength - (segmentCount - 1) * sealedSegmentSize;
  if (lastLength < TAG_BYTES) {
    throw new MediaEncryptionError('malformed', 'Encrypted media ends in a partial segment');
  }
  const parts: Uint8Array[] = [];
  for (let index = 0; index < segmentCount; index++) {
    const start = header.bytes.length + index * sealedSegmentSize;
    const sealed = await readRange(source, start, Math.min(total, start + sealedSegmentSize));
    const isLast = index === segmentCount - 1;
    parts.push(
      await aesGcmDecrypt(fileKey, segmentNonce(header.noncePrefix, index, isLast), sealed)
    );
  }
  return {
    data: new Blob(parts as BlobPart[], { type: header.contentType }),
    contentType: header.contentType,
    header
  };
}
