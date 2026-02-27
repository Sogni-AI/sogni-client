import { ChatCompletionChunk, ChatCompletionResult, LLMJobCost, TokenUsage, ToolCall, ToolCallDelta } from './types';

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
  private _workerName?: string;
  private _cost?: LLMJobCost;
  private _toolCalls: Map<number, ToolCall> = new Map();

  readonly jobID: string;

  constructor(jobID: string) {
    this.jobID = jobID;
  }

  /** Accumulated full response content */
  get content(): string {
    return this._content;
  }

  /** Name of the worker that processed this request */
  get workerName(): string | undefined {
    return this._workerName;
  }

  /** Actual cost breakdown once stream is complete. Undefined if still streaming. */
  get cost(): LLMJobCost | undefined {
    return this._cost;
  }

  /** Accumulated tool calls from the model. Empty array if no tool calls. */
  get toolCalls(): ToolCall[] {
    if (this._toolCalls.size === 0) return [];
    return Array.from(this._toolCalls.entries())
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => tc);
  }

  /** Final result once stream is complete. Null if still streaming. */
  get finalResult(): ChatCompletionResult | null {
    if (!this.done || this.error) return null;
    const result: ChatCompletionResult = {
      jobID: this.jobID,
      content: this._content,
      role: this._role,
      finishReason: this._finishReason || 'stop',
      usage: this._usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      timeTaken: this._timeTaken,
      workerName: this._workerName,
      cost: this._cost,
    };
    const toolCalls = this.toolCalls;
    if (toolCalls.length > 0) {
      result.tool_calls = toolCalls;
    }
    return result;
  }

  /** @internal Push a chunk from the socket event handler */
  _pushChunk(chunk: ChatCompletionChunk): void {
    if (this.done) return;
    this._content += chunk.content || '';
    if (chunk.role) this._role = chunk.role;
    if (chunk.finishReason) this._finishReason = chunk.finishReason;
    if (chunk.usage) this._usage = chunk.usage;

    // Accumulate tool call deltas by index
    if (chunk.tool_calls) {
      for (const delta of chunk.tool_calls) {
        const idx = delta.index;
        let tc = this._toolCalls.get(idx);
        if (!tc) {
          tc = { id: delta.id || '', type: 'function', function: { name: delta.function?.name || '', arguments: '' } };
          this._toolCalls.set(idx, tc);
        }
        if (delta.id) tc.id = delta.id;
        if (delta.function?.name) tc.function.name = delta.function.name;
        if (delta.function?.arguments) tc.function.arguments += delta.function.arguments;
      }
    }

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
    this._toolCalls.clear();

    if (this.reject) {
      const rej = this.reject;
      this.resolve = null;
      this.reject = null;
      rej(error);
    }
  }

  /** @internal Set the worker name from a jobState event */
  _setWorkerName(workerName: string): void {
    this._workerName = workerName;
  }

  /** @internal Set the cost breakdown from the llmJobResult event */
  _setCost(cost: LLMJobCost): void {
    this._cost = cost;
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
