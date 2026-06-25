import { SupernetType } from './types.js';
import { Balances } from '../../Account/types.js';
import { LLMJobCost, LLMModelInfo, ToolCallDelta } from '../../Chat/types.js';
import { SubscriptionPlanId } from '../../Account/subscription.types.js';

export interface SocketSubscriptionEntitlementData {
  active: boolean;
  trialing: boolean;
  trialCapped: boolean;
  subscription: {
    provider: string | null;
    tier: string | null;
    term: string | null;
    status: string | null;
    periodStart: number;
    periodEnd: number;
    graceEnd: number;
    trialEnd: number;
    version: string | null;
    /**
     * Whether the subscription is set to end when the current period ends.
     * Carried by newer socket builds only; when absent the SDK falls back to
     * inferring it from `status === 'cancelled'`.
     */
    cancelAtPeriodEnd?: boolean;
    /**
     * Tier the plan switches to at the next renewal when a change is
     * scheduled. Carried by newer socket builds only; `null` when no change
     * is pending.
     */
    scheduledTier?: string | null;
    /**
     * Billing term the plan switches to at the next renewal when a change is
     * scheduled. Carried by newer socket builds only; `null` when no change
     * is pending.
     */
    scheduledTerm?: string | null;
    /**
     * Epoch milliseconds when the scheduled plan/term change takes effect.
     * Carried by newer socket builds only; `null` when no change is pending.
     */
    scheduledChangeAt?: number | null;
    /**
     * Capability flags enabled by this subscription, when provided by the
     * server. When absent the SDK derives a minimal local map.
     */
    capabilities?: Record<string, boolean> | null;
    /**
     * Whether a deferred payment is awaiting confirmation. Not emitted by the
     * backend socket publisher today (the REST snapshot is the source); typed
     * here so the mapper can pass it through if a future build adds it.
     */
    paymentPending?: boolean | null;
  } | null;
}

export interface AuthenticatedData {
  id: string;
  clientType: 'artist' | 'worker';
  username: string;
  address: string;
  SID: number;
  clientSID: number;
  addressSID: number;
  balanceVersion: 2;
  tokens: {
    sogni: {
      settled: string;
      credit: string;
      debit: string;
      net: string;
    };
    spark: {
      settled: string;
      credit: string;
      debit: string;
      net: string;
    };
  };
  subscriptionEntitlement?: SocketSubscriptionEntitlementData;
  activeProjects: [];
  unclaimedCompletedProjects: [];
  isMainnet: boolean;
  accountWasMigrated: boolean;
  hasUnclaimedAirdrop: boolean;
  firstLoginAfterMigration: boolean;
}

export type JobErrorData = {
  jobID: string;
  imgID?: string;
  isFromWorker: boolean;
  error_message: string;
  error: number | string;
  /** `true` when this render failure is a subscription FEATURE-gate denial (4081). */
  subscriptionLimit?: boolean;
  /** Plans that would satisfy the gated feature, cheapest-first. */
  requiredPlans?: SubscriptionPlanId[];
  /** Stable machine key for the gated capability, e.g. `'video_4k_render'`. */
  feature?: string;
  /** Standalone user-facing English describing the limitation. */
  limitation?: string;
};

export type JobProgressData = {
  jobID: string;
  imgID: string;
  hasImage?: boolean;
  step?: number;
  stepCount?: number;
  progress?: number;
};

export type JobETAData = {
  jobID: string;
  imgID?: string;
  etaSeconds: number;
};

export type JobResultData = {
  jobID: string;
  imgID: string;
  performedStepCount?: number;
  lastSeed?: string;
  userCanceled?: boolean;
  triggeredNSFWFilter?: boolean;
  resultUrl?: string;
  resultKey?: string;
  /**
   * @deprecated Use `resultUrl`. Kept for older video worker/socket payload compatibility.
   */
  videoUrl?: string;
  /**
   * @deprecated Use `resultUrl`. Kept for older video worker/socket payload compatibility.
   */
  videoFile?: string;
};

export type JobStateData =
  | {
      type: 'initiatingModel' | 'jobStarted';
      jobID: string;
      imgID: string;
      workerName: string;
      positivePrompt?: string;
      negativePrompt?: string;
      jobIndex?: number;
    }
  | {
      type: 'assigned';
      jobID: string;
      workerName: string;
    }
  | {
      jobID: string;
      type: 'queued';
      queuePosition: number;
    }
  | {
      type: 'jobCompleted';
      jobID: string;
    };

export type ServerConnectData = {
  network: SupernetType;
};

export type ServerDisconnectData = {
  code: number;
  reason: string;
};

export type ToastMessage = {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  // Number of milliseconds to show the toast
  autoClose: number;
  stickyID: string;
};

export type ArtistCancelConfirmation = {
  didCancel: boolean;
  error_message: string;
  jobID: string;
};

export type JobTokensData = {
  jobID: string;
  content?: string;
  role?: string;
  finishReason?: string | null;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
  };
  tool_calls?: ToolCallDelta[];
};

export type LLMJobResultData = {
  jobID: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
  };
  timeTaken: number;
  /** Actual cost breakdown from server settlement */
  cost?: LLMJobCost;
  /** Worker username that processed this request */
  workerName?: string;
};

export type LLMJobErrorData = {
  jobID: string;
  error: string;
  /**
   * Server error code as a string (e.g. `'4078'`, `'4080'`). The socket
   * server (jobsController `handleLLMJobRequest`) attaches it to
   * `subscription_unavailable` denials of jobs submitted with
   * `billingMode: 'subscription'`; absent on other errors. See
   * `SUBSCRIPTION_ERROR_CODES`.
   */
  error_code?: string;
  error_message: string;
  /** Worker username that was processing this request (if assigned) */
  workerName?: string;
  /** `true` when this failure is a subscription FEATURE-gate denial (4081). */
  subscriptionLimit?: boolean;
  /** Plans that would satisfy the gated feature, cheapest-first. */
  requiredPlans?: SubscriptionPlanId[];
  /** Stable machine key for the gated capability, e.g. `'video_4k_render'`. */
  feature?: string;
  /** Standalone user-facing English describing the limitation. */
  limitation?: string;
};

export type SocketEventSubscriptionsUpdatedData = {
  socketEventSubscriptions: Record<string, boolean | undefined>;
};

export type SocketEventMap = {
  /**
   * @event WebSocketClient#authenticated - Received after successful connection to the WebSocket server
   */
  authenticated: AuthenticatedData;
  /**
   * @event WebSocketClient#subscriptionEntitlementUpdated - Subscription entitlement changed while connected
   */
  subscriptionEntitlementUpdated: SocketSubscriptionEntitlementData;
  /**
   * @event WebSocketClient#balanceUpdate - Received balance update
   */
  balanceUpdate: Balances;
  /**
   * @event WebSocketClient#changeNetwork - Default network changed
   */
  changeNetwork: { network: SupernetType };
  /**
   * @event WebSocketClient#jobError - Job error occurred
   */
  jobError: JobErrorData;
  /**
   * @event WebSocketClient#jobProgress - Job progress update
   */
  jobProgress: JobProgressData;
  /**
   * @event WebSocketClient#jobETA - Job ETA update (sent every second during inference by ComfyUI workers)
   * Note: Only available for ComfyUI-based workers during video generation
   */
  jobETA: JobETAData;
  /**
   * @event WebSocketClient#jobResult - Job result received
   */
  jobResult: JobResultData;
  /**
   * @event WebSocketClient#jobState - Job state changed
   */
  jobState: JobStateData;
  /**
   * @event WebSocketClient#jobTokens - LLM token stream chunk received
   * Sent by LLM workers during chat completion streaming
   */
  jobTokens: JobTokensData;
  /**
   * @event WebSocketClient#llmJobResult - LLM job completed with usage data
   * Sent by LLM workers when a chat completion finishes
   */
  llmJobResult: LLMJobResultData;
  /**
   * @event WebSocketClient#llmJobError - LLM job error
   */
  llmJobError: LLMJobErrorData;
  /**
   * @event WebSocketClient#swarmModels - Received swarm model count
   */
  swarmModels: Record<string, number>;
  /**
   * @event WebSocketClient#swarmLLMModels - Available LLM models with worker counts
   */
  swarmLLMModels: Record<string, number | LLMModelInfo>;
  /**
   * @event WebSocketClient#socketEventSubscriptionsUpdated - Current socket event subscriptions changed
   */
  socketEventSubscriptionsUpdated: SocketEventSubscriptionsUpdatedData;
  /**
   * @event WebSocketClient#connected - WebSocket connection opened
   */
  connected: ServerConnectData;
  /**
   * @event WebSocketClient#disconnected - WebSocket connection was closed
   */
  disconnected: ServerDisconnectData;
  /**
   * @event WebSocketClient#toastMessage - Toast message received
   */
  toastMessage: ToastMessage;

  artistCancelConfirmation: ArtistCancelConfirmation;
};

export type SocketEventName = keyof SocketEventMap;
