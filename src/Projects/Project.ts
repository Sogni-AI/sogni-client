import Job, { JobData } from './Job.js';
import DataEntity, { EntityEvents } from '../lib/DataEntity.js';
import { isImageParams, ProjectParams } from './types/index.js';
import cloneDeep from 'lodash/cloneDeep.js';
import ErrorData from '../types/ErrorData.js';
import getUUID from '../lib/getUUID.js';
import { RawJob, RawProject } from './types/RawProject.js';
import ProjectsApi from './index.js';
import { Logger } from '../lib/DefaultLogger.js';

// If project is not finished and had no updates for 2 minutes, force refresh
const PROJECT_TIMEOUT = 2 * 60 * 1000;
const MAX_FAILED_SYNC_ATTEMPTS = 3;

/** Render a runtime budget for an error message ("90 minutes", "8 hours"). */
function formatRuntimeLimit(limitMs: number): string {
  const minutes = Math.round(limitMs / 60000);
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export type ProjectStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled';

const PROJECT_STATUS_MAP: Record<RawProject['status'], ProjectStatus> = {
  pending: 'pending',
  authorized: 'pending',
  active: 'queued',
  queued: 'queued',
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
  /**
   * Estimated completion time of the project (for long-running projects like video generation).
   * Is equal to maximum job ETA
   */
  eta?: Date;
  /**
   * Estimated time at which a worker will start this project, while it is still queued.
   * Cleared once the project starts processing. `undefined` when the server cannot
   * estimate — see {@link ProjectData.queueStatus}.
   */
  estimatedStartAt?: Date;
  /**
   * `'no-workers'` when nothing currently connected can run this project's model.
   */
  queueStatus?: 'waiting' | 'no-workers';
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
  /**
   * Reuse a server-known project id instead of minting a new one. Used when a
   * project is rebuilt from a recovery snapshot.
   * @internal
   */
  id?: string;
  /**
   * Mark the project as rebuilt from a server snapshot rather than created by
   * this client.
   * @internal
   */
  recovered?: boolean;
}

class Project extends DataEntity<ProjectData, ProjectEventMap> {
  private _jobs: Job[] = [];
  private _lastEmitedProgress = -1;
  private readonly _api: ProjectsApi;
  private readonly _logger: Logger;
  private readonly _recovered: boolean;
  private _timeout: NodeJS.Timeout | null = null;
  private _failedSyncAttempts = 0;

  constructor(data: ProjectParams, options: ProjectOptions) {
    super({
      id: options.id || getUUID(),
      startedAt: new Date(),
      params: data,
      queuePosition: -1,
      status: 'pending'
    });

    this._api = options.api;
    this._logger = options.logger;
    this._recovered = Boolean(options.recovered);

    this._timeout = setInterval(this._checkForTimeout.bind(this), PROJECT_TIMEOUT);

    this.on('updated', this.handleUpdated.bind(this));
  }

  get id() {
    return this.data.id;
  }

  /** When this client started (or, for a recovered project, first learned about) the project. */
  get startedAt() {
    return this.data.startedAt;
  }

  /**
   * `true` when this project was rebuilt from a server snapshot — after a page
   * refresh, a reconnect, or in a second tab — instead of being created by this
   * client. Its {@link params} are reconstructed from the original request and
   * omit asset inputs (starting images, reference media).
   */
  get recovered() {
    return this._recovered;
  }

  get params() {
    return this.data.params;
  }

  get type() {
    return this.params.type;
  }

  get status() {
    return this.data.status;
  }

  /**
   * Estimated time of completion in seconds (for long-running projects like video generation).
   * Updated by ComfyUI workers during inference.
   */
  get eta() {
    return this.data.eta;
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
    if (this.status === 'completed') return 100;
    // Worker can reduce the number of steps in the job, so we need to calculate the progress based on the actual number of steps
    const jobCount = Math.max(1, this.data.params.numberOfMedia);
    if (this._jobs.length) {
      const progressTotal = this._jobs.reduce((acc, job) => acc + job.progress, 0);
      return Math.max(0, Math.min(100, Math.round(progressTotal / jobCount)));
    }
    const stepsPerJob = this.data.params.steps ?? 0;
    if (stepsPerJob <= 0) return 0;
    const stepsDone = this._jobs.reduce((acc, job) => acc + job.step, 0);
    return Math.max(0, Math.min(100, Math.round((stepsDone / (stepsPerJob * jobCount)) * 100)));
  }

  get queuePosition() {
    return this.data.queuePosition;
  }

  /**
   * Time at which a worker is expected to start this project, while it is still queued.
   * Undefined once processing starts, or when the server cannot estimate a wait.
   *
   * Prefer this over {@link Project.queuePosition} when telling a user how long they have
   * to wait: position counts projects, not time, so being first in line behind a long
   * video render is still a long wait.
   */
  get estimatedStartAt() {
    return this.data.estimatedStartAt;
  }

  /**
   * `'no-workers'` when nothing currently connected can run this project's model, in which
   * case {@link Project.estimatedStartAt} is undefined and the project is waiting for a
   * worker to come online rather than for the queue to drain.
   */
  get queueStatus() {
    return this.data.queueStatus;
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
    if (this.status === 'failed' || this.status === 'canceled') {
      return Promise.reject(this.terminalError());
    }

    return new Promise((resolve, reject) => {
      const onCompleted = (images: string[]) => {
        this.off('completed', onCompleted);
        this.off('failed', onFailed);
        this.off('updated', onUpdated);
        resolve(images);
      };
      const onFailed = (error: ErrorData) => {
        this.off('completed', onCompleted);
        this.off('failed', onFailed);
        this.off('updated', onUpdated);
        reject(error);
      };
      const onUpdated = () => {
        if (this.status === 'canceled') onFailed(this.terminalError());
      };
      this.on('completed', onCompleted);
      this.on('failed', onFailed);
      this.on('updated', onUpdated);
    });
  }

  private terminalError(): ErrorData {
    return (
      this.error || {
        code: 0,
        message: this.status === 'canceled' ? 'Project canceled' : 'Project failed'
      }
    );
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
    if (this.finished) {
      if (this._timeout) {
        clearInterval(this._timeout);
        this._timeout = null;
      }
      this._jobs.forEach((job) => job._stopRuntimeTimeout());
    }
    if (keys.includes('status') || keys.includes('jobs')) {
      const allJobsStarted = this.jobs.length >= this.params.numberOfMedia;
      const allJobsDone = this.jobs.every((job) => job.finished);
      if (this.data.status === 'completed' && allJobsStarted && allJobsDone) {
        return this.emit('completed', this.resultUrls);
      }
      if (this.data.status === 'failed') {
        this.emit('failed', this.terminalError());
      }
    }
  }

  /**
   * Refresh the lastUpdated timestamp to prevent timeout.
   * Used when receiving socket events that indicate the project is still active
   * (e.g., jobETA events during long-running video generation).
   * @internal
   */
  _keepAlive() {
    this.lastUpdated = new Date();
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

  /**
   * Fail and cancel a project when one actual worker job exceeds its hard
   * runtime ceiling. Queue time is deliberately excluded: the Job timer starts
   * only after jobStarted changes that job to processing.
   * @internal
   */
  _handleJobRuntimeTimeout(job: Job, limitMs: number) {
    if (this.finished || job.finished || !this._jobs.includes(job)) return;

    const limit = formatRuntimeLimit(limitMs);
    const jobError: ErrorData = {
      code: 0,
      message: `Job exceeded the maximum runtime of ${limit}`
    };
    this._api._notifyProjectTimedOut(this.id).catch((cancelError) => {
      this._logger.error(`Failed to cancel project ${this.id} after job ${job.id} timed out`);
      this._logger.error(cancelError);
    });
    this._jobs.forEach((projectJob) => {
      if (!projectJob.finished) {
        projectJob._update({ status: 'failed', error: jobError });
      }
    });
    this._update({
      status: 'failed',
      error: {
        code: 0,
        message: `Job ${job.id} exceeded the maximum runtime of ${limit}; project canceled`
      }
    });
  }

  private _checkForTimeout() {
    if (this._api._shouldDeferProjectTimeouts?.()) {
      // The socket is down. Silence is expected, not staleness: the server
      // keeps rendering and hands the project back on reconnect.
      this._keepAlive();
      return;
    }
    if (this.lastUpdated.getTime() + PROJECT_TIMEOUT < Date.now()) {
      void this._runStalenessCheck();
    }
  }

  /**
   * Decide whether a silent project is still alive.
   *
   * Two sources answer different halves of the question. The socket holds every
   * in-flight project, including ones still queued with no worker assigned, so
   * it is the only place that can say "yes, still waiting". The REST API only
   * stores a project once it FINISHES, so it answers "it completed while you
   * weren't listening" — and returns 404 for the entire queued/rendering
   * window, which is why a bare 404 must never be read as "lost".
   *
   * - socket says alive -> waiting is normal, keep the project alive.
   * - socket says gone AND REST has no record -> genuinely lost, count a strike.
   * - liveness unknown (older socket, unauthenticated, transport error) -> fall
   *   back to the lenient rule: only non-404 REST failures count.
   */
  private async _runStalenessCheck() {
    const liveProjectIds = await this._api._listActiveProjectIds();
    if (liveProjectIds?.includes(this.id)) {
      // A queued project emits no events by design; this is not staleness.
      this._failedSyncAttempts = 0;
      this._keepAlive();
      return;
    }
    const socketConfirmsGone = liveProjectIds !== null;

    return this._syncToServer()
      .then(() => {
        this._failedSyncAttempts = 0;
      })
      .catch((error) => {
        // A 404 alone is ambiguous: it is the normal state for a queued project
        // as well as for a lost one. It only becomes evidence of loss when the
        // socket has also confirmed the project is no longer in flight.
        if (error.status === 404 && !socketConfirmsGone) {
          return;
        }
        if (error.status !== 404) {
          this._logger.error(error);
        }
        this._failedSyncAttempts++;
        if (this._failedSyncAttempts >= MAX_FAILED_SYNC_ATTEMPTS) {
          this._logger.error(
            `Failed to sync project data after ${MAX_FAILED_SYNC_ATTEMPTS} attempts. Stopping further attempts.`
          );
          this._api._notifyProjectTimedOut(this.id).catch((cancelError) => {
            this._logger.error(`Failed to notify socket server that project ${this.id} timed out`);
            this._logger.error(cancelError);
          });
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
        continue;
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
        numberOfMedia: data.imageCount,
        steps: data.stepCount
      }
    };
    if (delta.params && isImageParams(delta.params)) {
      delta.params.numberOfPreviews = data.previewCount;
    }
    if (PROJECT_STATUS_MAP[data.status]) {
      delta.status = PROJECT_STATUS_MAP[data.status];
    }
    if (delta.status === 'failed' || delta.status === 'canceled') {
      const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
      const reasonCode = /^\d+$/.test(reason) ? Number(reason) : 0;
      delta.error = this.error || {
        code: Number.isSafeInteger(reasonCode) ? reasonCode : 0,
        message: reason || (delta.status === 'canceled' ? 'Project canceled' : 'Project failed')
      };
      for (const job of this._jobs) {
        if (!job.finished) job._update({ status: delta.status, error: delta.error });
      }
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
