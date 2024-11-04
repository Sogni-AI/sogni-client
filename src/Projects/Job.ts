import DataEntity, { EntityEvents } from '../lib/DataEntity';
import ErrorData from '../types/ErrorData';

export type JobStatus = 'pending' | 'initiating' | 'processing' | 'completed' | 'failed';

export interface JobData {
  id: string;
  status: JobStatus;
  step: number;
  stepCount: number;
  previewUrl?: string;
  resultUrl?: string;
  error?: ErrorData;
}

interface JobEvents extends EntityEvents {
  progress: number;
  completed: string;
  failed: JobData['error'];
}

class Job extends DataEntity<JobData, JobEvents> {
  constructor(data: JobData) {
    super(data);
    this.on('updated', this.handleUpdated.bind(this));
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

  private handleUpdated(keys: string[]) {
    if (keys.includes('step') || keys.includes('stepCount')) {
      this.emit('progress', this.progress);
    }
    if (keys.includes('status') && this.status === 'completed') {
      this.emit('completed', this.resultUrl!);
    }
    if (keys.includes('status') && this.status === 'failed') {
      this.emit('failed', this.data.error);
    }
  }
}

export default Job;
