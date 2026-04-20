export interface ToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ToolDefinition {
  type: 'function';
  function: ToolFunction;
}

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export type ToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

/** Text content part for multimodal messages. */
export interface TextContentPart {
  type: 'text';
  text: string;
}

/** Image URL content part for multimodal messages (vision). */
export interface ImageUrlContentPart {
  type: 'image_url';
  image_url: {
    /** Supports http(s) URLs and data URIs (e.g., `data:image/jpeg;base64,...`). */
    url: string;
    /** Controls how the model processes the image: 'auto' (default), 'low' (faster), 'high' (more detail). */
    detail?: 'auto' | 'low' | 'high';
  };
}

/** A single content part in a multimodal message. */
export type ContentPart = TextContentPart | ImageUrlContentPart;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  stream?: boolean;
  repetition_penalty?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  /** Token type to use for billing. Defaults to 'sogni'. */
  tokenType?: 'sogni' | 'spark';
  /** Tool definitions for function calling. */
  tools?: ToolDefinition[];
  /** Controls which (if any) tool is called by the model. */
  tool_choice?: ToolChoice;
  /**
   * Control thinking/reasoning mode for supported models (e.g. Qwen3/3.5).
   * When `false`, sends `chat_template_kwargs: { enable_thinking: false }` so
   * the model skips its internal reasoning step. When `true`, explicitly enables
   * thinking. When omitted, server defaults apply.
   */
  think?: boolean;
  /** Hint for server-side preset selection. */
  taskProfile?: 'general' | 'coding' | 'reasoning';
  /**
   * Automatically execute Sogni tool calls (image/video/music generation) when the
   * model requests them. The SDK handles the full multi-round tool calling loop:
   * send completion → execute tools → feed results back → repeat until done.
   *
   * Only supported with `stream: false`. For streaming, use `chat.tools.executeAll()`
   * manually in your own loop.
   */
  autoExecuteTools?: boolean;
  /**
   * Handler for non-Sogni tool calls when `autoExecuteTools` is enabled.
   * Called for any tool call whose name does NOT start with `sogni_`.
   * Must return a string (the tool result content).
   */
  onToolCall?: (toolCall: ToolCall) => Promise<string>;
  /**
   * Progress callback for Sogni tool execution when `autoExecuteTools` is enabled.
   * Fires as each tool call progresses through creation, queuing, processing, and completion.
   */
  onToolProgress?: (toolCall: ToolCall, progress: ToolExecutionProgress) => void;
  /**
   * Maximum number of tool calling rounds when `autoExecuteTools` is enabled.
   * Prevents infinite loops. Default: 5.
   */
  maxToolRounds?: number;
}

export interface ChatRequestMessage {
  jobID: string;
  type: 'llm';
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  stream?: boolean;
  repetition_penalty?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  tokenType?: 'sogni' | 'spark';
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
  taskProfile?: 'general' | 'coding' | 'reasoning';
  /** Per-request chat template arguments (e.g. `{ enable_thinking: false }` for llama.cpp). */
  chat_template_kwargs?: Record<string, unknown>;
}

export interface ChatCompletionChunk {
  jobID: string;
  content: string;
  role?: string;
  finishReason?: string | null;
  usage?: TokenUsage;
  /** Tool call deltas streamed incrementally during function calling. */
  tool_calls?: ToolCallDelta[];
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
}

export interface ChatCompletionResult {
  jobID: string;
  content: string;
  role: string;
  finishReason: string;
  usage: TokenUsage;
  timeTaken: number;
  /** Name of the worker that processed this request */
  workerName?: string;
  /** Actual cost of the completed request (from server settlement) */
  cost?: LLMJobCost;
  /** Accumulated tool calls from the model (present when finishReason is 'tool_calls'). */
  tool_calls?: ToolCall[];
  /** History of tool calling rounds when `autoExecuteTools` was used. */
  toolHistory?: ToolHistoryEntry[];
}

export interface ChatJobStateEvent {
  jobID: string;
  type: string;
  workerName?: string;
  queuePosition?: number;
  /** Model ID (present in 'pending' and 'queued' states) */
  modelId?: string;
  /** Estimated cost in the requested token type, stringified BigNumber (present in 'pending' and 'queued' states) */
  estimatedCost?: string;
}

export interface LLMParamConstraint {
  min: number;
  max: number;
  decimals?: number;
  default: number;
  thinkingComplexDefault?: number;
}

/** Recommended sampling defaults for a specific thinking mode. */
export interface LLMSamplingDefaults {
  temperature: number;
  top_p: number;
  top_k: number;
  min_p?: number;
  repetition_penalty?: number;
  presence_penalty: number;
}

export interface LLMModelInfo {
  workers: number;
  maxContextLength?: number;
  maxOutputTokens?: LLMParamConstraint;
  temperature?: LLMParamConstraint;
  top_p?: LLMParamConstraint;
  top_k?: LLMParamConstraint;
  min_p?: LLMParamConstraint;
  repetition_penalty?: LLMParamConstraint;
  frequency_penalty?: LLMParamConstraint;
  presence_penalty?: LLMParamConstraint;
  /** Recommended defaults when thinking mode is enabled. */
  defaultsThinking?: LLMSamplingDefaults;
  /** Recommended defaults when thinking mode is enabled for precise coding tasks. */
  defaultsThinkingCoding?: LLMSamplingDefaults;
  /** Recommended defaults when thinking mode is disabled. */
  defaultsNonThinking?: LLMSamplingDefaults;
  /** Recommended defaults when thinking mode is disabled for analytical reasoning tasks. */
  defaultsNonThinkingReasoning?: LLMSamplingDefaults;
}

export interface LLMJobCost {
  /** Actual cost in USD (stringified BigNumber) */
  costInUSD: string;
  /** Actual cost in the requested token type (stringified BigNumber) */
  costInToken: string;
  /** Actual cost in SOGNI tokens (stringified BigNumber) */
  costInSogni: string;
  /** Actual cost in Spark tokens (stringified BigNumber) */
  costInSpark: string;
  /** Input tokens used */
  inputTokens: number;
  /** Output tokens generated */
  outputTokens: number;
}

export interface LLMCostEstimation {
  /** Estimated cost in USD */
  costInUSD: number;
  /** Estimated cost in SOGNI tokens (market rate) */
  costInSogni: number;
  /** Estimated cost in Spark tokens (fixed rate) */
  costInSpark: number;
  /** Estimated cost in the requested token type */
  costInToken: number;
  /** Estimated input token count */
  inputTokens: number;
  /** Maximum output tokens requested */
  outputTokens: number;
}

export interface LLMEstimateResponse {
  request: {
    model: string;
    inputTokens: number;
    maxOutputTokens: number;
    tokenType: string;
    time: string;
  };
  quote: {
    costInUSD: number;
    costInSogni: number;
    costInSpark: number;
    costInToken: number;
    inputTokens: number;
    outputTokens: number;
  };
}

// ============================================================
// Tool Execution Types
// ============================================================

/** Progress update during Sogni tool execution (media generation). */
export interface ToolExecutionProgress {
  /** Current execution status. */
  status: 'creating' | 'queued' | 'processing' | 'completed' | 'failed';
  /** Completion percentage (0-100). */
  percent: number;
  /** Estimated completion time (available during processing). */
  eta?: Date;
  /** Result URLs (populated on completion). */
  resultUrls?: string[];
}

/** Result of executing a single tool call. */
export interface ToolExecutionResult {
  /** The tool_call ID from the model response. */
  toolCallId: string;
  /** Name of the tool that was executed. */
  toolName: string;
  /** Whether execution succeeded. */
  success: boolean;
  /** Generated media URLs (empty for non-Sogni tools or on failure). */
  resultUrls: string[];
  /** JSON string ready to use as the `content` of a `tool` role message. */
  content: string;
  /** Error message if execution failed. */
  error?: string;
}

/** Record of a single tool calling round in an auto-execute session. */
export interface ToolHistoryEntry {
  /** Zero-based round number. */
  round: number;
  /** Tool calls requested by the model in this round. */
  toolCalls: ToolCall[];
  /** Results of executing those tool calls. */
  toolResults: ToolExecutionResult[];
}

/** Options for `chat.tools.execute()` and `chat.tools.executeAll()`. */
export interface ToolExecutionOptions {
  /** Token type to use for billing the generated media. */
  tokenType?: 'sogni' | 'spark';
  /** Network to use for media generation. */
  network?: 'fast' | 'relaxed';
  /** Number of media items to generate per tool call. Default: 1. */
  numberOfMedia?: number;
  /** Progress callback fired during media generation. */
  onProgress?: (progress: ToolExecutionProgress) => void;
  /**
   * Timeout in milliseconds for media generation. If the project does not
   * complete within this time, the tool call will fail with a timeout error
   * and the project will be canceled.
   *
   * Default: 600000 (10 minutes).
   */
  timeout?: number;
}
