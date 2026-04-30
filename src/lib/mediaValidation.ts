export type MediaType = 'image' | 'audio' | 'video';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface InlineMediaValidationOptions {
  maxBytes?: number;
  maxImageLongestSide?: number;
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

function validateImageDimensions(dimensions: ImageDimensions, maxLongestSide: number): void {
  if (Math.max(dimensions.width, dimensions.height) > maxLongestSide) {
    throw new Error(
      `Inline image exceeds maximum dimensions of ${maxLongestSide}px on its longest side`
    );
  }
}

export function parseInlineMediaDataUri(
  input: string,
  mediaType: MediaType,
  options: InlineMediaValidationOptions = {}
): ParsedInlineMediaData {
  const trimmed = input.trim();
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(trimmed);
  if (!match) {
    throw new Error(
      `Only inline base64-encoded data URIs are supported for ${mediaType} inputs; remote URLs are not allowed`
    );
  }

  const mimeType = match[1].toLowerCase();
  const bytes = decodeStrictBase64(match[2]);

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
