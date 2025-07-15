import Job, { JobData } from './Job';
import DataEntity, { EntityEvents } from '../lib/DataEntity';
import { ProjectParams } from './types';
import cloneDeep from 'lodash/cloneDeep';
import ErrorData from '../types/ErrorData';
import getUUID from '../lib/getUUID';
import { RawJob, RawProject } from './types/RawProject';
import ProjectsApi from './index';
import { Logger } from '../lib/DefaultLogger';

// If project is not finished and had no updates for 1 minute, force refresh
const PROJECT_TIMEOUT = 60 * 1000;
const MAX_FAILED_SYNC_ATTEMPTS = 3;

export type ProjectStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled';

const PROJECT_STATUS_MAP: Record<RawProject['status'], ProjectStatus> = {
  pending: 'pending',
  active: 'queued',
  assigned: 'processing',
  progress: 'processing',
  completed: 'completed',
  errored: 'failed',
  cancelled: 'canceled'
};

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
  jobStarted: Job;
  jobCompleted: Job;
  jobFailed: Job;
}

export interface ProjectOptions {
  api: ProjectsApi;
  logger: Logger;
}

class Project extends DataEntity<ProjectData, ProjectEventMap> {
  private _jobs: Job[] = [];
  private _lastEmitedProgress = -1;
  private readonly _api: ProjectsApi;
  private readonly _logger: Logger;
  private _timeout: NodeJS.Timeout | null = null;
  private _failedSyncAttempts = 0;

  constructor(data: ProjectParams, options: ProjectOptions) {
    super({
      id: getUUID(),
      startedAt: new Date(),
      params: data,
      queuePosition: -1,
      status: 'pending'
    });

    this._api = options.api;
    this._logger = options.logger;

    this._timeout = setInterval(this._checkForTimeout.bind(this), PROJECT_TIMEOUT);

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

  get finished() {
    return ['completed', 'failed', 'canceled'].includes(this.status);
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
   * Cancel the project. This will cancel all jobs in the project.
   */
  async cancel() {
    await this._api.cancel(this.id);
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
    // If project is finished stop watching for timeout
    if (this._timeout && this.finished) {
      clearInterval(this._timeout!);
      this._timeout = null;
    }
    if (keys.includes('status') || keys.includes('jobs')) {
      const allJobsStarted = this.jobs.length >= this.params.numberOfImages;
      const allJobsDone = this.jobs.every((job) => job.finished);
      if (this.data.status === 'completed' && allJobsStarted && allJobsDone) {
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
  _addJob(data: JobData | Job) {
    const job =
      data instanceof Job
        ? data
        : new Job(data, { api: this._api, logger: this._logger, project: this });
    this._jobs.push(job);
    job.on('updated', () => {
      this.lastUpdated = new Date();
      this.emit('updated', ['jobs']);
    });
    this.emit('jobStarted', job);
    job.on('completed', () => {
      this.emit('jobCompleted', job);
    });
    job.on('failed', () => {
      this.emit('jobFailed', job);
    });
    return job;
  }

  private _checkForTimeout() {
    if (this.lastUpdated.getTime() + PROJECT_TIMEOUT < Date.now()) {
      this._syncToServer().catch((error) => {
        this._logger.error(error);
        this._failedSyncAttempts++;
        if (this._failedSyncAttempts >= MAX_FAILED_SYNC_ATTEMPTS) {
          this._logger.error(
            `Failed to sync project data after ${MAX_FAILED_SYNC_ATTEMPTS} attempts. Stopping further attempts.`
          );
          clearInterval(this._timeout!);
          this._timeout = null;
          this.jobs.forEach((job) => {
            if (!job.finished) {
              job._update({
                status: 'failed',
                error: { code: 0, message: 'Job timed out' }
              });
            }
          });
          this._update({
            status: 'failed',
            error: { code: 0, message: 'Project timed out. Please try again or contact support.' }
          });
        }
      });
    }
  }

  /**
   * Sync project data with the data received from the REST API.
   * @internal
   */
  async _syncToServer() {
    const data = await this._api.get(this.id);
    const jobData = data.completedWorkerJobs.reduce((acc: Record<string, RawJob>, job) => {
      const jobId = job.imgID || getUUID();
      acc[jobId] = job;
      return acc;
    }, {});
    for (const job of this._jobs) {
      const restJob = jobData[job.id];
      // This should never happen, but just in case we log a warning
      if (!restJob) {
        this._logger.warn(`Job with id ${job.id} not found in the REST project data`);
        return;
      }
      try {
        await job._syncWithRestData(restJob);
      } catch (error) {
        this._logger.error(error);
        this._logger.error(`Failed to sync job ${job.id}`);
      }
      delete jobData[job.id];
    }

    // If there are any jobs left in jobData, it means they are new jobs that are not in the project yet
    if (Object.keys(jobData).length) {
      for (const job of Object.values(jobData)) {
        const jobInstance = Job.fromRaw(data, job, {
          api: this._api,
          logger: this._logger,
          project: this
        });
        this._addJob(jobInstance);
      }
    }

    const delta: Partial<ProjectData> = {
      params: {
        ...this.data.params,
        numberOfImages: data.imageCount,
        steps: data.stepCount,
        numberOfPreviews: data.previewCount
      }
    };
    if (PROJECT_STATUS_MAP[data.status]) {
      delta.status = PROJECT_STATUS_MAP[data.status];
    }
    this._update(delta);
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
