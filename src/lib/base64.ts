import isNodejs from './isNodejs';

export function base64Encode(str: string): string {
  return isNodejs ? Buffer.from(str).toString('base64') : btoa(str);
}

export function base64Decode(str: string): string {
  return isNodejs ? Buffer.from(str, 'base64').toString() : atob(str);
}
