import { AvailableModel } from './index.js';
import ErrorData from '../../types/ErrorData.js';
import type {
  JobPreparation,
  ProjectRecoverySnapshot,
  RecoveredProject
} from '../../ApiClient/WebSocketClient/events.js';

export type { JobPreparation } from '../../ApiClient/WebSocketClient/events.js';

export interface ProjectEventBase {
  projectId: string;
}

export interface ProjectQueued extends ProjectEventBase {
  type: 'queued';
  queuePosition: number;
  /**
   * Server-provided estimate of seconds until a worker starts the project, or `null`
   * when no estimate is currently available.
   */
  estimatedStartSeconds?: number | null;
  /**
   * `'no-workers'` when nothing currently connected can run this project's model, in which
   * case `estimatedStartSeconds` is `null` and the project waits for a worker to come online.
   */
  queueStatus?: 'waiting' | 'no-workers';
}

export interface ProjectCompleted extends ProjectEventBase {
  type: 'completed';
}

export interface ProjectError extends ProjectEventBase {
  type: 'error';
  error: ErrorData;
}

export type ProjectEvent = ProjectQueued | ProjectCompleted | ProjectError;

export interface JobEventBase {
  projectId: string;
  jobId: string;
}

export interface JobInitiating extends JobEventBase {
  type: 'initiating';
  workerName: string;
  positivePrompt?: string;
  negativePrompt?: string;
  jobIndex?: number;
  preparation?: JobPreparation;
}

export interface JobStarted extends JobEventBase {
  type: 'started';
  workerName: string;
  positivePrompt?: string;
  negativePrompt?: string;
  jobIndex?: number;
}

export interface JobProgress extends JobEventBase {
  type: 'progress';
  step?: number;
  stepCount?: number;
  progress?: number;
  /**
   * Worker's time-remaining estimate in seconds, when reported with the step.
   * `0` means the worker had no estimate for this step.
   */
  etaSeconds?: number;
  /** Lower bound of the worker's ETA confidence interval, in seconds. */
  etaMin?: number;
  /**
   * Upper bound of the worker's ETA confidence interval, in seconds. `0`
   * (with `etaMin: 0`) means the worker had no interval for this step.
   */
  etaMax?: number;
}

export interface JobETA extends JobEventBase {
  type: 'jobETA';
  etaSeconds: number;
}

export interface JobPreview extends JobEventBase {
  type: 'preview';
  url: string;
}

export interface JobCompleted extends JobEventBase {
  type: 'completed';
  steps?: number;
  seed?: number;
  /**
   * URL to the result image, could be null if the job was canceled or triggered NSFW filter while
   * it was not disabled by the user
   */
  resultUrl: string | null;
  isNSFW: boolean;
  userCanceled: boolean;
}

export interface JobError extends JobEventBase {
  type: 'error';
  error: ErrorData;
}

export type JobEvent =
  | JobInitiating
  | JobStarted
  | JobProgress
  | JobETA
  | JobPreview
  | JobCompleted
  | JobError;

/**
 * A project that finished while this app instance had no socket, with the
 * result URLs already resolved so a consumer can render it without any
 * further SDK state.
 */
export interface CompletedRecoveredProject extends RecoveredProject {
  /** Resolved download URLs for each completed, non-filtered job, in job order. */
  resultUrls: string[];
}

export type ProjectSyncReason = 'authenticated' | 'connected' | 'manual';

/**
 * Outcome of one reconciliation of local project state against the server
 * (see {@link ProjectsApi.sync}). Ids refer to projects this client tracks;
 * the `recovered*` arrays carry projects the server knew about that this
 * client did not.
 */
export interface ProjectSyncResult {
  reason: ProjectSyncReason;
  /** The raw server snapshot, for consumers that keep their own project store. */
  snapshot: ProjectRecoverySnapshot;
  /** Tracked projects the server confirmed are still in flight. */
  active: string[];
  /** Tracked projects confirmed finished (by the snapshot or the REST record) and updated in place. */
  completed: string[];
  /**
   * Tracked projects the server no longer knows and the REST API has no record
   * of. They were failed with an error for which `isProjectLostError()` is `true`.
   */
  lost: string[];
  /** Tracked projects whose state could not be verified (transport error); left untouched. */
  unverified: string[];
  /** Untracked in-flight projects, now tracked and rehydrated as `Project` instances. */
  recoveredActive: RecoveredProject[];
  /** Untracked projects that finished while away, with result URLs resolved. */
  recoveredCompleted: CompletedRecoveredProject[];
}

export interface ProjectApiEvents {
  availableModels: AvailableModel[];
  project: ProjectEvent;
  job: JobEvent;
  /**
   * Emitted after every reconciliation with the server: on each `authenticated`
   * handshake, when a shared-socket tab connects, and after a manual `sync()`.
   */
  projectsSynced: ProjectSyncResult;
  /**
   * In-flight projects the server handed back that this client was not tracking
   * (a page refresh, a second tab, cleared state). They are now tracked, so the
   * usual `project` / `job` events follow.
   */
  activeProjectsRecovered: RecoveredProject[];
  /** Projects that finished while this client was away and were not being tracked. */
  completedProjectsRecovered: CompletedRecoveredProject[];
}
