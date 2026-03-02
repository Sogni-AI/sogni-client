import { jwtDecode } from 'jwt-decode';

export function decodeToken(token: string) {
  const data = jwtDecode<{ addr: string; env: string; iat: number; exp: number }>(token);
  return {
    walletAddress: data.addr,
    expiresAt: new Date(data.exp * 1000)
  };
}

export function decodeRefreshToken(token: string) {
  const data = jwtDecode<{ type: string; env: string; iat: number; exp: number }>(token);
  return {
    env: data.env,
    expiresAt: new Date(data.exp * 1000)
  };
}

export async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
