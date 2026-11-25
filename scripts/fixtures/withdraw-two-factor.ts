import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';
import { ApiError } from '@sogni-ai/sogni-client';
import type { SogniClient, TwoFactorProof } from '@sogni-ai/sogni-client';

export async function withdrawWithStepUp(
  sogni: SogniClient,
  password: string,
  amount: number | string,
  assertion: AuthenticationResponseJSON
): Promise<void> {
  // Backwards-compatible calls without proof still compile.
  await sogni.account.withdraw(password, amount);
  await sogni.account.withdraw(password, amount, 'etherlink');
  await sogni.account.withdraw(password, amount, 'base', undefined);

  // Code proof and passkey proof both satisfy TwoFactorProof.
  const codeProof: TwoFactorProof = { code: '123456' };
  const passkeyProof: TwoFactorProof = { challengeId: 'a'.repeat(32), assertion };
  await sogni.account.withdraw(password, amount, 'base', codeProof);
  await sogni.account.withdraw(password, amount, 'etherlink', passkeyProof);

  try {
    await sogni.account.withdraw(password, amount, 'base');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && error.payload.errorCode === 211) {
      const details = error.details as { authenticator?: boolean; passkeys?: boolean } | undefined;
      void details;
    }
  }
}

// @ts-expect-error proof code must be a string.
const badCode: TwoFactorProof = { code: 123456 };
// @ts-expect-error passkey proof requires both challengeId and assertion.
const halfPasskey: TwoFactorProof = { challengeId: 'a'.repeat(32) };
void [badCode, halfPasskey];
