import { AvailableModel } from './index';

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
  error: { code: number; message: string };
}

export type ProjectEvent = ProjectQueued | ProjectCompleted | ProjectError;

export interface JobEventBase {
  projectId: string;
  jobId: string;
}

export interface JobInitiating extends JobEventBase {
  type: 'initiating';
}

export interface JobStarted extends JobEventBase {
  type: 'started';
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
  resultUrl: string;
}

export interface JobError extends JobEventBase {
  type: 'error';
  error: { code: number; message: string };
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
