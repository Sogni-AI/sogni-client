/** Sign-in needs an authenticator or backup code before a session can begin. */
export default class TwoFactorRequiredError extends Error {
  readonly name = 'TwoFactorRequiredError';

  constructor(
    public readonly tempToken: string,
    public readonly walletAddress: string,
    public readonly username: string
  ) {
    super('Enter your authenticator code or a backup code to finish signing in.');
  }
}
