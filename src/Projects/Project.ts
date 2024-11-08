import Job, { JobData } from './Job';
import DataEntity, { EntityEvents } from '../lib/DataEntity';
import { ProjectParams } from './types';
import cloneDeep from 'lodash/cloneDeep';
import { v4 as uuidV4 } from '@lukeed/uuid';
import ErrorData from '../types/ErrorData';

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

  constructor(data: ProjectParams) {
    super({
      id: uuidV4(),
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

  get progress() {
    const { steps, stepCount } = this._jobs.reduce(
      (acc, job) => {
        acc.steps += job.step;
        acc.stepCount += job.stepCount;
        return acc;
      },
      { steps: 0, stepCount: 0 }
    );
    return Math.round((steps / stepCount) * 100);
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
      const allJobsDone = this.jobs.every(
        (job) => job.status === 'completed' || job.status === 'failed'
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
