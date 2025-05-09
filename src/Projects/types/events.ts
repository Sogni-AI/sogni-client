import { AvailableModel } from './index';
import ErrorData from '../../types/ErrorData';

export interface ProjectEventBase {
  projectId: string;
}

export interface ProjectQueued extends ProjectEventBase {
  type: 'queued';
  queuePosition: number;
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
  step: number;
  stepCount: number;
}

export interface JobPreview extends JobEventBase {
  type: 'preview';
  url: string;
}

export interface JobCompleted extends JobEventBase {
  type: 'completed';
  steps: number;
  seed: number;
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
  | JobPreview
  | JobCompleted
  | JobError;

export interface ProjectApiEvents {
  availableModels: AvailableModel[];
  project: ProjectEvent;
  job: JobEvent;
}
