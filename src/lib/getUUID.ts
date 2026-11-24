// Two hex digits per byte, ES6-safe (no padStart in this package's lib target).
const HEX: string[] = [];
for (let byte = 0; byte < 256; byte++) HEX.push((byte + 256).toString(16).slice(1));

/**
 * A random (version 4) UUID drawn from the runtime's cryptographically secure
 * generator. `crypto.randomUUID()` exists in Node.js and in browser pages served
 * over HTTPS or localhost; a page served over plain HTTP has only
 * `crypto.getRandomValues()`, so the same version 4 layout is built from it.
 * A runtime with neither cannot produce an unpredictable id and throws: there
 * is no Math.random fallback.
 *
 * Uppercase, because the Mac app uses uppercase UUIDs and Mac workers must be
 * able to process the data.
 */
function getUUID(): string {
  const webCrypto: Partial<Crypto> | undefined = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID().toUpperCase();
  }
  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 9562 variant
    let out = '';
    for (let i = 0; i < 16; i++) {
      out += HEX[bytes[i]];
      if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
    }
    return out.toUpperCase();
  }
  throw new Error(
    'Sogni SDK: this runtime has no Web Crypto API (globalThis.crypto), so it cannot generate secure IDs'
  );
}

export default getUUID;
