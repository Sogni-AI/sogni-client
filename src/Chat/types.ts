export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  /** Token type to use for billing. Defaults to 'sogni'. */
  tokenType?: 'sogni' | 'spark';
}

export interface ChatRequestMessage {
  jobID: string;
  type: 'llm';
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  tokenType?: 'sogni' | 'spark';
}

export interface ChatCompletionChunk {
  jobID: string;
  content: string;
  role?: string;
  finishReason?: string | null;
  usage?: TokenUsage;
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
}

export interface LLMModelInfo {
  workers: number;
  maxContextLength?: number;
  maxOutputTokens?: LLMParamConstraint;
  temperature?: LLMParamConstraint;
  top_p?: LLMParamConstraint;
  frequency_penalty?: LLMParamConstraint;
  presence_penalty?: LLMParamConstraint;
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
