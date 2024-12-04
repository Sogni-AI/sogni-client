export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

export interface Logger {
  error(...args: any[]): void;
  warn(...args: any[]): void;
  info(...args: any[]): void;
  debug(...args: any[]): void;
}

export class DefaultLogger implements Logger {
  private _level: number;

  constructor(level: LogLevel = 'warn') {
    this._level = LOG_LEVELS[level];
  }

  error(...args: any[]) {
    if (this._level >= LOG_LEVELS.error) {
      console.error(...args);
    }
  }

  warn(...args: any[]) {
    if (this._level >= LOG_LEVELS.warn) {
      console.warn(...args);
    }
  }

  info(...args: any[]) {
    if (this._level >= LOG_LEVELS.info) {
      console.info(...args);
    }
  }

  debug(...args: any[]) {
    if (this._level >= LOG_LEVELS.debug) {
      console.debug(...args);
    }
  }
}
