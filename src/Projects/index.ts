import ApiGroup, { ApiConfig } from '../ApiGroup';
import {
  AvailableModel,
  EstimateRequest,
  ImageUrlParams,
  ProjectParams,
  SupportedModel
} from './types';
import {
  JobErrorData,
  JobProgressData,
  JobResultData,
  JobStateData,
  SocketEventMap
} from '../ApiClient/WebSocketClient/events';
import Project from './Project';
import createJobRequestMessage from './createJobRequestMessage';
import { ApiError, ApiReponse } from '../ApiClient';
import { EstimationResponse } from './types/EstimationResponse';
import { JobEvent, ProjectApiEvents, ProjectEvent } from './types/events';
import getUUID from '../lib/getUUID';
import { RawProject } from './types/RawProject';
import ErrorData from '../types/ErrorData';

const GARBAGE_COLLECT_TIMEOUT = 10000;
const MODELS_REFRESH_INTERVAL = 1000 * 60 * 60 * 24; // 24 hours

function mapErrorCodes(code: string): number {
  switch (code) {
    case 'serverRestarting':
      return 5001;
    case 'workerDisconnected':
      return 5002;
    case 'jobTimedOut':
      return 5003;
    case 'artistCanceled':
      return 5004;
    case 'workerCancelled':
      return 5005;
    default:
      return 5000;
  }
}

class ProjectsApi extends ApiGroup<ProjectApiEvents> {
  private _availableModels: AvailableModel[] = [];
  private projects: Project[] = [];
  private _supportedModels: { data: SupportedModel[] | null; updatedAt: Date } = {
    data: null,
    updatedAt: new Date(0)
  };

  get availableModels() {
    return this._availableModels;
  }

  constructor(config: ApiConfig) {
    super(config);
    // Listen to server events and emit them as project and job events
    this.client.socket.on('changeNetwork', this.handleChangeNetwork.bind(this));
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

  private handleChangeNetwork() {
    this._availableModels = [];
    this.emit('availableModels', this._availableModels);
  }

  private async handleSwarmModels(data: SocketEventMap['swarmModels']) {
    let models: SupportedModel[] = [];
    try {
      models = await this.getSupportedModels();
    } catch (e) {
      this.client.logger.error(e);
    }
    const modelIndex = models.reduce((acc: Record<string, SupportedModel>, model) => {
      acc[model.id] = model;
      return acc;
    }, {});
    this._availableModels = Object.entries(data).map(([id, workerCount]) => ({
      id,
      name: modelIndex[id]?.name || id.replace(/-/g, ' '),
      workerCount
    }));
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
        this.emit('job', {
          type: 'initiating',
          projectId: data.jobID,
          jobId: data.imgID,
          workerName: data.workerName
        });
        return;
      case 'jobStarted': {
        this.emit('job', {
          type: 'started',
          projectId: data.jobID,
          jobId: data.imgID,
          workerName: data.workerName
        });
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
    const project = this.projects.find((p) => p.id === data.jobID);
    const passNSFWCheck = !data.triggeredNSFWFilter || !project || project.params.disableNSFWFilter;
    let downloadUrl = null;
    // If NSFW filter is triggered, image will be only available for download if user explicitly
    // disabled the filter for this project
    if (passNSFWCheck && !data.userCanceled) {
      downloadUrl = await this.downloadUrl({
        jobId: data.jobID,
        imageId: data.imgID,
        type: 'complete'
      });
    }

    this.emit('job', {
      type: 'completed',
      projectId: data.jobID,
      jobId: data.imgID,
      steps: data.performedStepCount,
      seed: Number(data.lastSeed),
      resultUrl: downloadUrl,
      isNSFW: data.triggeredNSFWFilter,
      userCanceled: data.userCanceled
    });
  }

  private handleJobError(data: JobErrorData) {
    const errorCode = Number(data.error);
    let error: ErrorData;
    if (!isNaN(errorCode)) {
      error = {
        code: errorCode,
        message: data.error_message
      };
    } else {
      error = {
        code: mapErrorCodes(data.error as string),
        originalCode: data.error?.toString(),
        message: data.error_message
      };
    }
    if (!data.imgID) {
      this.emit('project', {
        type: 'error',
        projectId: data.jobID,
        error
      });
      return;
    }
    this.emit('job', {
      type: 'error',
      projectId: data.jobID,
      jobId: data.imgID,
      error: error
    });
  }

  private handleProjectEvent(event: ProjectEvent) {
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
    if (project.finished) {
      // Sync project data with the server and remove it from the list after some time
      project._syncToServer().catch((e) => {
        this.client.logger.error(e);
      });
      setTimeout(() => {
        this.projects = this.projects.filter((p) => p.id !== event.projectId);
      }, GARBAGE_COLLECT_TIMEOUT);
    }
  }

  private handleJobEvent(event: JobEvent) {
    let project = this.projects.find((p) => p.id === event.projectId);
    if (!project) {
      return;
    }
    let job = project.job(event.jobId);
    if (!job) {
      job = project._addJob({
        id: event.jobId,
        projectId: event.projectId,
        status: 'pending',
        step: 0,
        stepCount: project.params.steps
      });
    }
    switch (event.type) {
      case 'initiating':
        job._update({ status: 'initiating', workerName: event.workerName });
        break;
      case 'started':
        job._update({ status: 'processing', workerName: event.workerName });
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
      case 'completed': {
        job._update({
          status: event.userCanceled ? 'canceled' : 'completed',
          step: event.steps,
          seed: event.seed,
          resultUrl: event.resultUrl,
          isNSFW: event.isNSFW,
          userCanceled: event.userCanceled
        });
        break;
      }
      case 'error':
        job._update({ status: 'failed', error: event.error });
        break;
    }
  }

  private handleServerDisconnected() {
    this._availableModels = [];
    this.emit('availableModels', this._availableModels);
    this.projects.forEach((p) => {
      p._update({ status: 'failed', error: { code: 0, message: 'Server disconnected' } });
    });
  }

  /**
   * Wait for available models to be received from the network. Useful for scripts that need to
   * run after the models are loaded.
   * @param timeout - timeout in milliseconds until the promise is rejected
   */
  waitForModels(timeout = 10000): Promise<AvailableModel[]> {
    if (this._availableModels.length) {
      return Promise.resolve(this._availableModels);
    }
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Timeout waiting for models'));
      }, timeout);
      this.once('availableModels', (models) => {
        clearTimeout(timeoutId);
        if (models.length) {
          resolve(models);
        } else {
          reject(new Error('No models available'));
        }
      });
    });
  }

  /**
   * Send new project request to the network. Returns project instance which can be used to track
   * progress and get resulting images.
   * @param data
   */
  async create(data: ProjectParams): Promise<Project> {
    const project = new Project({ ...data }, { api: this, logger: this.client.logger });
    if (data.startingImage) {
      await this.uploadGuideImage(project.id, data.startingImage);
    }
    const request = createJobRequestMessage(project.id, data);
    await this.client.socket.send('jobRequest', request);
    this.projects.push(project);
    return project;
  }

  /**
   * Get project by id, this API returns project data from the server only if the project is
   * completed or failed. If the project is still processing, it will throw 404 error.
   * @internal
   * @param projectId
   */
  async get(projectId: string) {
    const { data } = await this.client.rest.get<ApiReponse<{ project: RawProject }>>(
      `/v1/projects/${projectId}`
    );
    return data.project;
  }

  private async uploadGuideImage(projectId: string, file: File | Buffer | Blob) {
    const imageId = getUUID();
    const presignedUrl = await this.uploadUrl({
      imageId: imageId,
      jobId: projectId,
      type: 'startingImage'
    });
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: file
    });
    if (!res.ok) {
      throw new ApiError(res.status, {
        status: 'error',
        errorCode: 0,
        message: 'Failed to upload guide image'
      });
    }
    return imageId;
  }

  /**
   * Estimate project cost
   */
  async estimateCost({
    network,
    model,
    imageCount,
    stepCount,
    previewCount,
    cnEnabled,
    startingImageStrength
  }: EstimateRequest) {
    const r = await this.client.socket.get<EstimationResponse>(
      `/api/v1/job/estimate/${network}/${model}/${imageCount}/${stepCount}/${previewCount}/${cnEnabled ? 1 : 0}/${startingImageStrength ? 1 - startingImageStrength : 0}`
    );
    return {
      token: r.quote.project.costInToken,
      usd: r.quote.project.costInUSD
    };
  }

  /**
   * Get upload URL for image
   * @internal
   * @param params
   */
  async uploadUrl(params: ImageUrlParams) {
    const r = await this.client.rest.get<ApiReponse<{ uploadUrl: string }>>(
      `/v1/image/uploadUrl`,
      params
    );
    return r.data.uploadUrl;
  }

  /**
   * Get download URL for image
   * @internal
   * @param params
   */
  async downloadUrl(params: ImageUrlParams) {
    const r = await this.client.rest.get<ApiReponse<{ downloadUrl: string }>>(
      `/v1/image/downloadUrl`,
      params
    );
    return r.data.downloadUrl;
  }

  async getSupportedModels(forceRefresh = false) {
    if (
      this._supportedModels.data &&
      !forceRefresh &&
      Date.now() - this._supportedModels.updatedAt.getTime() < MODELS_REFRESH_INTERVAL
    ) {
      return this._supportedModels.data;
    }
    const models = await this.client.socket.get<SupportedModel[]>(`/api/v1/models/list`);
    this._supportedModels = { data: models, updatedAt: new Date() };
    return models;
  }
}

export default ProjectsApi;
