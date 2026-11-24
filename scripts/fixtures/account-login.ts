import { ApiError, ACCOUNT_RESTORABLE_ERROR_CODE } from '@sogni-ai/sogni-client';
import type { LoginOptions, SogniClient } from '@sogni-ai/sogni-client';

// An app offers to restore a deleted account, then signs in again with the
// original arguments plus the option.
export async function signIn(
  sogni: SogniClient,
  username: string,
  password: string,
  rememberMe: boolean,
  appSource?: string
): Promise<void> {
  try {
    await sogni.account.login(username, password, rememberMe, appSource);
  } catch (error) {
    if (!(error instanceof ApiError) || error.payload.errorCode !== ACCOUNT_RESTORABLE_ERROR_CODE) {
      throw error;
    }
    const deletedAt: Date = new Date(Number(error.details?.deletedAt) * 1000);
    void deletedAt;
    await sogni.account.login(username, password, rememberMe, appSource, {
      restoreDeletedAccount: true
    });
  }
}

const code: 196 = ACCOUNT_RESTORABLE_ERROR_CODE;
const options: LoginOptions = { restoreDeletedAccount: false };
// @ts-expect-error The option is a boolean.
const notBoolean: LoginOptions = { restoreDeletedAccount: 'yes' };
void [code, options, notBoolean];
