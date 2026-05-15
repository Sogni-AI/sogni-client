// Account API
import AccountApi from './Account';
import CurrentAccount from './Account/CurrentAccount';
// ApiClient
import ApiClient, { ApiError, ApiResponse } from './ApiClient';
import { SupernetType } from './ApiClient/WebSocketClient/types';
import type {
  SocketEventName,
  SocketEventSubscriptionsUpdatedData
} from './ApiClient/WebSocketClient/events';
import type {
  SocketEventSubscriptionInput,
  SocketEventSubscriptionName,
  SocketEventSubscriptions,
  SocketEventSubscriptionUpdate
} from './ApiClient/WebSocketClient/eventSubscriptions';
import { ApiConfig } from './ApiGroup';
// Utils
import { DefaultLogger, Logger, LogLevel } from './lib/DefaultLogger';
import EIP712Helper from './lib/EIP712Helper';
// Projects API
import ProjectsApi from './Projects';
import Job, { JobStatus } from './Projects/Job';
import Project, { ProjectStatus } from './Projects/Project';
import {
  AudioOutputFormat,
  AudioProjectParams,
  AvailableModel,
  ImageProjectParams,
  ImageOutputFormat,
  ProjectParams,
  VideoProjectParams,
  AudioFormat,
  VideoFormat,
  VideoOutputFormat,
  VideoWorkflowType
} from './Projects/types';
import {
  ControlNetName,
  ControlNetParams,
  ControlNetMode,
  VideoControlNetName,
  VideoControlNetParams
} from './Projects/types/ControlNetParams';
// Chat API
import ChatApi from './Chat';
import ChatStream from './Chat/ChatStream';
import ChatToolsApi from './Chat/ChatTools';
import {
  ChatMessage,
  ChatCompletionParams,
  ChatCompletionChunk,
  ChatCompletionResult,
  ChatJobStateEvent,
  ChatResponseFormat,
  ChatRunEvent,
  ChatRunRecord,
  ChatRunStatus,
  StartChatRunParams,
  StreamChatRunEventsOptions,
  ContentPart,
  HostedChatCompletionParams,
  HostedChatCompletionResult,
  HostedChatCompletionChoice,
  HostedChatCompletionMessage,
  HostedCreativeWorkflowReference,
  TextContentPart,
  ImageUrlContentPart,
  TokenUsage as ChatTokenUsage,
  LLMCostEstimation,
  LLMJobCost,
  LLMModelInfo,
  LLMParamConstraint,
  LLMSamplingDefaults,
  ToolDefinition,
  ToolCall,
  ToolCallDelta,
  ToolCallFunction,
  ToolChoice,
  ToolFunction,
  SogniToolsMode,
  ToolExecutionProgress,
  ToolExecutionResult,
  ToolHistoryEntry,
  ToolExecutionOptions
} from './Chat/types';
import { SogniTools, isSogniToolCall, parseToolCallArguments } from './Chat/tools';
// Creative Workflows API
import CreativeWorkflowsApi, { parseCreativeWorkflowSseChunk } from './CreativeWorkflows';
import CreativeWorkflowTemplatesApi from './CreativeWorkflows/Templates';
import {
  CreativeWorkflowArtifact,
  CreativeWorkflowEvent,
  CreativeWorkflowRecord,
  CreativeWorkflowSseEvent,
  CreativeWorkflowStatus,
  CreativeWorkflowHostedToolName,
  ListCreativeWorkflowOptions,
  ReseedCreativeWorkflowOptions,
  ReseedCreativeWorkflowParams,
  ReseedCreativeWorkflowResult,
  ResumeCreativeWorkflowOptions,
  ResumeCreativeWorkflowParams,
  ResumeCreativeWorkflowResult,
  StartCreativeWorkflowOptions,
  StartCreativeWorkflowParams,
  StartCreativeWorkflowDependency,
  StartCreativeWorkflowInput,
  StartCreativeWorkflowStep,
  StreamCreativeWorkflowEventsOptions
} from './CreativeWorkflows/types';
import {
  ForkWorkflowTemplateBody,
  ListWorkflowTemplatesOptions,
  ListWorkflowTemplatesResult,
  WorkflowTemplate,
  WorkflowTemplateAuthor,
  WorkflowTemplateRequestOptions,
  WorkflowTemplateStability,
  WorkflowTemplateVisibility,
  WorkflowTemplateVisibilityFilter
} from './CreativeWorkflows/Templates/types';
// Stats API
import StatsApi from './Stats';
// Replay records
import ReplayApi from './Replay';
import {
  GetReplayRecordResult,
  ListReplayRecordsOptions,
  ListReplayRecordsResult,
  ReplayRecordSummary,
  ReplayRequestOptions,
  ReplayWriteResult,
  RunRecord
} from './Replay/types';
// Base Types
import ErrorData from './types/ErrorData';
import { TokenType } from './types/token';
import {
  ApiKeyAuthManager,
  CookieAuthManager,
  TokenAuthData,
  TokenAuthManager
} from './lib/AuthManager';
import { MeData } from './Account/types';

export type {
  AudioFormat,
  AudioOutputFormat,
  AudioProjectParams,
  AvailableModel,
  ChatCompletionChunk,
  ChatCompletionParams,
  ChatCompletionResult,
  ChatJobStateEvent,
  ChatMessage,
  ChatResponseFormat,
  ChatRunEvent,
  ChatRunRecord,
  ChatRunStatus,
  ChatTokenUsage,
  StartChatRunParams,
  StreamChatRunEventsOptions,
  ContentPart,
  HostedChatCompletionChoice,
  HostedChatCompletionMessage,
  HostedChatCompletionParams,
  HostedChatCompletionResult,
  HostedCreativeWorkflowReference,
  CreativeWorkflowArtifact,
  CreativeWorkflowEvent,
  CreativeWorkflowRecord,
  CreativeWorkflowSseEvent,
  CreativeWorkflowStatus,
  ImageUrlContentPart,
  ListCreativeWorkflowOptions,
  LLMCostEstimation,
  LLMJobCost,
  LLMModelInfo,
  LLMParamConstraint,
  LLMSamplingDefaults,
  ControlNetMode,
  ControlNetName,
  ControlNetParams,
  TextContentPart,
  ErrorData,
  ImageProjectParams,
  ImageOutputFormat,
  JobStatus,
  Logger,
  LogLevel,
  ProjectParams,
  ProjectStatus,
  CreativeWorkflowHostedToolName,
  StartCreativeWorkflowOptions,
  StartCreativeWorkflowParams,
  StartCreativeWorkflowDependency,
  StartCreativeWorkflowInput,
  StartCreativeWorkflowStep,
  StreamCreativeWorkflowEventsOptions,
  ResumeCreativeWorkflowOptions,
  ResumeCreativeWorkflowParams,
  ResumeCreativeWorkflowResult,
  ReseedCreativeWorkflowOptions,
  ReseedCreativeWorkflowParams,
  ReseedCreativeWorkflowResult,
  ForkWorkflowTemplateBody,
  ListWorkflowTemplatesOptions,
  ListWorkflowTemplatesResult,
  WorkflowTemplate,
  WorkflowTemplateAuthor,
  WorkflowTemplateRequestOptions,
  WorkflowTemplateStability,
  WorkflowTemplateVisibility,
  WorkflowTemplateVisibilityFilter,
  RunRecord,
  ReplayWriteResult,
  ReplayRecordSummary,
  ReplayRequestOptions,
  ListReplayRecordsOptions,
  ListReplayRecordsResult,
  GetReplayRecordResult,
  SupernetType,
  TokenType,
  ToolCall,
  ToolCallDelta,
  ToolCallFunction,
  ToolChoice,
  ToolDefinition,
  ToolExecutionOptions,
  ToolExecutionProgress,
  ToolExecutionResult,
  ToolFunction,
  ToolHistoryEntry,
  SogniToolsMode,
  SocketEventName,
  SocketEventSubscriptionInput,
  SocketEventSubscriptionName,
  SocketEventSubscriptions,
  SocketEventSubscriptionsUpdatedData,
  SocketEventSubscriptionUpdate,
  VideoControlNetName,
  VideoControlNetParams,
  VideoFormat,
  VideoOutputFormat,
  VideoProjectParams,
  VideoWorkflowType
};

export {
  ApiError,
  ApiKeyAuthManager,
  ChatStream,
  ChatToolsApi,
  CreativeWorkflowsApi,
  CreativeWorkflowTemplatesApi,
  ReplayApi,
  CurrentAccount,
  Job,
  Project,
  SogniTools,
  isSogniToolCall,
  parseCreativeWorkflowSseChunk,
  parseToolCallArguments
};

export interface SogniClientConfig {
  /**
   * The application ID string. Must be unique, multiple connections with the same ID will be rejected.
   */
  appId: string;
  /**
   * Optional client app/source label to attach to this connection for server-side attribution.
   * The socket server uses this as the default source for project and chat requests from this client.
   */
  appSource?: string;
  /**
   * Initial WebSocket event subscriptions for this connection.
   *
   * Omit this option to receive the default socket event stream. To reduce socket traffic for
   * proxy or headless clients that do not need live worker counts, set
   * `{ modelAvailability: false }` to opt out of `swarmModels` and `swarmLLMModels` updates.
   */
  socketEventSubscriptions?: SocketEventSubscriptions;
  /**
   * Override the default REST API endpoint
   * @internal
   */
  restEndpoint?: string;
  /**
   * Override the default WebSocket API endpoint
   * @internal
   */
  socketEndpoint?: string;
  /**
   * Disable WebSocket connection. Useful for testing or when WebSocket is not needed.
   * Note that many APIs may not work without WebSocket connection.
   * @experimental
   * @internal
   */
  disableSocket?: boolean;
  /**
   * Which network to use after logging in. Can be 'fast' or 'relaxed'
   * @default 'fast'
   */
  network?: SupernetType;
  /**
   * Logger to use. If not provided, a default console logger will be used
   */
  logger?: Logger;
  /**
   * Log level to use. This option is ignored if a logger is provided
   * @default 'warn'
   **/
  logLevel?: LogLevel;
  /**
   * If true, the client will connect to the testnet. Ignored if jsonRpcUrl is provided
   */
  testnet?: boolean;
  /**
   * API key for authentication. When provided, the client will use API key authentication
   * instead of username/password login. API keys support both socket-based operations
   * (image generation, LLM chat) and most REST API calls (balance, profile, etc.).
   * Sensitive account operations (withdrawals, staking, 2FA) are not available with API key auth.
   */
  apiKey?: string;
  /**
   * Authentication type to use. Can be 'token', 'cookie', or 'apiKey'. If not provided, 'token'
   * will be used. When `apiKey` is provided in the config, this is automatically set to 'apiKey'.
   * `token` authentication relies on a token stored in the client instance. This is what 3rd party
   * Node.js apps should use.
   * `cookie` authentication relies on htmlOnly cookie, set by the server. This will only work for
   * browser apps located on .sogni.ai subdomains due to CORS restrictions.
   * `apiKey` authentication uses a pre-generated API key.
   * @default 'token'
   * @experimental
   */
  authType?: 'token' | 'cookies' | 'apiKey';
  /**
   * Browser only. If true, the client will use a single WebSocket connection shared across multiple
   * tabs. This is useful for browser apps that need to process multiple projects at the same time.
   * Only works in browser environment and with cookie authentication.
   * @default false
   * @experimental
   */
  multiInstance?: boolean;
}

export class SogniClient {
  account: AccountApi;
  projects: ProjectsApi;
  stats: StatsApi;
  /**
   * Chat surfaces.
   * - `chat.completions.create` — socket-native chat completion.
   * - `chat.hosted.create` — hosted REST chat completion (synchronous).
   * - `chat.runs.{create, get, cancel, streamEvents}` — durable hosted
   *   chat runs that survive client disconnect, browser close, network
   *   drop, and API worker restart. See `/v1/chat/runs` REST surface.
   * - `chat.tools.execute*` — execute Sogni platform tools surfaced by
   *   the chat completion (image / video / music generation).
   */
  chat: ChatApi;
  /**
   * Durable creative workflows (`/v1/creative-agent/workflows`). Submit
   * an explicit step sequence and follow its progress without keeping
   * the client connected.
   */
  workflows: CreativeWorkflowsApi;
  /**
   * Replay records (`/v1/replay/records`). Writes one RunRecord per
   * chat / harness turn and exposes list + get for the replay viewer.
   * Per-owner isolation is enforced server-side via the SDK auth
   * identity.
   */
  replay: ReplayApi;

  apiClient: ApiClient;

  private constructor(config: ApiConfig) {
    this.account = new AccountApi(config);
    this.projects = new ProjectsApi(config);
    this.stats = new StatsApi(config);
    this.chat = new ChatApi(config, this.projects);
    this.workflows = new CreativeWorkflowsApi(config);
    this.replay = new ReplayApi(config);

    this.apiClient = config.client;
  }

  get currentAccount() {
    return this.account.currentAccount;
  }

  /**
   * When using token authentication, this method can be used to set the tokens.
   * This is useful when the tokens are stored in a secure location and you want to resume the session.
   * @param tokens
   */
  async setTokens(tokens: TokenAuthData): Promise<void> {
    const auth = this.apiClient.auth;
    if (!(auth instanceof TokenAuthManager)) {
      throw new Error('setTokens can only be used with token authentication');
    }
    await auth.authenticate(tokens);
    await this.account.me();
  }

  /**
   * When using cookie authentication, client has no way to detect if the user is authenticated or not.
   * This method can be used to check if the user is authenticated and populate the currentAccount.
   * @returns
   */
  async checkAuth(): Promise<boolean> {
    const auth = this.apiClient.auth;
    if (!(auth instanceof CookieAuthManager)) {
      throw Error('This method should only be called when using cookie auth');
    }
    try {
      const res = await this.apiClient.rest.get<ApiResponse<MeData>>('/v1/account/me');
      await auth.authenticate();
      this.currentAccount._update({
        username: res.data.username,
        email: res.data.currentEmail,
        walletAddress: res.data.walletAddress
      });
      return true;
    } catch (e) {
      this.apiClient.logger.info('Client is not authenticated');
      return false;
    }
  }

  /**
   * Dispose of this client instance, disconnecting the socket and cleaning up resources.
   * After calling this method, the instance should not be used.
   */
  dispose() {
    this.apiClient.dispose();
  }

  /**
   * Update WebSocket event subscriptions for this live client.
   *
   * This is useful when a process needs the initial model availability snapshot for startup, but
   * does not need ongoing worker count updates afterward.
   */
  async setSocketEventSubscriptions(update: SocketEventSubscriptionInput): Promise<void> {
    await this.apiClient.setSocketEventSubscriptions(update);
  }

  /**
   * Create client instance, with default configuration
   * @param config
   */
  static async createInstance(config: SogniClientConfig): Promise<SogniClient> {
    const restEndpoint = config.restEndpoint || 'https://api.sogni.ai';
    const socketEndpoint = config.socketEndpoint || 'wss://socket.sogni.ai';
    const network = config.network || 'fast';
    const logger = config.logger || new DefaultLogger(config.logLevel || 'warn');
    const isTestnet = config.testnet !== undefined ? config.testnet : false;
    const authType = config.apiKey ? 'apiKey' : config.authType || 'token';

    const client = new ApiClient({
      baseUrl: restEndpoint,
      socketUrl: socketEndpoint,
      appId: config.appId,
      appSource: config.appSource,
      socketEventSubscriptions: config.socketEventSubscriptions,
      networkType: network,
      logger,
      authType,
      disableSocket: config.disableSocket,
      multiInstance: config.multiInstance
    });
    const eip712 = new EIP712Helper({
      name: isTestnet ? 'Sogni-testnet' : 'Sogni AI',
      version: '1',
      chainId: isTestnet ? '84532' : '8453'
    });
    const sogniClient = new SogniClient({ client, eip712 });

    // Auto-authenticate with API key if provided
    if (config.apiKey) {
      const auth = client.auth as ApiKeyAuthManager;
      await auth.authenticate(config.apiKey);
    }

    return sogniClient;
  }
}
