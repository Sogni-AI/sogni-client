import Job, { JobData } from './Job';
import Entity from '../lib/Entity';
import { ProjectParams } from './types';
import cloneDeep from 'lodash/cloneDeep';
import { v4 as uuidV4 } from '@lukeed/uuid';

export type ProjectStatus =
  | 'creating'
  | 'initiating'
  | 'started'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

interface ProjectData {
  id: string;
  params: ProjectParams;
  queuePosition: number;
  status: ProjectStatus;
  error?: {
    message: string;
    code: number;
  };
}

interface SerializedProject extends ProjectData {
  jobs: JobData[];
}

class Project extends Entity<ProjectData> {
  private _jobs: Job[] = [];

  constructor(data: ProjectParams) {
    super({
      id: uuidV4(),
      params: data,
      queuePosition: -1,
      status: 'creating'
    });
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
    return steps / stepCount;
  }

  get queuePosition() {
    return this.data.queuePosition;
  }

  get jobs() {
    return this._jobs.slice(0);
  }

  /**
   * Find a job by id
   * @param id
   */
  job(id: string) {
    return this._jobs.find((job) => job.id === id);
  }

  /**
   * This is internal method to add a job to the project. Do not call this directly.
   * @param data
   */
  _addJob(data: JobData) {
    const job = new Job(data);
    this._jobs.push(job);
    job.on('updated', () => {
      this.emit('updated', this);
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
