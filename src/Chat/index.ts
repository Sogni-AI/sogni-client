import ApiGroup, { ApiConfig } from '../ApiGroup';
import { JobTokensData, LLMJobResultData, LLMJobErrorData } from '../ApiClient/WebSocketClient/events';
import ChatStream from './ChatStream';
import { ChatCompletionParams, ChatCompletionChunk, ChatCompletionResult, ChatRequestMessage } from './types';
import getUUID from '../lib/getUUID';

export interface ChatApiEvents {
  /** Emitted for each token chunk received during streaming */
  token: ChatCompletionChunk;
  /** Emitted when a chat completion finishes */
  completed: ChatCompletionResult;
  /** Emitted when a chat completion fails */
  error: { jobID: string; error: string; message: string };
}

/**
 * Chat API for LLM text generation via the Sogni Supernet.
 *
 * Provides OpenAI-compatible chat completion interface using Sogni's
 * decentralized LLM worker network.
 *
 * Usage:
 * ```typescript
 * // Streaming
 * const stream = await sogni.chat.completions.create({
 *   model: 'Qwen/Qwen3-30B-A3B-GPTQ-Int4',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   stream: true,
 * });
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.content);
 * }
 *
 * // Non-streaming
 * const result = await sogni.chat.completions.create({
 *   model: 'Qwen/Qwen3-30B-A3B-GPTQ-Int4',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * console.log(result.content);
 * ```
 */
class ChatApi extends ApiGroup<ChatApiEvents> {
  private activeStreams = new Map<string, ChatStream>();
  private availableLLMModels: Record<string, number> = {};

  completions: {
    create: ((params: ChatCompletionParams & { stream: true }) => Promise<ChatStream>) &
      ((params: ChatCompletionParams & { stream?: false }) => Promise<ChatCompletionResult>) &
      ((params: ChatCompletionParams) => Promise<ChatStream | ChatCompletionResult>);
  };

  constructor(config: ApiConfig) {
    super(config);

    // Bind the socket events — use llmJobResult/llmJobError to avoid conflicting with ProjectsApi handlers
    this.client.socket.on('jobTokens', this.handleJobTokens.bind(this));
    this.client.socket.on('llmJobResult', this.handleJobResult.bind(this));
    this.client.socket.on('llmJobError', this.handleJobError.bind(this));
    this.client.socket.on('jobState', this.handleJobState.bind(this));
    this.client.socket.on('swarmLLMModels', this.handleSwarmLLMModels.bind(this));

    // Set up the completions namespace (mimics OpenAI SDK structure)
    this.completions = {
      create: this.createCompletion.bind(this) as any,
    };
  }

  /** Available LLM models and their worker counts */
  get models(): Record<string, number> {
    return { ...this.availableLLMModels };
  }

  private handleSwarmLLMModels(data: Record<string, number>): void {
    this.availableLLMModels = data;
  }

  private async createCompletion(params: ChatCompletionParams): Promise<ChatStream | ChatCompletionResult> {
    const jobID = getUUID();

    const request: ChatRequestMessage = {
      jobID,
      type: 'llm',
      model: params.model,
      messages: params.messages,
      max_tokens: params.max_tokens,
      temperature: params.temperature,
      top_p: params.top_p,
      stream: params.stream,
      frequency_penalty: params.frequency_penalty,
      presence_penalty: params.presence_penalty,
      stop: params.stop,
    };

    const stream = new ChatStream(jobID);
    this.activeStreams.set(jobID, stream);

    // Send the job request via socket
    await this.client.socket.send('llmJobRequest', request as any);

    if (params.stream) {
      return stream;
    }

    // Non-streaming: wait for completion and return the full result
    return new Promise<ChatCompletionResult>((resolve, reject) => {
      const cleanup = () => {
        clearInterval(interval);
        clearTimeout(timeout);
        errorOff();
        this.activeStreams.delete(jobID);
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Chat completion timed out after 300s (jobID: ${jobID})`));
      }, 300000);

      // Poll for completion (the stream will be completed by socket events)
      const interval = setInterval(() => {
        if (stream.finalResult) {
          cleanup();
          resolve(stream.finalResult);
        }
      }, 50);

      // Also listen for the error case
      const errorOff = this.on('error', (err) => {
        if (err.jobID === jobID) {
          cleanup();
          reject(new Error(`${err.error}: ${err.message}`));
        }
      });
    });
  }

  private handleJobTokens(data: JobTokensData): void {
    const stream = this.activeStreams.get(data.jobID);
    if (!stream) return;

    const chunk: ChatCompletionChunk = {
      jobID: data.jobID,
      content: data.content || '',
      role: data.role,
      finishReason: data.finishReason,
      usage: data.usage,
    };

    stream._pushChunk(chunk);
    this.emit('token', chunk);
  }

  private handleJobResult(data: LLMJobResultData): void {
    const stream = this.activeStreams.get(data.jobID);
    if (!stream) return;

    stream._complete(data.timeTaken || 0, data.usage);

    if (stream.finalResult) {
      this.emit('completed', stream.finalResult);
    }

    // Clean up from activeStreams — finalResult is computed from stream state, not the map entry
    this.activeStreams.delete(data.jobID);
  }

  private handleJobState(data: any): void {
    const stream = this.activeStreams.get(data.jobID);
    if (!stream) return;

    if (data.type === 'queued') {
      this.client.logger.debug(`Chat job ${data.jobID} queued`);
    } else if (data.type === 'assigned') {
      this.client.logger.debug(`Chat job ${data.jobID} assigned to worker`);
    } else if (data.type === 'jobStarted') {
      this.client.logger.debug(`Chat job ${data.jobID} started on worker`);
    }
  }

  private handleJobError(data: LLMJobErrorData): void {
    const stream = this.activeStreams.get(data.jobID);
    if (!stream) return;

    const errorMsg = data.error_message || String(data.error);
    stream._fail(new Error(errorMsg));
    this.activeStreams.delete(data.jobID);

    this.emit('error', {
      jobID: data.jobID,
      error: String(data.error),
      message: errorMsg,
    });
  }
}

export default ChatApi;
