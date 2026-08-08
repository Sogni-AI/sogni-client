import { AvailableModel } from './index.js';
import ErrorData from '../../types/ErrorData.js';
import type { JobPreparation } from '../../ApiClient/WebSocketClient/events.js';

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

export interface ProjectApiEvents {
  availableModels: AvailableModel[];
  project: ProjectEvent;
  job: JobEvent;
}
