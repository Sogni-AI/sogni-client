/**
 * The `ciphertext-v1` media capability a client created with
 * `mediaEncryption: 'auto'` declares.
 * @internal
 */
export const MEDIA_CAPABILITY = 'ciphertext-v1';
export const MEDIA_CAPABILITY_HEADER = 'X-Sogni-Media';
export const MEDIA_CAPABILITY_QUERY = 'sogniMedia';

/**
 * Tells the transports when to declare the capability.
 * @internal
 */
export interface MediaCapabilityProvider {
  /** Whether a REST request or a new socket connection made now declares the capability. */
  declared(): boolean;
}
