import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';
import { ApiError } from '@sogni-ai/sogni-client';
import type { SogniClient, TwoFactorProof } from '@sogni-ai/sogni-client';

export async function withdrawWithStepUp(
  sogni: SogniClient,
  username: string,
  password: string,
  amount: number | string,
  assertion: AuthenticationResponseJSON
): Promise<void> {
  // Backwards-compatible calls without proof still compile.
  await sogni.account.withdraw(password, amount);
  await sogni.account.withdraw(password, amount, 'etherlink');
  await sogni.account.withdraw(password, amount, 'base', undefined);

  // Code proof and passkey proof both satisfy TwoFactorProof, including with omitted provider.
  const codeProof: TwoFactorProof = { code: '123456' };
  const passkeyProof: TwoFactorProof = { challengeId: 'a'.repeat(32), assertion };
  await sogni.account.withdraw(password, amount, 'base', codeProof);
  await sogni.account.withdraw(password, amount, undefined, codeProof);
  await sogni.account.withdraw(password, amount, 'etherlink', passkeyProof);
  await sogni.account.withdraw(password, amount, undefined, passkeyProof);

  // Passkey option endpoints expose optional originVerified without casts.
  const authOptions = await sogni.account.getTwoFactorPasskeyOptions();
  const authOriginVerified: boolean | undefined = authOptions.originVerified;
  const setupOptions = await sogni.account.beginPasskeySetup(username, password, 'Security Key');
  const setupOriginVerified: boolean | undefined = setupOptions.originVerified;
  // @ts-expect-error originVerified is boolean | undefined, not string.
  const badAuthOrigin: string | undefined = authOptions.originVerified;
  // @ts-expect-error originVerified is boolean | undefined, not string.
  const badSetupOrigin: string | undefined = setupOptions.originVerified;
  void [authOriginVerified, setupOriginVerified, badAuthOrigin, badSetupOrigin];

  try {
    await sogni.account.withdraw(password, amount);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && error.payload.errorCode === 211) {
      const details = error.details as { authenticator?: boolean; passkeys?: boolean } | undefined;
      void details;
      await sogni.account.withdraw(password, amount, undefined, codeProof);
    }
  }
}

// @ts-expect-error proof code must be a string.
const badCode: TwoFactorProof = { code: 123456 };
// @ts-expect-error passkey proof requires both challengeId and assertion.
const halfPasskey: TwoFactorProof = { challengeId: 'a'.repeat(32) };
void [badCode, halfPasskey];
