export enum ErrorCode {
  // App ID is blocked from connecting
  APP_ID_BLOCKED = 4010,
  // New connection from same app-id,  server will switch to it
  SWITCH_CONNECTION = 4015,
  // Authentication error happened
  AUTH_ERROR = 4021
}

export function isNotRecoverable(code: ErrorCode) {
  //check if code is in 4xxx
  return code >= 4000 && code < 5000;
}

export default ErrorCode;
