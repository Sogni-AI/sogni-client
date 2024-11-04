import Entity from '../lib/Entity';

export type JobStatus = 'creating' | 'initiating' | 'started' | 'queued' | 'completed' | 'failed';

export interface JobData {
  id: string;
  status: JobStatus;
  step: number;
  stepCount: number;
  previewUrl?: string;
  resultUrl?: string;
  error?: {
    message: string;
    code: number;
  };
}

class Job extends Entity<JobData> {
  constructor(data: JobData) {
    super(data);
  }

  get id() {
    return this.data.id;
  }

  get status() {
    return this.data.status;
  }

  get progress() {
    return this.data.step / this.data.stepCount;
  }

  get step() {
    return this.data.step;
  }

  get stepCount() {
    return this.data.stepCount;
  }

  get previewUrl() {
    return this.data.previewUrl;
  }

  get resultUrl() {
    return this.data.resultUrl;
  }

  get imageUrl() {
    return this.data.resultUrl || this.data.previewUrl;
  }

  get error() {
    return this.data.error;
  }
}

export default Job;
