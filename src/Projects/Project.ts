import Job, { JobData } from './Job';
import DataEntity, { EntityEvents } from '../lib/DataEntity';
import { ProjectParams } from './types';
import cloneDeep from 'lodash/cloneDeep';
import ErrorData from '../types/ErrorData';
import getUUID from '../lib/getUUID';

export type ProjectStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

interface ProjectData {
  id: string;
  startedAt: Date;
  params: ProjectParams;
  queuePosition: number;
  status: ProjectStatus;
  error?: ErrorData;
}

interface SerializedProject extends ProjectData {
  jobs: JobData[];
}

interface ProjectEvents extends EntityEvents {
  progress: number;
  completed: string[];
  failed: ProjectData['error'];
}

class Project extends DataEntity<ProjectData, ProjectEvents> {
  private _jobs: Job[] = [];
  private _lastEmitedProgress = -1;
  private _completionPromise: Promise<string[]>;

  constructor(data: ProjectParams) {
    super({
      id: getUUID(),
      startedAt: new Date(),
      params: data,
      queuePosition: -1,
      status: 'pending'
    });
    this._completionPromise = new Promise((resolve, reject) => {
      this.on('completed', (images) => {
        resolve(images);
      });
      this.on('failed', (error) => {
        reject(error);
      });
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

  get jobs() {
    return this._jobs.slice(0);
  }

  get resultUrls() {
    return this.jobs.map((job) => job.resultUrl).filter((r) => !!r) as string[];
  }

  /**
   * Wait for the project to complete, then return the result URLs, or throw an error if the project fails.
   * @returns Promise<string[]>
   * @throws ErrorData
   */
  waitForCompletion() {
    return this._completionPromise;
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
    return job;
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
