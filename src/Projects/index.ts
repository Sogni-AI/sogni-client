import ApiGroup, { ApiConfig } from '../ApiGroup';
import models from './models.json';
import { AvailableModel, EstimateRequest, ImageUrlParams, ProjectParams } from './types';
import {
  JobErrorData,
  JobProgressData,
  JobResultData,
  JobStateData,
  SocketEventMap
} from '../ApiClient/WebSocketClient/events';
import Project from './Project';
import createJobRequestMessage from './createJobRequestMessage';
import { ApiReponse } from '../ApiClient/ApiClient';
import { EstimationResponse } from './types/EstimationResponse';
import { JobEvent, ProjectApiEvents, ProjectEvent } from './types/events';

const GARBAGE_COLLECT_TIMEOUT = 10000;

class ProjectsApi extends ApiGroup<ProjectApiEvents> {
  private _availableModels: AvailableModel[] = [];
  private projects: Project[] = [];

  get availableModels() {
    return this._availableModels;
  }

  constructor(config: ApiConfig) {
    super(config);
    // Listen to server events and emit them as project and job events
    this.client.socket.on('swarmModels', this.handleSwarmModels.bind(this));
    this.client.socket.on('jobState', this.handleJobState.bind(this));
    this.client.socket.on('jobProgress', this.handleJobProgress.bind(this));
    this.client.socket.on('jobError', this.handleJobError.bind(this));
    this.client.socket.on('jobResult', this.handleJobResult.bind(this));
    // Listen to server disconnect event
    this.client.on('disconnected', this.handleServerDisconnected.bind(this));
    // Listen to project and job events and update project and job instances
    this.on('project', this.handleProjectEvent.bind(this));
    this.on('job', this.handleJobEvent.bind(this));
  }

  private handleSwarmModels(data: SocketEventMap['swarmModels']) {
    this._availableModels = models.reduce((acc: AvailableModel[], model) => {
      if (data[model.modelId]) {
        acc.push({
          id: model.modelId,
          name: model.modelShortName,
          workerCount: data[model.modelId]
        });
      }
      return acc;
    }, []);
    this.emit('availableModels', this._availableModels);
  }

  private handleJobState(data: JobStateData) {
    switch (data.type) {
      case 'queued':
        this.emit('project', {
          type: 'queued',
          projectId: data.jobID,
          queuePosition: data.queuePosition
        });
        return;
      case 'jobCompleted':
        this.emit('project', { type: 'completed', projectId: data.jobID });
        return;
      case 'initiatingModel':
        this.emit('job', { type: 'initiating', projectId: data.jobID, jobId: data.imgID });
        return;
      case 'jobStarted': {
        this.emit('job', { type: 'started', projectId: data.jobID, jobId: data.imgID });
        return;
      }
    }
  }

  private async handleJobProgress(data: JobProgressData) {
    this.emit('job', {
      type: 'progress',
      projectId: data.jobID,
      jobId: data.imgID,
      step: data.step,
      stepCount: data.stepCount
    });

    if (data.hasImage) {
      this.downloadUrl({
        jobId: data.jobID,
        imageId: data.imgID,
        type: 'preview'
      }).then((url) => {
        this.emit('job', {
          type: 'preview',
          projectId: data.jobID,
          jobId: data.imgID,
          url
        });
      });
    }
  }

  private async handleJobResult(data: JobResultData) {
    const downloadUrl = await this.downloadUrl({
      jobId: data.jobID,
      imageId: data.imgID,
      type: 'complete'
    });

    this.emit('job', {
      type: 'completed',
      projectId: data.jobID,
      jobId: data.imgID,
      steps: data.performedStepCount,
      resultUrl: downloadUrl
    });
  }

  private handleJobError(data: JobErrorData) {
    if (!data.imgID) {
      this.emit('project', {
        type: 'error',
        projectId: data.jobID,
        error: {
          code: data.error,
          message: data.error_message
        }
      });
      return;
    }
    this.emit('job', {
      type: 'error',
      projectId: data.jobID,
      jobId: data.imgID,
      error: {
        code: data.error,
        message: data.error_message
      }
    });
  }

  handleProjectEvent(event: ProjectEvent) {
    let project = this.projects.find((p) => p.id === event.projectId);
    if (!project) {
      return;
    }
    switch (event.type) {
      case 'queued':
        project._update({
          status: 'queued',
          queuePosition: event.queuePosition
        });
        break;
      case 'completed':
        project._update({
          status: 'completed'
        });
        break;
      case 'error':
        project._update({
          status: 'failed',
          error: event.error
        });
    }
    if (project.status === 'completed' || project.status === 'failed') {
      setTimeout(() => {
        this.projects = this.projects.filter((p) => p.id !== event.projectId);
      }, GARBAGE_COLLECT_TIMEOUT);
    }
  }

  handleJobEvent(event: JobEvent) {
    let project = this.projects.find((p) => p.id === event.projectId);
    if (!project) {
      return;
    }
    let job = project.job(event.jobId);
    if (!job) {
      job = project._addJob({
        id: event.jobId,
        status: 'pending',
        step: 0,
        stepCount: project.params.steps
      });
    }
    switch (event.type) {
      case 'initiating':
        job._update({ status: 'initiating' });
        break;
      case 'started':
        job._update({ status: 'processing' });
        break;
      case 'progress':
        job._update({
          status: 'processing',
          step: event.step,
          stepCount: event.stepCount
        });
        if (project.status !== 'processing') {
          project._update({ status: 'processing' });
        }
        break;
      case 'preview':
        job._update({ previewUrl: event.url });
        break;
      case 'completed':
        job._update({ status: 'completed', step: event.steps, resultUrl: event.resultUrl });
        break;
      case 'error':
        job._update({ status: 'failed', error: event.error });
        break;
    }
  }

  private handleServerDisconnected() {
    this._availableModels = [];
    this.emit('availableModels', this._availableModels);
  }

  /**
   * Send new project request to the network. Returns project instance which can be used to track
   * progress and get resulting images.
   * @param data
   */
  async create(data: ProjectParams): Promise<Project> {
    const project = new Project({ ...data });
    const request = createJobRequestMessage(project.id, data);
    await this.client.socket.send('jobRequest', request);
    this.projects.push(project);
    return project;
  }

  /**
   * Estimate project cost
   * @param network - either 'fast' or 'relaxed' network
   * @param model - model id
   * @param imageCount - number of images to generate
   * @param stepCount - number of steps
   * @param previewCount - number of preview images to request
   * @param cnEnabled - control network enabled
   * @param denoiseStrength - denoise strength
   */
  async estimateCost({
    network,
    model,
    imageCount,
    stepCount,
    previewCount,
    cnEnabled,
    denoiseStrength
  }: EstimateRequest) {
    const r = await this.client.socket.get<EstimationResponse>(
      `/api/v1/job/estimate/${network}/${model}/${imageCount}/${stepCount}/${previewCount}/${cnEnabled ? 1 : 0}/${denoiseStrength || 0}`
    );
    return {
      token: r.quote.project.costInToken,
      usd: r.quote.project.costInUSD
    };
  }

  async uploadUrl(params: ImageUrlParams) {
    const r = await this.client.rest.get<ApiReponse<{ uploadUrl: string }>>(
      `/v1/image/uploadUrl`,
      params
    );
    return r.data.uploadUrl;
  }

  async downloadUrl(params: ImageUrlParams) {
    const r = await this.client.rest.get<ApiReponse<{ downloadUrl: string }>>(
      `/v1/image/downloadUrl`,
      params
    );
    return r.data.downloadUrl;
  }
}

export default ProjectsApi;
