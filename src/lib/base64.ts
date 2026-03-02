export function base64Encode(str: string): string {
  const encoder = new TextEncoder();
  const uint8Array = encoder.encode(str);
  // Process in chunks to avoid "Maximum call stack size exceeded" with large payloads
  const chunkSize = 8192;
  let binaryString = '';
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    binaryString += String.fromCharCode(...uint8Array.subarray(i, i + chunkSize));
  }
  return btoa(binaryString);
}

export function base64Decode(str: string): string {
  const binaryString = atob(str);
  const binaryArray = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
  const decoder = new TextDecoder();
  return decoder.decode(binaryArray);
}
