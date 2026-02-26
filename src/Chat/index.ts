import ApiGroup, { ApiConfig } from '../ApiGroup';
import { JobTokensData, LLMJobResultData, LLMJobErrorData } from '../ApiClient/WebSocketClient/events';
import ChatStream from './ChatStream';
import {
  ChatCompletionParams,
  ChatCompletionChunk,
  ChatCompletionResult,
  ChatJobStateEvent,
  ChatRequestMessage,
  ChatMessage,
  LLMCostEstimation,
  LLMEstimateResponse,
  LLMModelInfo,
} from './types';
import getUUID from '../lib/getUUID';

export interface ChatApiEvents {
  /** Emitted for each token chunk received during streaming */
  token: ChatCompletionChunk;
  /** Emitted when a chat completion finishes */
  completed: ChatCompletionResult;
  /** Emitted when a chat completion fails */
  error: { jobID: string; error: string; message: string; workerName?: string };
  /** Emitted when the job state changes (queued, assigned to worker, started, etc.) */
  jobState: ChatJobStateEvent;
  /** Emitted when the available LLM models list is updated from the network */
  modelsUpdated: Record<string, LLMModelInfo>;
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
 *   model: 'qwen3-30b-a3b-gptq-int4',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   stream: true,
 * });
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.content);
 * }
 *
 * // Non-streaming
 * const result = await sogni.chat.completions.create({
 *   model: 'qwen3-30b-a3b-gptq-int4',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * console.log(result.content);
 * ```
 */
class ChatApi extends ApiGroup<ChatApiEvents> {
  private activeStreams = new Map<string, ChatStream>();
  private availableLLMModels: Record<string, LLMModelInfo> = {};

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
  get models(): Record<string, LLMModelInfo> {
    return { ...this.availableLLMModels };
  }

  /**
   * Wait for available LLM models to be received from the network.
   * Resolves immediately if models are already available.
   * @param timeout - timeout in milliseconds until the promise is rejected (default: 10000)
   */
  waitForModels(timeout = 10000): Promise<Record<string, LLMModelInfo>> {
    if (Object.keys(this.availableLLMModels).length > 0) {
      return Promise.resolve({ ...this.availableLLMModels });
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.off('modelsUpdated', handler);
          reject(new Error('Timeout waiting for LLM models'));
        }
      }, timeout);

      const handler = (models: Record<string, LLMModelInfo>) => {
        if (Object.keys(models).length > 0 && !settled) {
          settled = true;
          clearTimeout(timeoutId);
          this.off('modelsUpdated', handler);
          resolve(models);
        }
      };

      this.on('modelsUpdated', handler);
    });
  }

  /**
   * Estimate the cost of a chat completion request before submitting it.
   *
   * Uses the same token estimation formula as the server:
   * input tokens ≈ ceil(JSON.stringify(messages).length / 4)
   *
   * @example
   * ```typescript
   * const estimate = await sogni.chat.estimateCost({
   *   model: 'qwen3-30b-a3b-gptq-int4',
   *   messages: [{ role: 'user', content: 'Hello!' }],
   *   max_tokens: 1024,
   * });
   * console.log(`Estimated cost: ${estimate.costInToken.toFixed(6)}`);
   * ```
   */
  async estimateCost(params: {
    model: string;
    messages: ChatMessage[];
    max_tokens?: number;
    tokenType?: 'sogni' | 'spark';
  }): Promise<LLMCostEstimation> {
    const tokenType = params.tokenType || 'sogni';
    const inputTokens = Math.ceil(JSON.stringify(params.messages).length / 4);
    const maxOutputTokens = params.max_tokens || 4096;
    const pathParams = [tokenType, params.model, inputTokens, maxOutputTokens];
    const path = pathParams.map((p) => encodeURIComponent(p)).join('/');
    const r = await this.client.socket.get<LLMEstimateResponse>(
      `/api/v1/job-llm/estimate/${path}`
    );
    return {
      costInUSD: r.quote.costInUSD,
      costInSogni: r.quote.costInSogni,
      costInSpark: r.quote.costInSpark,
      costInToken: r.quote.costInToken,
      inputTokens: r.quote.inputTokens,
      outputTokens: r.quote.outputTokens,
    };
  }

  private handleSwarmLLMModels(data: Record<string, number | LLMModelInfo>): void {
    const models: Record<string, LLMModelInfo> = {};
    for (const [modelId, value] of Object.entries(data)) {
      if (typeof value === 'number') {
        // Legacy format: { modelId: workerCount }
        models[modelId] = { workers: value };
      } else {
        models[modelId] = value;
      }
    }
    this.availableLLMModels = models;
    this.emit('modelsUpdated', this.availableLLMModels);
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
      tokenType: params.tokenType,
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

    // Update worker name from result if available (may contain proper username/nftTokenId)
    if (data.workerName) {
      stream._setWorkerName(data.workerName);
    }

    // Capture actual cost breakdown from server settlement
    if (data.cost) {
      stream._setCost(data.cost);
    }

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

    // Track worker name on the stream for inclusion in finalResult
    if (data.workerName) {
      stream._setWorkerName(data.workerName);
    }

    // Emit jobState event for consumers
    this.emit('jobState', {
      jobID: data.jobID,
      type: data.type,
      workerName: data.workerName,
      queuePosition: data.queuePosition,
      modelId: data.modelId,
      estimatedCost: data.estimatedCost,
    });

    if (data.type === 'pending') {
      this.client.logger.debug(`Chat job ${data.jobID} pending authorization`);
    } else if (data.type === 'queued') {
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

    // Capture worker name if available (worker may have been assigned before error)
    if (data.workerName) {
      stream._setWorkerName(data.workerName);
    }

    const errorMsg = data.error_message || String(data.error);
    stream._fail(new Error(errorMsg));
    this.activeStreams.delete(data.jobID);

    this.emit('error', {
      jobID: data.jobID,
      error: String(data.error),
      message: errorMsg,
      workerName: data.workerName,
    });
  }
}

export default ChatApi;
