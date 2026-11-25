export {
  MEDIA_ENCRYPTION_VERSION,
  MEDIA_KEY_BYTES,
  MAX_HEADER_BYTES,
  MediaEncryptionError,
  isEncryptedMedia,
  parseHeader
} from './format.js';
export type { MediaEncryptionHeader } from './format.js';
export { decryptMedia, encryptMedia, randomBytes, readMediaHeader } from './crypto.js';
export type { DecryptedMedia, EncryptMediaOptions, MediaSource } from './crypto.js';
export {
  RECIPIENT_BYTES,
  importAccountKey,
  unwrapProjectKey,
  wrapProjectKey
} from './recipient.js';
export type { AccountMediaKey } from './recipient.js';
export {
  MAX_INPUT_KEYS,
  WRAPPED_INPUT_KEY_BYTES,
  deriveInputMaterial,
  inputMaterialForMedia,
  randomInputMaterial,
  unwrapInputKey,
  wrapInputKey
} from './inputKeys.js';
export type { InputMediaMaterial } from './inputKeys.js';
export { MEDIA_CAPABILITY, MEDIA_CAPABILITY_HEADER, MEDIA_CAPABILITY_QUERY } from './capability.js';
export type { MediaCapabilityProvider } from './capability.js';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
