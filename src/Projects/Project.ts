import Job, { JobData, JobStatus } from './Job';
import DataEntity, { EntityEvents } from '../lib/DataEntity';
import { ProjectParams } from './types';
import cloneDeep from 'lodash/cloneDeep';
import ErrorData from '../types/ErrorData';
import getUUID from '../lib/getUUID';

export type ProjectStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

/**
 * @inline
 */
export interface ProjectData {
  id: string;
  startedAt: Date;
  params: ProjectParams;
  queuePosition: number;
  status: ProjectStatus;
  error?: ErrorData;
}
/** @inline */
export interface SerializedProject extends ProjectData {
  jobs: JobData[];
}

export interface ProjectEventMap extends EntityEvents {
  progress: number;
  completed: string[];
  failed: ErrorData;
  jobCompleted: Job;
  jobFailed: Job;
}

class Project extends DataEntity<ProjectData, ProjectEventMap> {
  private _jobs: Job[] = [];
  private _lastEmitedProgress = -1;

  constructor(data: ProjectParams) {
    super({
      id: getUUID(),
      startedAt: new Date(),
      params: data,
      queuePosition: -1,
      status: 'pending'
    });

    this.on('updated', this.handleUpdated.bind(this));
  }

  get id() {
    return this.data.id;
  }

  get params() {
    return this.data.params;
  }

  get status() {
    return this.data.status;
  }

  get error() {
    return this.data.error;
  }

  /**
   * Progress of the project in percentage (0-100).
   */
  get progress() {
    // Worker can reduce the number of steps in the job, so we need to calculate the progress based on the actual number of steps
    const stepsPerJob = this.jobs.length ? this.jobs[0].stepCount : this.data.params.steps;
    const jobCount = this.data.params.numberOfImages;
    const stepsDone = this._jobs.reduce((acc, job) => acc + job.step, 0);
    return Math.round((stepsDone / (stepsPerJob * jobCount)) * 100);
  }

  get queuePosition() {
    return this.data.queuePosition;
  }

  /**
   * List of jobs in the project. Note that jobs will be added to this list as
   * workers start processing them. So initially this list will be empty.
   * Subscribe to project `updated` event to get notified about any update, including new jobs.
   * @example
   * project.on('updated', (keys) => {
   *  if (keys.includes('jobs')) {
   *    // Project jobs have been updated
   *  }
   * });
   */
  get jobs() {
    return this._jobs.slice(0);
  }

  /**
   * List of result URLs for all completed jobs in the project.
   */
  get resultUrls() {
    return this.jobs.map((job) => job.resultUrl).filter((r) => !!r) as string[];
  }

  /**
   * Wait for the project to complete, then return the result URLs, or throw an error if the project fails.
   * @returns Promise<string[]> - Promise that resolves to the list of result URLs
   * @throws ErrorData
   */
  waitForCompletion(): Promise<string[]> {
    if (this.status === 'completed') {
      return Promise.resolve(this.resultUrls);
    }
    if (this.status === 'failed') {
      return Promise.reject(this.error);
    }

    return new Promise((resolve, reject) => {
      this.on('completed', (images) => {
        resolve(images);
      });
      this.on('failed', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Find a job by id
   * @param id
   */
  job(id: string) {
    return this._jobs.find((job) => job.id === id);
  }

  private handleUpdated(keys: string[]) {
    const progress = this.progress;
    if (progress !== this._lastEmitedProgress) {
      this.emit('progress', progress);
      this._lastEmitedProgress = progress;
    }
    if (keys.includes('status') || keys.includes('jobs')) {
      const allJobsDone = this.jobs.every((job) =>
        ['completed', 'failed', 'canceled'].includes(job.status)
      );
      if (this.data.status === 'completed' && allJobsDone) {
        return this.emit('completed', this.resultUrls);
      }
      if (this.data.status === 'failed') {
        this.emit('failed', this.data.error!);
      }
    }
  }

  /**
   * This is internal method to add a job to the project. Do not call this directly.
   * @internal
   * @param data
   */
  _addJob(data: JobData) {
    const job = new Job(data);
    this._jobs.push(job);
    job.on('updated', () => {
      this.emit('updated', ['jobs']);
    });
    job.on('completed', () => {
      this.emit('jobCompleted', job);
      this._handleJobFinished(job);
    });
    job.on('failed', () => {
      this.emit('jobFailed', job);
      this._handleJobFinished(job);
    });
    return job;
  }

  private _handleJobFinished(job: Job) {
    const finalStatus: JobStatus[] = ['completed', 'failed', 'canceled'];
    const allJobsDone = this.jobs.every((job) => finalStatus.includes(job.status));
    // If all jobs are done and project is not already failed or completed, update the project status
    if (allJobsDone && this.status !== 'failed' && this.status !== 'completed') {
      const allJobsFailed = this.jobs.every((job) => job.status === 'failed');
      if (allJobsFailed) {
        this._update({ status: 'failed' });
      } else {
        this._update({ status: 'completed' });
      }
    }
  }

  /**
   * Get full project data snapshot. Can be used to serialize the project and store it in a database.
   */
  toJSON(): SerializedProject {
    const data = cloneDeep(this.data);
    return {
      ...data,
      jobs: this._jobs.map((job) => job.toJSON())
    };
  }
}

export default Project;
