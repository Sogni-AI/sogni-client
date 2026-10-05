export type MediaType = 'image' | 'audio' | 'video';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface InlineMediaValidationOptions {
  maxBytes?: number;
  maxImageLongestSide?: number;
  remoteFetchTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface ParsedInlineMediaData {
  mimeType: string;
  blob: Blob;
  byteLength: number;
  imageDimensions?: ImageDimensions;
}

type ImageFormat = 'jpeg' | 'png';
type AudioFormat = 'mpeg' | 'wav' | 'mp4';
type VideoFormat = 'mp4' | 'quicktime';

const BASE64_BODY_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

const IMAGE_MIME_FORMATS: Record<string, ImageFormat> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png'
};

const AUDIO_MIME_FORMATS: Record<string, AudioFormat> = {
  'audio/m4a': 'mp4',
  'audio/mp3': 'mpeg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mpeg',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-m4a': 'mp4',
  'audio/x-wav': 'wav'
};

const VIDEO_MIME_FORMATS: Record<string, VideoFormat> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'quicktime'
};

function getAllowedMimeTypes(mediaType: MediaType): string[] {
  switch (mediaType) {
    case 'image':
      return Object.keys(IMAGE_MIME_FORMATS);
    case 'audio':
      return Object.keys(AUDIO_MIME_FORMATS);
    case 'video':
      return Object.keys(VIDEO_MIME_FORMATS);
    default:
      return [];
  }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (start + length > bytes.length) {
    return '';
  }
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function hasPrefix(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  if (offset + prefix.length > bytes.length) {
    return false;
  }
  return prefix.every((value, index) => bytes[offset + index] === value);
}

function addBase64Padding(base64: string): string {
  const remainder = base64.length % 4;
  if (remainder === 0) return base64;
  if (remainder === 1) {
    throw new Error('Invalid base64 payload');
  }
  return base64.padEnd(base64.length + (4 - remainder), '=');
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  if (typeof btoa === 'function') {
    return btoa(binary);
  }

  throw new Error('No base64 encoder available in this environment');
}

function decodeStrictBase64(base64: string): Uint8Array {
  const sanitized = base64.replace(/\s+/g, '');
  if (!BASE64_BODY_PATTERN.test(sanitized)) {
    throw new Error('Invalid base64 payload');
  }

  const padded = addBase64Padding(sanitized);
  let bytes: Uint8Array;

  if (typeof Buffer !== 'undefined') {
    bytes = Uint8Array.from(Buffer.from(padded, 'base64'));
  } else if (typeof atob === 'function') {
    const binaryString = atob(padded);
    bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
  } else {
    throw new Error('No base64 decoder available in this environment');
  }

  if (bytes.length === 0) {
    throw new Error('Invalid base64 payload');
  }

  if (encodeBase64(bytes) !== padded) {
    throw new Error('Invalid base64 payload');
  }

  return bytes;
}

function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png';
  }
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return 'jpeg';
  }
  return null;
}

function detectIsoBmffFormat(bytes: Uint8Array): 'mp4' | 'quicktime' | null {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') {
    return null;
  }

  const majorBrand = ascii(bytes, 8, 4);
  if (majorBrand === 'qt  ') {
    return 'quicktime';
  }
  return 'mp4';
}

function isLikelyMp3Frame(bytes: Uint8Array): boolean {
  if (bytes.length < 2) {
    return false;
  }
  const b0 = bytes[0];
  const b1 = bytes[1];
  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  return b0 === 0xff && (b1 & 0xe0) === 0xe0 && versionBits !== 0x01 && layerBits !== 0x00;
}

function detectAudioFormat(bytes: Uint8Array): AudioFormat | null {
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') {
    return 'wav';
  }
  if (ascii(bytes, 0, 3) === 'ID3' || isLikelyMp3Frame(bytes)) {
    return 'mpeg';
  }

  const isoFormat = detectIsoBmffFormat(bytes);
  if (isoFormat === 'mp4') {
    return 'mp4';
  }

  return null;
}

function detectVideoFormat(bytes: Uint8Array): VideoFormat | null {
  const isoFormat = detectIsoBmffFormat(bytes);
  if (isoFormat === 'quicktime') {
    return 'quicktime';
  }
  if (isoFormat === 'mp4') {
    return 'mp4';
  }
  return null;
}

function parsePngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') {
    return null;
  }
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function parseJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2;

  while (offset + 1 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) {
      offset += 1;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) {
      break;
    }

    const marker = bytes[offset];
    offset += 1;

    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      continue;
    }

    if (offset + 1 >= bytes.length) {
      break;
    }

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break;
    }

    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      if (offset + 6 >= bytes.length) {
        break;
      }
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width > 0 && height > 0) {
        return { width, height };
      }
      return null;
    }

    offset += segmentLength;
  }

  return null;
}

function parseImageDimensions(bytes: Uint8Array, format: ImageFormat): ImageDimensions | null {
  switch (format) {
    case 'png':
      return parsePngDimensions(bytes);
    case 'jpeg':
      return parseJpegDimensions(bytes);
    default:
      return null;
  }
}

function validateMagicBytes(
  mediaType: MediaType,
  mimeType: string,
  bytes: Uint8Array
): ImageDimensions | undefined {
  if (mediaType === 'image') {
    const expectedFormat = IMAGE_MIME_FORMATS[mimeType];
    if (!expectedFormat) {
      throw new Error(
        `Unsupported inline image MIME type ${mimeType}. Allowed types: ${getAllowedMimeTypes('image').join(', ')}`
      );
    }
    const detectedFormat = detectImageFormat(bytes);
    if (detectedFormat !== expectedFormat) {
      throw new Error(`Inline image data does not match declared MIME type ${mimeType}`);
    }

    const dimensions = parseImageDimensions(bytes, detectedFormat);
    if (!dimensions) {
      throw new Error('Unable to determine inline image dimensions');
    }
    return dimensions;
  }

  if (mediaType === 'audio') {
    const expectedFormat = AUDIO_MIME_FORMATS[mimeType];
    if (!expectedFormat) {
      throw new Error(
        `Unsupported inline audio MIME type ${mimeType}. Allowed types: ${getAllowedMimeTypes('audio').join(', ')}`
      );
    }
    const detectedFormat = detectAudioFormat(bytes);
    if (detectedFormat !== expectedFormat) {
      throw new Error(`Inline audio data does not match declared MIME type ${mimeType}`);
    }
    return undefined;
  }

  const expectedFormat = VIDEO_MIME_FORMATS[mimeType];
  if (!expectedFormat) {
    throw new Error(
      `Unsupported inline video MIME type ${mimeType}. Allowed types: ${getAllowedMimeTypes('video').join(', ')}`
    );
  }
  const detectedFormat = detectVideoFormat(bytes);
  if (detectedFormat !== expectedFormat) {
    throw new Error(`Inline video data does not match declared MIME type ${mimeType}`);
  }
  return undefined;
}

function mimeTypeForDetectedFormat(mediaType: MediaType, bytes: Uint8Array): string {
  if (mediaType === 'image') {
    const format = detectImageFormat(bytes);
    if (format === 'png') return 'image/png';
    if (format === 'jpeg') return 'image/jpeg';
  } else if (mediaType === 'audio') {
    const format = detectAudioFormat(bytes);
    if (format === 'wav') return 'audio/wav';
    if (format === 'mpeg') return 'audio/mpeg';
    if (format === 'mp4') return 'audio/mp4';
  } else {
    const format = detectVideoFormat(bytes);
    if (format === 'quicktime') return 'video/quicktime';
    if (format === 'mp4') return 'video/mp4';
  }
  throw new Error(
    `Remote ${mediaType} input is not a supported format. Allowed types: ${getAllowedMimeTypes(mediaType).join(', ')}`
  );
}

function normalizeResponseMimeType(
  mediaType: MediaType,
  contentType: string | null,
  bytes: Uint8Array
): string {
  const mimeType = contentType?.split(';')[0]?.trim().toLowerCase() || '';
  if (getAllowedMimeTypes(mediaType).includes(mimeType)) return mimeType;
  return mimeTypeForDetectedFormat(mediaType, bytes);
}

function throwMediaByteLimit(mediaType: MediaType, maxBytes: number): never {
  throw new Error(`${mediaType} input exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit`);
}

async function readResponseBytes(
  response: Response,
  mediaType: MediaType,
  maxBytes: number | undefined
): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (maxBytes !== undefined && bytes.length > maxBytes) {
      throwMediaByteLimit(mediaType, maxBytes);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (maxBytes !== undefined && totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the size-limit error below.
        }
        throwMediaByteLimit(mediaType, maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const DEFAULT_REMOTE_MEDIA_FETCH_TIMEOUT_MS = 20_000;

/**
 * Cloudflare R2 buckets that hold Sogni's signed generation inputs and outputs.
 * Matched by exact host only: every R2 customer serves from a subdomain of
 * `r2.cloudflarestorage.com`, so a suffix match would trust anyone's bucket.
 */
const SOGNI_R2_MEDIA_HOSTS: ReadonlySet<string> = new Set([
  'generation-output-production.234df6a88ee221ecac622f8b1a9609e0.r2.cloudflarestorage.com',
  'generation-output-staging.234df6a88ee221ecac622f8b1a9609e0.r2.cloudflarestorage.com',
  'generation-input-production.234df6a88ee221ecac622f8b1a9609e0.r2.cloudflarestorage.com',
  'generation-input-staging.234df6a88ee221ecac622f8b1a9609e0.r2.cloudflarestorage.com'
]);

function trustedRemoteMediaUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    const trusted =
      host === 'cdn.sogni.ai' ||
      host.endsWith('.sogni.ai') ||
      SOGNI_R2_MEDIA_HOSTS.has(host) ||
      host === 'complete-images-production.s3.amazonaws.com' ||
      /^[a-z0-9.-]+\.s3\.amazonaws\.com$/i.test(host) ||
      /^[a-z0-9.-]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/i.test(host) ||
      /^s3\.[a-z0-9-]+\.amazonaws\.com$/i.test(host) ||
      // S3 Transfer Acceleration, which Sogni's signed result and upload links use.
      /^[a-z0-9.-]+\.s3-accelerate(\.dualstack)?\.amazonaws\.com$/i.test(host) ||
      host.endsWith('.cloudfront.net');
    return trusted ? url : null;
  } catch {
    return null;
  }
}

function validateImageDimensions(dimensions: ImageDimensions, maxLongestSide: number): void {
  if (Math.max(dimensions.width, dimensions.height) > maxLongestSide) {
    throw new Error(
      `Inline image exceeds maximum dimensions of ${maxLongestSide}px on its longest side`
    );
  }
}

const DATA_URI_SCHEME = 'data:';
const DATA_URI_BASE64_SUFFIX = ';base64';

/**
 * Split `data:<mime>;base64,<payload>` (scheme and `;base64` case-insensitive)
 * into the declared MIME type and the payload using string operations only.
 *
 * The payload must not go through a regexp `+` loop. Once a process has
 * compiled about 1 MB of regexp code, V8 stops optimizing the regexps it
 * compiles afterwards (TooMuchRegExpCode in src/regexp/regexp.cc), and an
 * unoptimized `[...]+` loop takes 16 bytes of backtrack stack per character.
 * The old `/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i` therefore threw
 * "Maximum call stack size exceeded" for any input over ~3 MB (4M base64
 * characters) in long-running processes, the same failure sogni-api hit in
 * production on 2026-10-02..04. A `[...]*` loop is a greedy loop that keeps no
 * per-character backtrack state, so `decodeStrictBase64`, which checks the
 * payload's alphabet, is unaffected.
 */
function splitBase64DataUri(input: string): { mimeType: string; base64: string } | undefined {
  const comma = input.indexOf(',');
  if (comma < 0 || comma === input.length - 1) return undefined;
  const header = input.slice(0, comma);
  if (header.length <= DATA_URI_SCHEME.length + DATA_URI_BASE64_SUFFIX.length) return undefined;
  if (header.slice(0, DATA_URI_SCHEME.length).toLowerCase() !== DATA_URI_SCHEME) return undefined;
  if (header.slice(-DATA_URI_BASE64_SUFFIX.length).toLowerCase() !== DATA_URI_BASE64_SUFFIX) {
    return undefined;
  }
  const mimeType = header.slice(DATA_URI_SCHEME.length, -DATA_URI_BASE64_SUFFIX.length);
  if (mimeType.includes(';')) return undefined;
  return { mimeType, base64: input.slice(comma + 1) };
}

export function parseInlineMediaDataUri(
  input: string,
  mediaType: MediaType,
  options: InlineMediaValidationOptions = {}
): ParsedInlineMediaData {
  const dataUri = splitBase64DataUri(input.trim());
  if (!dataUri) {
    throw new Error(
      `Only inline base64-encoded data URIs are supported for ${mediaType} inputs; remote URLs are not allowed`
    );
  }

  const mimeType = dataUri.mimeType.toLowerCase();
  const bytes = decodeStrictBase64(dataUri.base64);

  if (options.maxBytes !== undefined && bytes.length > options.maxBytes) {
    throw new Error(
      `${mediaType} input exceeds ${Math.round(options.maxBytes / (1024 * 1024))}MB limit`
    );
  }

  const imageDimensions = validateMagicBytes(mediaType, mimeType, bytes);
  if (imageDimensions && options.maxImageLongestSide !== undefined) {
    validateImageDimensions(imageDimensions, options.maxImageLongestSide);
  }

  const blobBytes = new Uint8Array(bytes.length);
  blobBytes.set(bytes);

  return {
    mimeType,
    blob: new Blob([blobBytes], { type: mimeType }),
    byteLength: bytes.length,
    imageDimensions
  };
}

export async function mediaInputToInlineDataUri(
  input: string,
  mediaType: MediaType,
  options: InlineMediaValidationOptions = {}
): Promise<string> {
  const trimmed = input.trim();
  const remoteUrl = trustedRemoteMediaUrl(trimmed);
  if (!remoteUrl) {
    parseInlineMediaDataUri(trimmed, mediaType, options);
    return trimmed;
  }

  const controller = new AbortController();
  const timeoutMs = options.remoteFetchTimeoutMs ?? DEFAULT_REMOTE_MEDIA_FETCH_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromParent, { once: true });
  try {
    if (options.signal?.aborted) controller.abort();
    const response = await fetch(remoteUrl.toString(), {
      signal: controller.signal,
      redirect: 'error'
    });
    if (!response.ok) {
      throw new Error(`Remote ${mediaType} input fetch failed with HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length') || '');
    if (
      options.maxBytes !== undefined &&
      Number.isFinite(contentLength) &&
      contentLength > options.maxBytes
    ) {
      throwMediaByteLimit(mediaType, options.maxBytes);
    }

    const bytes = await readResponseBytes(response, mediaType, options.maxBytes);
    const mimeType = normalizeResponseMimeType(
      mediaType,
      response.headers.get('content-type'),
      bytes
    );
    const dataUri = `data:${mimeType};base64,${encodeBase64(bytes)}`;
    parseInlineMediaDataUri(dataUri, mediaType, options);
    return dataUri;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortFromParent);
  }
}
