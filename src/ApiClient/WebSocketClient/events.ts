import { SupernetType } from './types.js';
import { Balances } from '../../Account/types.js';
import { LLMJobCost, LLMModelInfo, ToolCallDelta } from '../../Chat/types.js';
import { SubscriptionPlanId } from '../../Account/subscription.types.js';

export interface SocketSubscriptionFairUseState {
  limited: true;
  usageSpark: number;
  usageUsd: number;
  planPriceUsd: number;
  /** Epoch milliseconds on the socket wire; mapped to ISO in AccountApi. */
  resetAt: number;
  fastConcurrencyLimit: 1;
  fastQueueLimit: 1;
  relaxedUnrestricted: true;
  upgradeAvailable: boolean;
}

export interface SocketSubscriptionLimitNoticeData {
  version: number;
  reason: string;
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  currentPlan?: string | null;
  subscriptionTier?: string | null;
  fairUse?: SocketSubscriptionFairUseState | null;
  requiredPlans?: SubscriptionPlanId[];
}

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
    /** Monthly Fast-network fair-use state, when currently active. */
    fairUse?: SocketSubscriptionFairUseState | null;
  } | null;
  /**
   * `true` while free Spark cannot be spent on this account. Rides on the
   * entitlement push so the client reflects the current state live. Carried by
   * newer socket builds only.
   */
  freeSparkLocked?: boolean;
  /** Which call to action to present while locked: `'trial'` or `'purchase'`. */
  freeSparkUnlockPath?: 'trial' | 'purchase';
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
  /**
   * This app-id's projects that are still in flight (pending, queued, or
   * rendering). The server reclaims them for the new socket, so live events
   * follow. See {@link RecoveredProject}.
   */
  activeProjects: RecoveredProject[];
  /**
   * This app-id's projects that reached a terminal state while it had no
   * socket. Held server-side for one hour; delivered here once.
   */
  unclaimedCompletedProjects: RecoveredProject[];
  isMainnet: boolean;
  accountWasMigrated: boolean;
  /**
   * `true` while free Spark cannot be spent on this account. Carried by newer
   * socket builds only. This field drives presentation; the server applies the
   * rule regardless of what the client received.
   */
  freeSparkLocked?: boolean;
  /** Which call to action to present while locked: `'trial'` or `'purchase'`. */
  freeSparkUnlockPath?: 'trial' | 'purchase';
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
  /** Actionable fair-use details when `feature === 'monthly_fair_use'`. */
  fairUse?: SocketSubscriptionFairUseState | null;
};

export type JobProgressData = {
  jobID: string;
  imgID: string;
  hasImage?: boolean;
  step?: number;
  stepCount?: number;
  progress?: number;
  /**
   * Worker's time-remaining estimate in seconds, sent alongside the step by
   * ComfyUI workers. `0` means the worker had no estimate for this step.
   */
  etaSeconds?: number;
  /** Lower bound of the worker's ETA confidence interval, in seconds. */
  etaMin?: number;
  /**
   * Upper bound of the worker's ETA confidence interval, in seconds. `0`
   * (with `etaMin: 0`) means the worker had no interval for this step.
   */
  etaMax?: number;
};

export type JobETAData = {
  jobID: string;
  imgID?: string;
  etaSeconds: number;
};

export type JobPreparation = {
  phase: 'downloadingAssets';
  assetType: 'lora';
  requested: number;
  cached: number;
  total: number;
  completed: number;
  current: number;
  currentProgress?: number;
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
      preparation?: JobPreparation;
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
      /**
       * Server-provided estimate of seconds until a worker starts the project.
       * `null` when no estimate is currently available.
       */
      estimatedStartSeconds?: number | null;
      /** Coarse state for the project's wait in the queue. */
      queueStatus?: 'waiting' | 'no-workers';
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
  error_message?: string;
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
  /** User-actionable subscription queue, concurrency, or fair-use notice. */
  subscriptionLimitNotice: SocketSubscriptionLimitNoticeData;
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

/**
 * Server status of a project as sogni-socket reports it in recovery payloads.
 * `authorized` and `queued` are the socket's own names; the REST API reports
 * `active` for the queued window.
 */
export type RecoveredProjectStatus =
  | 'pending'
  | 'authorized'
  | 'active'
  | 'queued'
  | 'assigned'
  | 'progress'
  | 'completed'
  | 'errored'
  | 'cancelled';

export type RecoveredWorkerJobStatus =
  | 'created'
  | 'queued'
  | 'assigned'
  | 'initiatingModel'
  | 'jobStarted'
  | 'jobProgress'
  | 'jobCompleted'
  | 'jobError';

/**
 * A worker job inside a {@link RecoveredProject}, as serialized by
 * sogni-socket (`serializeWorkerJob`).
 *
 * `imgID` is the stable per-job identity. `id` is rewritten to the project id
 * for legacy native clients and must not be used to distinguish jobs.
 */
export interface RecoveredWorkerJob {
  id: string;
  SID?: number | string;
  imgID: string;
  worker?: {
    id?: string;
    clientSID?: number;
    address?: string;
    addressSID?: number;
    SID?: number;
    username?: string;
    image?: string;
    nftTokenId?: string;
  };
  createTime?: number;
  startTime?: number | null;
  updateTime?: number;
  actualStartTime?: number | null;
  endTime?: number | null;
  status: RecoveredWorkerJobStatus;
  reason?: string;
  performedSteps?: number;
  triggeredNSFWFilter?: boolean;
  seedUsed?: number;
  costActual?: Record<string, unknown>;
  network?: string;
  txId?: string | null;
  jobType?: string;
  tokenType?: string;
  isTest?: boolean;
  /** Present for vendor (external API) jobs only; GPU jobs mint a signed URL from `(projectId, imgID)`. */
  resultUrl?: string;
  resultKey?: string;
  provider?: string;
  modelType?: 'video' | 'audio';
  videoFrames?: number;
  videoFps?: number;
  width?: number;
  height?: number;
  audioDuration?: number;
  [key: string]: unknown;
}

/**
 * A project the server can hand back to its owner after a refresh or
 * reconnect: carried by `authenticated.activeProjects` /
 * `authenticated.unclaimedCompletedProjects` and by
 * `GET /api/v1/artist/projects/sync` on the socket host.
 *
 * `clientRequestData` is the original `jobRequest`, base64-encoded JSON, so a
 * client that lost its local state can rebuild the prompt and parameters.
 */
export interface RecoveredProject {
  id: string;
  SID?: number;
  /** App instance (`appId`) that created the project. Newer socket builds only. */
  appId?: string;
  appSource?: string;
  jobType?: string;
  model: {
    id: string;
    SID?: number;
    name?: string;
    type?: string;
  };
  imageCount: number;
  stepCount: number;
  previewCount?: number;
  hasGuideImage?: boolean;
  denoiseStrength?: string;
  controlNetId?: string | null;
  costEstimate?: Record<string, unknown>;
  costActual?: Record<string, unknown>;
  createTime: number;
  updateTime: number;
  endTime?: number | null;
  status: RecoveredProjectStatus;
  reason?: string | null;
  network?: string;
  txId?: string | null;
  sizePreset?: string;
  width?: number;
  height?: number;
  jobCountCompletedByState?: Record<string, number>;
  isTest?: boolean;
  tokenType?: string;
  billingMode?: string;
  clientRequestData?: string;
  workerJobs?: RecoveredWorkerJob[];
  completedWorkerJobs?: RecoveredWorkerJob[];
  premium?: Record<string, unknown>;
  modelType?: 'video' | 'audio';
  videoFrames?: number;
  videoFps?: number;
  provider?: string;
  [key: string]: unknown;
}

/** Body of `GET /api/v1/artist/projects/sync`; the same two arrays the `authenticated` frame carries. */
export interface ProjectRecoverySnapshot {
  activeProjects: RecoveredProject[];
  unclaimedCompletedProjects: RecoveredProject[];
  serverTime?: number;
}
