import { ChatCompletionChunk, ChatCompletionResult, TokenUsage } from './types';

/**
 * Async iterable that yields chat completion chunks as they arrive.
 *
 * Usage:
 * ```typescript
 * const stream = await sogni.chat.completions.create({ ... stream: true });
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.content);
 * }
 * const result = stream.finalResult;
 * ```
 */
class ChatStream implements AsyncIterable<ChatCompletionChunk> {
  private buffer: ChatCompletionChunk[] = [];
  private resolve: ((value: IteratorResult<ChatCompletionChunk>) => void) | null = null;
  private reject: ((error: Error) => void) | null = null;
  private done = false;
  private error: Error | null = null;
  private _content = '';
  private _role = 'assistant';
  private _finishReason: string | null = null;
  private _usage: TokenUsage | null = null;
  private _timeTaken = 0;

  readonly jobID: string;

  constructor(jobID: string) {
    this.jobID = jobID;
  }

  /** Accumulated full response content */
  get content(): string {
    return this._content;
  }

  /** Final result once stream is complete. Null if still streaming. */
  get finalResult(): ChatCompletionResult | null {
    if (!this.done || this.error) return null;
    return {
      jobID: this.jobID,
      content: this._content,
      role: this._role,
      finishReason: this._finishReason || 'stop',
      usage: this._usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      timeTaken: this._timeTaken,
    };
  }

  /** @internal Push a chunk from the socket event handler */
  _pushChunk(chunk: ChatCompletionChunk): void {
    if (this.done) return;
    this._content += chunk.content || '';
    if (chunk.role) this._role = chunk.role;
    if (chunk.finishReason) this._finishReason = chunk.finishReason;
    if (chunk.usage) this._usage = chunk.usage;

    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      this.reject = null;
      r({ value: chunk, done: false });
    } else {
      this.buffer.push(chunk);
    }
  }

  /** @internal Mark the stream as complete */
  _complete(timeTaken: number, usage?: TokenUsage): void {
    if (this.done) return;
    this.done = true;
    this._timeTaken = timeTaken;
    if (usage) this._usage = usage;

    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      this.reject = null;
      r({ value: undefined as any, done: true });
    }
  }

  /** @internal Mark the stream as failed */
  _fail(error: Error): void {
    if (this.done) return;
    this.done = true;
    this.error = error;

    if (this.reject) {
      const rej = this.reject;
      this.resolve = null;
      this.reject = null;
      rej(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
    return {
      next: (): Promise<IteratorResult<ChatCompletionChunk>> => {
        // If there's an error, throw it
        if (this.error) {
          return Promise.reject(this.error);
        }

        // If buffer has items, return immediately
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }

        // If stream is done, return done
        if (this.done) {
          return Promise.resolve({ value: undefined as any, done: true });
        }

        // Wait for next chunk
        return new Promise<IteratorResult<ChatCompletionChunk>>((resolve, reject) => {
          this.resolve = resolve;
          this.reject = reject;
        });
      },
      return: (): Promise<IteratorResult<ChatCompletionChunk>> => {
        // Called when consumer breaks out of for-await loop
        this.done = true;
        this.buffer.length = 0;
        this.resolve = null;
        this.reject = null;
        return Promise.resolve({ value: undefined as any, done: true });
      },
    };
  }
}

export default ChatStream;
