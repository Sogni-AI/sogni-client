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
  ChatRunEvent,
  ChatRunRecord,
  HostedChatCompletionParams,
  ConfirmChatRunCostParams,
  HostedChatCompletionResult,
  LLMCostEstimation,
  LLMEstimateResponse,
  LLMModelInfo,
  StartChatRunParams,
  StreamChatRunEventsOptions,
  ToolCall,
  ToolHistoryEntry
} from './types';
import getUUID from '../lib/getUUID';
import type ProjectsApi from '../Projects';
import { mediaInputToInlineDataUri } from '../lib/mediaValidation';

const MAX_VISION_IMAGE_COUNT = 20;
const MAX_VISION_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VISION_IMAGE_LONGEST_SIDE = 1024;
const EXTERNAL_CHAT_RUN_MEDIA_URL = /^https?:\/\//i;
const INLINE_CHAT_RUN_MEDIA_URL = /^data:/i;
const CHAT_RUN_MEDIA_CONTEXT_FIELDS = [
  'images',
  'videos',
  'audio',
  'uploadedImages',
  'uploadedVideos',
  'uploadedAudio'
] as const;

async function normalizeVisionImageDataUri(input: string): Promise<string> {
  return mediaInputToInlineDataUri(input, 'image', {
    maxBytes: MAX_VISION_IMAGE_BYTES,
    maxImageLongestSide: MAX_VISION_IMAGE_LONGEST_SIDE
  });
}

async function normalizeVisionMessages(messages: ChatMessage[]): Promise<ChatMessage[]> {
  let imageCount = 0;
  return Promise.all(
    messages.map(async (msg) => {
      if (!Array.isArray(msg.content)) {
        return msg;
      }

      return {
        ...msg,
        content: await Promise.all(
          msg.content.map(async (part) => {
            if (part.type !== 'image_url') {
              return part;
            }

            imageCount += 1;
            if (imageCount > MAX_VISION_IMAGE_COUNT) {
              throw new Error(
                `A maximum of ${MAX_VISION_IMAGE_COUNT} vision images is allowed per request`
              );
            }

            return {
              type: 'image_url' as const,
              image_url: {
                url: await normalizeVisionImageDataUri(part.image_url.url),
                ...(part.image_url.detail && { detail: part.image_url.detail })
              }
            };
          })
        )
      };
    })
  );
}

function chatRunMediaUrlViolation(path: string, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (INLINE_CHAT_RUN_MEDIA_URL.test(trimmed)) return path;
  if (!EXTERNAL_CHAT_RUN_MEDIA_URL.test(trimmed)) return path;
  return null;
}

function collectChatRunMessageMediaViolations(messages: unknown[]): string[] {
  const violations: string[] = [];
  messages.forEach((message, messageIndex) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return;
    content.forEach((part, partIndex) => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) return;
      if ((part as { type?: unknown }).type !== 'image_url') return;
      const imageUrl = (part as { image_url?: unknown }).image_url;
      if (!imageUrl || typeof imageUrl !== 'object' || Array.isArray(imageUrl)) return;
      const violation = chatRunMediaUrlViolation(
        `messages[${messageIndex}].content[${partIndex}].image_url.url`,
        (imageUrl as { url?: unknown }).url
      );
      if (violation) violations.push(violation);
    });
  });
  return violations;
}

function collectChatRunMediaReferenceViolations(mediaReferences: unknown[] | undefined): string[] {
  if (!Array.isArray(mediaReferences)) return [];
  const violations: string[] = [];
  mediaReferences.forEach((reference, index) => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return;
    const record = reference as { url?: unknown; dataUri?: unknown; data_uri?: unknown };
    const urlViolation = chatRunMediaUrlViolation(`mediaReferences[${index}].url`, record.url);
    if (urlViolation) violations.push(urlViolation);
    if (typeof record.dataUri === 'string' && record.dataUri.trim()) {
      violations.push(`mediaReferences[${index}].dataUri`);
    }
    if (typeof record.data_uri === 'string' && record.data_uri.trim()) {
      violations.push(`mediaReferences[${index}].data_uri`);
    }
  });
  return violations;
}

function collectChatRunMediaContextViolations(
  mediaContext: StartChatRunParams['mediaContext'] | undefined
): string[] {
  if (!mediaContext) return [];
  const violations: string[] = [];
  for (const field of CHAT_RUN_MEDIA_CONTEXT_FIELDS) {
    const values = mediaContext[field];
    if (!Array.isArray(values)) continue;
    values.forEach((value, index) => {
      const violation = chatRunMediaUrlViolation(`mediaContext.${field}[${index}]`, value);
      if (violation) violations.push(violation);
    });
  }
  return violations;
}

function assertChatRunUsesExternalMedia(params: StartChatRunParams): void {
  const violations = [
    ...collectChatRunMessageMediaViolations(params.messages),
    ...collectChatRunMediaReferenceViolations(params.mediaReferences),
    ...collectChatRunMediaContextViolations(params.mediaContext)
  ];
  if (violations.length === 0) return;
  throw new Error(
    `Durable chat runs do not support inline base64/data URI media. Upload media first and pass HTTP(S) URLs instead. Offending field(s): ${violations.join(', ')}`
  );
}

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
 *   model: 'qwen3.6-35b-a3b-gguf-iq4xs',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   stream: true,
 * });
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.content);
 * }
 *
 * // Non-streaming
 * const result = await sogni.chat.completions.create({
 *   model: 'qwen3.6-35b-a3b-gguf-iq4xs',
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

  /**
   * Hosted REST chat completion (`POST /v1/chat/completions`). The API
   * executes any eligible hosted tools server-side and returns the
   * final result within the request lifetime.
   */
  hosted: {
    create: (params: HostedChatCompletionParams) => Promise<HostedChatCompletionResult>;
  };

  /**
   * Durable hosted chat runs (`POST /v1/chat/runs`). A run is submitted
   * and persisted server-side; the executor drives the LLM/tool loop
   * without requiring the client to stay connected. Clients can
   * disconnect and reattach via SSE `Last-Event-ID` replay or fetch
   * the final snapshot.
   *
   * - `create` returns the persisted run record immediately (202).
   * - `get` reads the current run state.
   * - `cancel` flips the run to `cancelled` and aborts in-flight work.
   * - `streamEvents` yields `ChatRunEvent`s via SSE.
   */
  runs: {
    create: (params: StartChatRunParams) => Promise<ChatRunRecord>;
    get: (runId: string) => Promise<ChatRunRecord>;
    cancel: (runId: string, reason?: string) => Promise<ChatRunRecord>;
    /**
     * Resume a run that paused with `run_awaiting_cost_confirmation`.
     * Pass the user's decision (confirm or cancel) and optional
     * override args. The cloud either dispatches the paused tool
     * (confirm) or short-circuits with a cancelled tool result.
     */
    confirmCost: (runId: string, params: ConfirmChatRunCostParams) => Promise<ChatRunRecord>;
    streamEvents: (
      runId: string,
      options?: StreamChatRunEventsOptions
    ) => AsyncIterableIterator<ChatRunEvent>;
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
    this.hosted = {
      create: this.createHostedCompletion.bind(this)
    };
    this.runs = {
      create: this.createChatRun.bind(this),
      get: this.getChatRun.bind(this),
      cancel: this.cancelChatRun.bind(this),
      confirmCost: this.confirmChatRunCost.bind(this),
      streamEvents: this.streamChatRunEvents.bind(this)
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
   *   model: 'qwen3.6-35b-a3b-gguf-iq4xs',
   *   messages: [{ role: 'user', content: 'Hello!' }],
   *   think: true,
   *   taskProfile: 'reasoning',
   * });
   * console.log(`Estimated cost: ${estimate.costInToken.toFixed(6)}`);
   * ```
   */
  async estimateCost(params: {
    model: string;
    messages: ChatMessage[];
    max_tokens?: number;
    tokenType?: 'sogni' | 'spark';
    think?: boolean;
    taskProfile?: 'general' | 'coding' | 'reasoning';
  }): Promise<LLMCostEstimation> {
    const normalizedMessages = await normalizeVisionMessages(params.messages);
    const tokenType = params.tokenType || 'sogni';
    const inputTokens = Math.ceil(
      JSON.stringify(this.stripImageDataForEstimation(normalizedMessages)).length / 4
    );
    const maxOutputTokens = this.resolveEstimatedMaxOutputTokens(params);
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

  private resolveEstimatedMaxOutputTokens(params: {
    model: string;
    max_tokens?: number;
    think?: boolean;
    taskProfile?: 'general' | 'coding' | 'reasoning';
  }): number {
    if (typeof params.max_tokens === 'number' && Number.isFinite(params.max_tokens)) {
      return params.max_tokens;
    }

    const modelInfo = this.availableLLMModels[params.model];
    const defaultFromModel = modelInfo?.maxOutputTokens?.default;
    const thinkingComplexDefault = modelInfo?.maxOutputTokens?.thinkingComplexDefault;
    const isComplexThinking =
      params.think === true &&
      (params.taskProfile === 'coding' || params.taskProfile === 'reasoning');

    if (
      isComplexThinking &&
      typeof thinkingComplexDefault === 'number' &&
      Number.isFinite(thinkingComplexDefault)
    ) {
      return thinkingComplexDefault;
    }

    if (typeof defaultFromModel === 'number' && Number.isFinite(defaultFromModel)) {
      return defaultFromModel;
    }

    return 4096;
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

  private normalizeSogniToolsMode(
    value: ChatCompletionParams['sogni_tools'] | string | undefined
  ): ChatRequestMessage['sogni_tools'] | undefined {
    return typeof value === 'string' && value.trim().toLowerCase() === 'rich'
      ? 'creative-tools'
      : (value as ChatRequestMessage['sogni_tools']);
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

  private async createHostedCompletion(
    params: HostedChatCompletionParams
  ): Promise<HostedChatCompletionResult> {
    if (params.stream) {
      throw new Error('chat.hosted.create currently supports non-streaming requests only.');
    }

    const normalizedMessages = await normalizeVisionMessages(params.messages);
    const chatTemplateKwargs =
      params.chat_template_kwargs ?? this.buildChatTemplateKwargs(params.think);
    return this.client.rest.post<HostedChatCompletionResult>(
      '/v1/chat/completions',
      {
        model: params.model,
        messages: normalizedMessages,
        app_source: params.app_source ?? params.appSource ?? this.client.appSource,
        max_tokens: params.max_tokens,
        temperature: params.temperature,
        top_p: params.top_p,
        top_k: params.top_k,
        min_p: params.min_p,
        repetition_penalty: params.repetition_penalty,
        frequency_penalty: params.frequency_penalty,
        presence_penalty: params.presence_penalty,
        stop: params.stop,
        token_type: params.token_type ?? params.tokenType,
        tools: params.tools,
        tool_choice: params.tool_choice,
        sogni_tools: this.normalizeSogniToolsMode(params.sogni_tools),
        sogni_tool_execution: params.sogni_tool_execution,
        task_profile: params.task_profile ?? params.taskProfile,
        media_references: params.media_references ?? params.mediaReferences,
        api_media_references: params.api_media_references ?? params.apiMediaReferences,
        ...(chatTemplateKwargs && { chat_template_kwargs: chatTemplateKwargs }),
        ...(params.response_format && { response_format: params.response_format })
      },
      { timeoutMs: 300000 }
    );
  }

  private async chatRunFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const url = new URL(path, this.client.rest.baseUrl).toString();
    const authenticated = await this.client.auth.authenticateRequest(options);
    return fetch(url, authenticated);
  }

  private async chatRunJson<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await this.chatRunFetch(path, options);
    if (!response.ok) {
      const text = await response.text();
      let payload: Record<string, unknown> | undefined;
      try {
        payload = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
      } catch {
        payload = { message: text };
      }
      const message =
        (payload && typeof payload.message === 'string' && payload.message) ||
        response.statusText ||
        `Chat run request failed with status ${response.status}`;
      const err = new Error(message);
      (err as { status?: number }).status = response.status;
      throw err;
    }
    return (await response.json()) as T;
  }

  /**
   * Submit a durable hosted chat run. Returns the persisted run record;
   * the executor drives the LLM/tool loop server-side.
   */
  private async createChatRun(params: StartChatRunParams): Promise<ChatRunRecord> {
    assertChatRunUsesExternalMedia(params);
    const body: Record<string, unknown> = {
      messages: params.messages,
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.toolChoice !== undefined ? { tool_choice: params.toolChoice } : {}),
      ...(params.model ? { model: params.model } : {}),
      ...(params.sampling ? { sampling: params.sampling } : {}),
      ...(params.mediaReferences ? { media_references: params.mediaReferences } : {}),
      ...(params.mediaContext ? { media_context: params.mediaContext } : {}),
      ...(params.maxEstimatedCapacityUnits !== undefined
        ? { max_estimated_capacity_units: params.maxEstimatedCapacityUnits }
        : {}),
      ...(params.confirmCost !== undefined ? { confirm_cost: params.confirmCost } : {}),
      ...(params.sessionId ? { session_id: params.sessionId } : {}),
      ...(params.clientMessageId ? { client_message_id: params.clientMessageId } : {}),
      ...(params.tokenType ? { token_type: params.tokenType } : {}),
      ...(params.appSource ? { app_source: params.appSource } : {}),
      ...(params.runtimeConfig ? { runtime_config: params.runtimeConfig } : {})
    };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (params.idempotencyKey) headers['Idempotency-Key'] = params.idempotencyKey;
    const response = await this.chatRunJson<{
      status: string;
      data: { run: ChatRunRecord; idempotent?: boolean };
    }>('/v1/chat/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    return response.data.run;
  }

  /** Read a persisted chat run record. */
  private async getChatRun(runId: string): Promise<ChatRunRecord> {
    const response = await this.chatRunJson<{ status: string; data: { run: ChatRunRecord } }>(
      `/v1/chat/runs/${encodeURIComponent(runId)}`
    );
    return response.data.run;
  }

  /** Cancel an in-flight chat run. */
  private async cancelChatRun(runId: string, reason?: string): Promise<ChatRunRecord> {
    const response = await this.chatRunJson<{ status: string; data: { run: ChatRunRecord } }>(
      `/v1/chat/runs/${encodeURIComponent(runId)}/cancel`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { reason } : {})
      }
    );
    return response.data.run;
  }

  /**
   * Resume a chat run that emitted `run_awaiting_cost_confirmation`.
   * Posts the user's decision (confirm/cancel + optional override
   * args) and returns the updated run record. Errors with HTTP 4xx
   * when the run isn't in `waiting_for_user` state or the
   * `toolCallId` doesn't match the pending tool.
   */
  private async confirmChatRunCost(
    runId: string,
    params: ConfirmChatRunCostParams,
  ): Promise<ChatRunRecord> {
    const body: Record<string, unknown> = {
      tool_call_id: params.toolCallId,
      decision: params.decision,
      ...(params.overrides ? { overrides: params.overrides } : {}),
      ...(params.reason ? { reason: params.reason } : {}),
    };
    const response = await this.chatRunJson<{ status: string; data: { run: ChatRunRecord } }>(
      `/v1/chat/runs/${encodeURIComponent(runId)}/confirm-cost`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return response.data.run;
  }

  /**
   * SSE iterator over chat-run events. Honors `Last-Event-ID` for replay.
   * Yields events as `ChatRunEvent`. Caller is responsible for breaking
   * the loop when they see a terminal `run_*` event type they care about.
   */
  private async *streamChatRunEvents(
    runId: string,
    options: StreamChatRunEventsOptions = {}
  ): AsyncIterableIterator<ChatRunEvent> {
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (options.lastEventId !== undefined && Number.isFinite(options.lastEventId)) {
      headers['Last-Event-ID'] = String(options.lastEventId);
    }
    const response = await this.chatRunFetch(
      `/v1/chat/runs/${encodeURIComponent(runId)}/events/stream`,
      { headers, signal: options.signal }
    );
    if (!response.ok || !response.body) {
      throw new Error(`Chat run event stream failed with status ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const findFrameBoundary = (source: string): { index: number; length: number } | null => {
      const lf = source.indexOf('\n\n');
      const crlf = source.indexOf('\r\n\r\n');
      if (lf === -1 && crlf === -1) return null;
      if (lf === -1) return { index: crlf, length: 4 };
      if (crlf === -1 || lf < crlf) return { index: lf, length: 2 };
      return { index: crlf, length: 4 };
    };

    const yieldFrame = (frame: string): ChatRunEvent | null => {
      if (!frame.trim() || frame.startsWith(':')) return null;
      let eventName = 'message';
      let data = '';
      for (const rawLine of frame.split(/\r?\n/)) {
        if (rawLine.startsWith('event:')) eventName = rawLine.slice(6).trim();
        else if (rawLine.startsWith('data:')) data += (data ? '\n' : '') + rawLine.slice(5).trim();
      }
      if (eventName === 'run_status' || !data) return null;
      try {
        return JSON.parse(data) as ChatRunEvent;
      } catch {
        return null;
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          const remaining = buffer.trim();
          if (remaining) {
            const parsed = yieldFrame(remaining);
            if (parsed) yield parsed;
          }
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundary = findFrameBoundary(buffer);
        while (boundary !== null) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary.length);
          boundary = findFrameBoundary(buffer);
          const parsed = yieldFrame(frame);
          if (parsed) yield parsed;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Send a single chat completion request (no auto tool execution).
   */
  private async createSingleCompletion(
    params: ChatCompletionParams
  ): Promise<ChatStream | ChatCompletionResult> {
    const jobID = getUUID();
    const normalizedMessages = await normalizeVisionMessages(params.messages);

    // Build chat_template_kwargs from think parameter
    const chatTemplateKwargs = this.buildChatTemplateKwargs(params.think);

    const request: ChatRequestMessage = {
      jobID,
      type: 'llm',
      model: params.model,
      messages: normalizedMessages,
      appSource: params.appSource || this.client.appSource,
      max_tokens: params.max_tokens,
      temperature: params.temperature,
      top_p: params.top_p,
      top_k: params.top_k,
      min_p: params.min_p,
      stream: params.stream,
      repetition_penalty: params.repetition_penalty,
      frequency_penalty: params.frequency_penalty,
      presence_penalty: params.presence_penalty,
      stop: params.stop,
      tokenType: params.tokenType,
      tools: params.tools,
      tool_choice: params.tool_choice,
      sogni_tools: this.normalizeSogniToolsMode(params.sogni_tools),
      sogni_tool_execution: params.sogni_tool_execution,
      taskProfile: params.taskProfile,
      ...(chatTemplateKwargs && { chat_template_kwargs: chatTemplateKwargs }),
      ...(params.response_format && { response_format: params.response_format })
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
