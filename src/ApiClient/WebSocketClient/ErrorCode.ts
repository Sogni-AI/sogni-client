export enum ErrorCode {
  // App ID is blocked from connecting
  APP_ID_BLOCKED = 4010,
  // New connection from same app-id,  server will switch to it
  SWITCH_CONNECTION = 4015,
  // Authentication error happened
  AUTH_ERROR = 4021
}

export function isAuthProblem(code: ErrorCode) {
  return [ErrorCode.AUTH_ERROR, ErrorCode.SWITCH_CONNECTION, ErrorCode.APP_ID_BLOCKED].includes(
    code
  );
}

export default ErrorCode;
