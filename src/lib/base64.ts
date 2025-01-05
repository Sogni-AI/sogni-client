export function base64Encode(str: string): string {
  const encoder = new TextEncoder();
  const uint8Array = encoder.encode(str);
  const binaryString = String.fromCharCode(...uint8Array);
  return btoa(binaryString);
}

export function base64Decode(str: string): string {
  const binaryString = atob(str);
  const binaryArray = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
  const decoder = new TextDecoder();
  return decoder.decode(binaryArray);
}
