import ApiGroup, { ApiConfig } from '../ApiGroup';
import {
  AvailableModel,
  EnhancementStrength,
  EstimateRequest,
  ImageUrlParams,
  ProjectParams,
  SizePreset,
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
import { ApiError, ApiResponse } from '../ApiClient';
import { EstimationResponse } from './types/EstimationResponse';
import { JobEvent, ProjectApiEvents, ProjectEvent } from './types/events';
import getUUID from '../lib/getUUID';
import { RawProject } from './types/RawProject';
import ErrorData from '../types/ErrorData';
import { SupernetType } from '../ApiClient/WebSocketClient/types';
import Cache from '../lib/Cache';
import { enhancementDefaults } from './Job';
import { getEnhacementStrength } from './utils';
import { TokenType } from '../types/token';

const sizePresetCache = new Cache<SizePreset[]>(10 * 60 * 1000);
const GARBAGE_COLLECT_TIMEOUT = 30000;
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
    // Listen to the server disconnect event
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
          workerName: data.workerName,
          positivePrompt: data.positivePrompt,
          negativePrompt: data.negativePrompt,
          jobIndex: data.jobIndex
        });
        return;
      case 'jobStarted': {
        this.emit('job', {
          type: 'started',
          projectId: data.jobID,
          jobId: data.imgID,
          workerName: data.workerName,
          positivePrompt: data.positivePrompt,
          negativePrompt: data.negativePrompt,
          jobIndex: data.jobIndex
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
        this.projects = this.projects.filter((p) => !p.finished);
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
        // positivePrompt and negativePrompt are only received if a Dynamic Prompt was used for the project creating a different prompt for each job
        job._update({
          status: 'initiating',
          workerName: event.workerName,
          positivePrompt: event.positivePrompt,
          negativePrompt: event.negativePrompt,
          jobIndex: event.jobIndex
        });
        break;
      case 'started':
        // positivePrompt and negativePrompt are only received if a Dynamic Prompt was used for the project creating a different prompt for each job
        job._update({
          status: 'processing',
          workerName: event.workerName,
          positivePrompt: event.positivePrompt,
          negativePrompt: event.negativePrompt,
          jobIndex: event.jobIndex
        });
        break;
      case 'progress':
        job._update({
          status: 'processing',
          // Jus in case event comes out of order
          step: Math.max(event.step, job.step),
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
    if (data.startingImage && data.startingImage !== true) {
      await this.uploadGuideImage(project.id, data.startingImage);
    }
    if (data.controlNet?.image && data.controlNet.image !== true) {
      await this.uploadCNImage(project.id, data.controlNet.image);
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
    const { data } = await this.client.rest.get<ApiResponse<{ project: RawProject }>>(
      `/v1/projects/${projectId}`
    );
    return data.project;
  }

  /**
   * Cancel project by id. This will cancel all jobs in the project and mark project as canceled.
   * Client may still receive job events for the canceled jobs as it takes some time, but they will
   * be ignored
   * @param projectId
   **/
  async cancel(projectId: string) {
    await this.client.socket.send('jobError', {
      jobID: projectId,
      error: 'artistCanceled',
      error_message: 'artistCanceled',
      isFromWorker: false
    });
    const project = this.projects.find((p) => p.id === projectId);
    if (!project) {
      return;
    }
    // Remove project from the list to stop tracking it
    this.projects = this.projects.filter((p) => p.id !== projectId);

    // Cancel all jobs in the project
    project.jobs.forEach((job) => {
      if (!job.finished) {
        job._update({ status: 'canceled' });
      }
    });
    // If project is still in processing, mark it as canceled
    if (!project.finished) {
      project._update({ status: 'canceled' });
    }
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

  private async uploadCNImage(projectId: string, file: File | Buffer | Blob) {
    const imageId = getUUID();
    const presignedUrl = await this.uploadUrl({
      imageId: imageId,
      jobId: projectId,
      type: 'cnImage'
    });
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: file
    });
    if (!res.ok) {
      throw new ApiError(res.status, {
        status: 'error',
        errorCode: 0,
        message: 'Failed to upload ControlNet image'
      });
    }
    return imageId;
  }

  /**
   * Estimate project cost
   */
  async estimateCost({
    network,
    tokenType,
    model,
    imageCount,
    stepCount,
    previewCount,
    cnEnabled,
    startingImageStrength,
    width,
    height,
    sizePreset
  }: EstimateRequest) {
    const pathParams = [
      tokenType || 'sogni',
      network,
      model,
      imageCount,
      stepCount,
      previewCount,
      cnEnabled ? 1 : 0,
      startingImageStrength ? 1 - startingImageStrength : 0
    ];
    if (sizePreset) {
      const presets = await this.getSizePresets(network, model);
      const preset = presets.find((p) => p.id === sizePreset);
      if (!preset) {
        throw new Error('Invalid size preset');
      }
      pathParams.push(preset.width, preset.height);
    } else if (width && height) {
      pathParams.push(width, height);
    }
    const r = await this.client.socket.get<EstimationResponse>(
      `/api/v2/job/estimate/${pathParams.join('/')}`
    );
    return {
      token: r.quote.project.costInToken,
      usd: r.quote.project.costInUSD
    };
  }

  async estimateEnhancementCost(strength: EnhancementStrength, tokenType: TokenType = 'sogni') {
    return this.estimateCost({
      network: enhancementDefaults.network,
      tokenType,
      model: enhancementDefaults.modelId,
      imageCount: 1,
      stepCount: enhancementDefaults.steps,
      previewCount: 0,
      cnEnabled: false,
      startingImageStrength: getEnhacementStrength(strength)
    });
  }

  /**
   * Get upload URL for image
   * @internal
   * @param params
   */
  async uploadUrl(params: ImageUrlParams) {
    const r = await this.client.rest.get<ApiResponse<{ uploadUrl: string }>>(
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
    const r = await this.client.rest.get<ApiResponse<{ downloadUrl: string }>>(
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

  /**
   * Get supported size presets for the model and network. Size presets are cached for 10 minutes.
   *
   * @example
   * ```ts
   * const presets = await client.projects.getSizePresets('fast', 'flux1-schnell-fp8');
   * console.log(presets);
   * ```
   *
   * @param network - 'fast' or 'relaxed'
   * @param modelId - model id (e.g. 'flux1-schnell-fp8')
   * @param forceRefresh - force refresh cache
   * @returns {Promise<{
   *   label: string;
   *   id: string;
   *   width: number;
   *   height: number;
   *   ratio: string;
   *   aspect: string;
   * }[]>}
   */
  async getSizePresets(network: SupernetType, modelId: string, forceRefresh = false) {
    const key = `${network}-${modelId}`;
    const cached = sizePresetCache.read(key);
    if (cached && !forceRefresh) {
      return cached;
    }
    const data = await this.client.socket.get<SizePreset[]>(
      `/api/v1/size-presets/network/${network}/model/${modelId}`
    );
    sizePresetCache.write(key, data);
    return data;
  }

  /**
   * Get available models and their worker counts. Normally, you would get list once you connect
   * to the server, but you can also call this method to get the list of available models manually.
   * @param network
   */
  async getAvailableModels(network: SupernetType): Promise<AvailableModel[]> {
    const workersByModelSid = await this.client.socket.get<Record<string, number>>(
      `/api/v1/status/network/${network}/models`
    );
    const supportedModels = await this.getSupportedModels();
    return Object.entries(workersByModelSid).map(([sid, workerCount]) => {
      const SID = Number(sid);
      const model = supportedModels.find((m) => m.SID === SID);
      return {
        id: model?.id || sid,
        name: model?.name || sid.replace(/-/g, ' '),
        workerCount
      };
    });
  }
}

export default ProjectsApi;
