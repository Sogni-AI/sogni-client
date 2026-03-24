import ApiGroup, { ApiConfig } from '../ApiGroup';
import {
  JobTokensData,
  LLMJobResultData,
  LLMJobErrorData
} from '../ApiClient/WebSocketClient/events';
import ChatStream from './ChatStream';
import ChatToolsApi from './ChatTools';
import { isSogniToolCall } from './tools';
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
  ToolCall,
  ToolHistoryEntry
} from './types';
import getUUID from '../lib/getUUID';
import type ProjectsApi from '../Projects';

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
 *   model: 'qwen3.5-35b-a3b-gguf-q4km',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   stream: true,
 * });
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.content);
 * }
 *
 * // Non-streaming
 * const result = await sogni.chat.completions.create({
 *   model: 'qwen3.5-35b-a3b-gguf-q4km',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * console.log(result.content);
 * ```
 */
class ChatApi extends ApiGroup<ChatApiEvents> {
  private activeStreams = new Map<string, ChatStream>();
  private availableLLMModels: Record<string, LLMModelInfo> = {};

  /**
   * Tool execution API for Sogni platform tools (image, video, music generation).
   *
   * @example
   * ```typescript
   * // Execute a single Sogni tool call
   * const result = await sogni.chat.tools.execute(toolCall);
   *
   * // Execute all tool calls from a completion
   * const results = await sogni.chat.tools.executeAll(toolCalls, {
   *   onToolCall: async (tc) => customHandler(tc), // for non-Sogni tools
   * });
   * ```
   */
  tools: ChatToolsApi;

  completions: {
    create: ((params: ChatCompletionParams & { stream: true }) => Promise<ChatStream>) &
      ((params: ChatCompletionParams & { stream?: false }) => Promise<ChatCompletionResult>) &
      ((params: ChatCompletionParams) => Promise<ChatStream | ChatCompletionResult>);
  };

  constructor(config: ApiConfig, projects?: ProjectsApi) {
    super(config);

    // Bind the socket events — use llmJobResult/llmJobError to avoid conflicting with ProjectsApi handlers
    this.client.socket.on('jobTokens', this.handleJobTokens.bind(this));
    this.client.socket.on('llmJobResult', this.handleJobResult.bind(this));
    this.client.socket.on('llmJobError', this.handleJobError.bind(this));
    this.client.socket.on('jobState', this.handleJobState.bind(this));
    this.client.socket.on('swarmLLMModels', this.handleSwarmLLMModels.bind(this));

    // Set up the completions namespace (mimics OpenAI SDK structure)
    this.completions = {
      create: this.createCompletion.bind(this) as any
    };

    // Set up the tools API (requires ProjectsApi for media generation).
    // When ProjectsApi is not provided, tool execution methods will throw at runtime.
    this.tools = new ChatToolsApi(projects!);
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
   *   model: 'qwen3.5-35b-a3b-gguf-q4km',
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
    const inputTokens = Math.ceil(
      JSON.stringify(this.stripImageDataForEstimation(params.messages)).length / 4
    );
    const maxOutputTokens = params.max_tokens || 4096;
    const pathParams = [tokenType, params.model, inputTokens, maxOutputTokens];
    const path = pathParams.map((p) => encodeURIComponent(p)).join('/');
    const r = await this.client.socket.get<LLMEstimateResponse>(`/api/v1/job-llm/estimate/${path}`);
    return {
      costInUSD: r.quote.costInUSD,
      costInSogni: r.quote.costInSogni,
      costInSpark: r.quote.costInSpark,
      costInToken: r.quote.costInToken,
      inputTokens: r.quote.inputTokens,
      outputTokens: r.quote.outputTokens
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

  /**
   * Strip base64 image data from messages before token estimation.
   * Prevents megabytes of base64 data from inflating the JSON.stringify().length / 4 calculation.
   */
  private stripImageDataForEstimation(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg;
      return {
        ...msg,
        content: msg.content.map((part) => {
          if (part.type === 'image_url') {
            return {
              type: 'image_url' as const,
              image_url: {
                url: '[image]',
                ...(part.image_url.detail && { detail: part.image_url.detail })
              }
            };
          }
          return part;
        })
      };
    });
  }

  /**
   * Build `chat_template_kwargs` from the `think` parameter.
   * Returns `undefined` when `think` is omitted (server defaults apply).
   */
  private buildChatTemplateKwargs(think?: boolean): Record<string, unknown> | undefined {
    if (think === undefined) return undefined;
    return { enable_thinking: think };
  }

  private async createCompletion(
    params: ChatCompletionParams
  ): Promise<ChatStream | ChatCompletionResult> {
    // Handle autoExecuteTools (non-streaming only)
    if (params.autoExecuteTools) {
      if (params.stream) {
        throw new Error(
          'autoExecuteTools is not supported with stream: true. ' +
            'Use chat.tools.executeAll() manually in your streaming loop instead.'
        );
      }
      return this.createCompletionWithAutoTools(params);
    }

    return this.createSingleCompletion(params);
  }

  /**
   * Send a single chat completion request (no auto tool execution).
   */
  private async createSingleCompletion(
    params: ChatCompletionParams
  ): Promise<ChatStream | ChatCompletionResult> {
    const jobID = getUUID();

    // Build chat_template_kwargs from think parameter
    const chatTemplateKwargs = this.buildChatTemplateKwargs(params.think);

    const request: ChatRequestMessage = {
      jobID,
      type: 'llm',
      model: params.model,
      messages: params.messages,
      max_tokens: params.max_tokens,
      temperature: params.temperature,
      top_p: params.top_p,
      top_k: params.top_k,
      stream: params.stream,
      frequency_penalty: params.frequency_penalty,
      presence_penalty: params.presence_penalty,
      stop: params.stop,
      tokenType: params.tokenType,
      tools: params.tools,
      tool_choice: params.tool_choice,
      ...(chatTemplateKwargs && { chat_template_kwargs: chatTemplateKwargs })
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

  /**
   * Multi-round auto tool execution loop (non-streaming).
   * Sends completion, executes tool calls, feeds results back, repeats.
   */
  private async createCompletionWithAutoTools(
    params: ChatCompletionParams
  ): Promise<ChatCompletionResult> {
    const maxRounds = params.maxToolRounds || 5;
    const toolHistory: ToolHistoryEntry[] = [];
    let messages = [...params.messages];

    for (let round = 0; round < maxRounds; round++) {
      const result = (await this.createSingleCompletion({
        ...params,
        messages,
        stream: false,
        autoExecuteTools: false
      })) as ChatCompletionResult;

      // If model didn't request tools, return final result
      if (result.finishReason !== 'tool_calls' || !result.tool_calls?.length) {
        if (toolHistory.length > 0) {
          result.toolHistory = toolHistory;
        }
        return result;
      }

      // Execute tool calls
      const toolResults = await this.tools.executeAll(result.tool_calls, {
        tokenType: params.tokenType,
        onToolCall: params.onToolCall,
        onToolProgress: params.onToolProgress
      });

      // Record history
      toolHistory.push({
        round,
        toolCalls: result.tool_calls,
        toolResults
      });

      // Build messages for next round
      messages = [
        ...messages,
        {
          role: 'assistant' as const,
          content: result.content || null,
          tool_calls: result.tool_calls
        },
        ...result.tool_calls.map((tc, i) => ({
          role: 'tool' as const,
          content: toolResults[i].content,
          tool_call_id: tc.id,
          name: tc.function.name
        }))
      ];
    }

    throw new Error(`Max tool calling rounds (${maxRounds}) exceeded`);
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
      tool_calls: data.tool_calls
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
      estimatedCost: data.estimatedCost
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
      workerName: data.workerName
    });
  }
}

export default ChatApi;
