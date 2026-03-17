import ApiGroup, { ApiConfig } from '../ApiGroup';
import {
  AvailableModel,
  EnhancementStrength,
  EstimateRequest,
  ImageUrlParams,
  MediaUrlParams,
  CostEstimation,
  ProjectParams,
  SizePreset,
  SupportedModel,
  ImageProjectParams,
  VideoProjectParams,
  VideoEstimateRequest,
  AudioEstimateRequest
} from './types';
import {
  JobErrorData,
  JobETAData,
  JobProgressData,
  JobResultData,
  JobStateData,
  SocketEventMap,
  AuthenticatedData,
  RecoveredProject,
  RecoveredWorkerJob,
} from '../ApiClient/WebSocketClient/events';
import { CompletedRecoveredProject } from './types/events';
import Project, { ProjectStatus } from './Project';
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
import {
  calculateVideoFrames,
  getEnhacementStrength,
  getVideoWorkflowType,
  isAudioModel,
  isVideoModel,
  VIDEO_WORKFLOW_ASSETS
} from './utils';
import { TokenType } from '../types/token';
import { getMaxContextImages, validateSampler } from '../lib/validation';
import ModelTiersRaw, {
  isAudioTier,
  isComfyImageTier,
  isImageTier,
  isVideoTier
} from './types/ModelTiersRaw';
import {
  mapAudioTier,
  mapComfyImageTier,
  mapImageTier,
  mapVideoTier,
  ModelOptions
} from './types/ModelOptions';

const sizePresetCache = new Cache<SizePreset[]>(10 * 60 * 1000);
const GARBAGE_COLLECT_TIMEOUT = 30000;
const MODELS_REFRESH_INTERVAL = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Detect content type from a file object.
 * For File objects in browser, uses the type property.
 * Returns undefined if content type cannot be detected.
 */
function getFileContentType(file: File | Buffer | Blob): string | undefined {
  if (file instanceof Blob && 'type' in file && file.type) {
    return file.type;
  }
  return undefined;
}

/**
 * Convert file to a format compatible with fetch body.
 * Converts Node.js Buffer to Blob for cross-platform compatibility.
 */
function toFetchBody(file: File | Buffer | Blob): BodyInit {
  // Node.js Buffer is not supported in browsers, so we can skip this conversion
  if (typeof Buffer === 'undefined') {
    return file as BodyInit;
  }
  if (Buffer.isBuffer(file)) {
    // Copy Buffer data to a new ArrayBuffer to ensure type compatibility
    const arrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    return new Blob([arrayBuffer as ArrayBuffer]);
  }
  return file as BodyInit;
}

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

/**
 * Get the MIME content type for image downloads based on the project's output format.
 */
function getImageContentType(project: Project): string | undefined {
  const format = (project.params as any).outputFormat;
  switch (format) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'png':
      return 'image/png';
    default:
      return undefined; // Let the API default to PNG
  }
}

/**
 * Get the MIME content type for audio downloads based on the project's output format.
 */
function getAudioContentType(project: Project): string {
  const format = (project.params as any).outputFormat;
  switch (format) {
    case 'flac':
      return 'audio/flac';
    case 'wav':
      return 'audio/wav';
    default:
      return 'audio/mpeg';
  }
}

class ProjectsApi extends ApiGroup<ProjectApiEvents> {
  private _availableModels: AvailableModel[] = [];
  private projects: Project[] = [];
  private _supportedModels: { data: SupportedModel[] | null; updatedAt: Date } = {
    data: null,
    updatedAt: new Date(0)
  };
  private _modelTiers: {
    data: ModelTiersRaw;
    updatedAt: Date;
  } = {
    data: {},
    updatedAt: new Date(0)
  };

  get availableModels() {
    return this._availableModels;
  }

  /**
   * Check if a model produces video output using the cached models list.
   * Uses the `media` property from the models API when available,
   * falls back to model ID prefix check if models aren't loaded yet.
   */
  isVideoModelId(modelId: string): boolean {
    const model = this._supportedModels.data?.find((m) => m.id === modelId);
    if (model) {
      return model.media === 'video';
    }
    // Fallback to prefix check if models not loaded
    return isVideoModel(modelId);
  }

  /**
   * Check if a model produces audio output using the cached models list.
   * Uses the `media` property from the models API when available,
   * falls back to model ID prefix check if models aren't loaded yet.
   */
  isAudioModelId(modelId: string): boolean {
    const model = this._supportedModels.data?.find((m) => m.id === modelId);
    if (model) {
      return model.media === 'audio';
    }
    return isAudioModel(modelId);
  }

  constructor(config: ApiConfig) {
    super(config);
    // Listen to server events and emit them as project and job events
    this.client.socket.on('changeNetwork', this.handleChangeNetwork.bind(this));
    this.client.socket.on('swarmModels', this.handleSwarmModels.bind(this));
    this.client.socket.on('jobState', this.handleJobState.bind(this));
    this.client.socket.on('jobProgress', this.handleJobProgress.bind(this));
    this.client.socket.on('jobETA', this.handleJobETA.bind(this));
    this.client.socket.on('jobError', this.handleJobError.bind(this));
    this.client.socket.on('jobResult', (data: any) => {
      this.handleJobResult(data).catch((err) => {
        this.client.logger.error('Error in handleJobResult:', err);
      });
    });
    // Listen to the server disconnect event
    this.client.on('disconnected', this.handleServerDisconnected.bind(this));
    // Listen to project and job events and update project and job instances
    this.on('project', this.handleProjectEvent.bind(this));
    this.on('job', this.handleJobEvent.bind(this));
    this.client.socket.on('authenticated', this.handleSocketAuthenticated.bind(this));
  }

  /**
   * Retrieves a list of projects created and tracked by this SogniClient instance.
   *
   * Note: When a project is finished, it will be removed from this list after 30 seconds
   *
   * @return {Array} A copy of the array containing the tracked projects.
   */
  get trackedProjects() {
    return this.projects.slice(0);
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
      workerCount,
      media: modelIndex[id]?.media || 'image'
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

  private async handleJobETA(data: JobETAData) {
    this.emit('job', {
      type: 'jobETA',
      projectId: data.jobID,
      jobId: data.imgID || '',
      etaSeconds: data.etaSeconds
    });
  }

  private async handleJobResult(data: JobResultData) {
    const project = this.projects.find((p) => p.id === data.jobID);
    const passNSFWCheck = !data.triggeredNSFWFilter || !project || project.params.disableNSFWFilter;
    let downloadUrl = data.resultUrl || null; // Use resultUrl from event if provided

    // If no resultUrl provided and NSFW check passes, generate download URL
    if (!downloadUrl && passNSFWCheck && !data.userCanceled) {
      // Use media endpoint for video/audio models, image endpoint for image models
      const isVideo = project && this.isVideoModelId(project.params.modelId);
      const isAudio = project && this.isAudioModelId(project.params.modelId);
      const isMedia = isVideo || isAudio;
      try {
        if (isMedia) {
          downloadUrl = await this.mediaDownloadUrl({
            jobId: data.jobID,
            id: data.imgID,
            type: 'complete',
            ...(isAudio && project ? { contentType: getAudioContentType(project) } : {})
          });
        } else {
          const imageContentType = project ? getImageContentType(project) : undefined;
          downloadUrl = await this.downloadUrl({
            jobId: data.jobID,
            imageId: data.imgID,
            type: 'complete',
            ...(imageContentType ? { contentType: imageContentType } : {})
          });
        }
      } catch (error: any) {
        this.client.logger.error('Failed to generate download URL for job result');
        this.client.logger.error(error);
      }
    }

    // Update the job directly with the result URL to prevent duplicate API calls
    if (project) {
      const job = project.job(data.imgID);
      if (job) {
        job._update({
          status: data.userCanceled ? 'canceled' : 'completed',
          step: data.performedStepCount,
          seed: Number(data.lastSeed),
          resultUrl: downloadUrl,
          isNSFW: data.triggeredNSFWFilter,
          userCanceled: data.userCanceled
        });
      }
    }

    // Emit job completion event with the generated download URL
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
        // 404 errors are expected when project is still initializing
        // Only log non-404 errors to avoid confusing users
        if (e.status !== 404) {
          this.client.logger.error(e);
        }
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
        stepCount: project.params.steps ?? 0
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
          // Just in case event comes out of order
          step: Math.max(event.step, job.step),
          stepCount: event.stepCount
        });
        if (project.status !== 'processing') {
          project._update({ status: 'processing' });
        }
        break;
      case 'jobETA': {
        // ETA updates keep the project alive (refreshes lastUpdated) and store the ETA value.
        // This is critical for long-running jobs like video generation that can take several
        // minutes and may not send frequent progress updates.
        // We always call _keepAlive() to ensure lastUpdated is refreshed, preventing premature timeouts.
        project._keepAlive();

        const newEta = new Date(Date.now() + event.etaSeconds * 1000);
        if (job.eta?.getTime() !== newEta?.getTime()) {
          job._update({ eta: newEta });
          const maxEta = project.jobs.reduce((max, j) => Math.max(max, j.eta?.getTime() || 0), 0);
          const projectETA = maxEta ? new Date(maxEta) : undefined;
          if (project.eta?.getTime() !== projectETA?.getTime()) {
            project._update({ eta: projectETA });
          }
        }
        break;
      }
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
        // Check if project should also fail when a job fails
        // For video jobs (single image) or when all jobs have failed, propagate to project
        const allJobsStarted = project.jobs.length >= project.params.numberOfMedia;
        const allJobsFailed = allJobsStarted && project.jobs.every((j) => j.status === 'failed');
        const isSingleJobProject = project.params.numberOfMedia === 1;
        if (isSingleJobProject || allJobsFailed) {
          project._update({
            status: 'failed',
            error: event.error
          });
        }
        break;
    }
  }

  private handleServerDisconnected() {
    this._availableModels = [];
    this.emit('availableModels', this._availableModels);
    // Do NOT fail tracked projects — they may recover on reconnect.
    // Pause timeout intervals so they don't force-fail during disconnect.
    this.projects.forEach((p) => p._pauseTimeout());
  }

  private async handleSocketAuthenticated(data: AuthenticatedData) {
    const { activeProjects, unclaimedCompletedProjects } = data;
    if (!activeProjects?.length && !unclaimedCompletedProjects?.length) return;

    this.client.logger.info(
      `[RECOVERY] Authenticated with ${activeProjects?.length || 0} active, ` +
      `${unclaimedCompletedProjects?.length || 0} unclaimed completed projects`
    );

    // Deduplicate: a project could theoretically appear in both arrays
    const seenIds = new Set<string>();

    // Resume timeouts on all existing tracked projects
    this.projects.forEach((p) => p._resumeTimeout());

    // --- Active projects ---
    const unmatchedActive: RecoveredProject[] = [];
    for (const recovered of (activeProjects || [])) {
      if (recovered.jobType === 'llm') continue;
      seenIds.add(recovered.id);

      const tracked = this.projects.find((p) => p.id === recovered.id);
      if (tracked) {
        if (tracked.status === 'failed' || tracked.status === 'pending') {
          const statusMap: Record<string, ProjectStatus> = {
            queued: 'queued',
            active: 'queued',
            assigned: 'processing',
            progress: 'processing',
          };
          const mappedStatus = statusMap[recovered.status] || 'processing';
          tracked._update({ status: mappedStatus, error: undefined });
        }
      } else {
        const rehydrated = this._rehydrateProject(recovered);
        this.projects.push(rehydrated);
        unmatchedActive.push(recovered);
      }
    }

    // --- Completed projects ---
    const unmatchedCompleted: CompletedRecoveredProject[] = [];
    for (const recovered of (unclaimedCompletedProjects || [])) {
      if (recovered.jobType === 'llm') continue;
      if (seenIds.has(recovered.id)) continue;

      const tracked = this.projects.find((p) => p.id === recovered.id);
      if (tracked) {
        await this._resolveAndCompleteTrackedProject(tracked, recovered);
      } else {
        const resultUrls = await this._resolveRecoveredProjectUrls(recovered);
        unmatchedCompleted.push({ ...recovered, resultUrls });
      }
    }

    if (unmatchedActive.length > 0) {
      this.client.logger.info(`[RECOVERY] Emitting ${unmatchedActive.length} active recovered projects`);
      this.emit('activeProjectsRecovered', unmatchedActive);
    }
    if (unmatchedCompleted.length > 0) {
      this.client.logger.info(`[RECOVERY] Emitting ${unmatchedCompleted.length} completed recovered projects`);
      this.emit('completedProjectsRecovered', unmatchedCompleted);
    }
  }

  private _rehydrateProject(recovered: RecoveredProject): Project {
    const mediaType = recovered.model?.type === 'video' ? 'video'
      : recovered.model?.type === 'music' ? 'audio'
      : 'image';

    const project = new Project(
      {
        type: mediaType,
        modelId: recovered.model.id,
        positivePrompt: '',
        numberOfMedia: recovered.imageCount,
        steps: recovered.stepCount,
      } as any,
      { api: this, logger: this.client.logger }
    );

    // Override the auto-generated UUID with the server's actual project ID
    (project as any).data.id = recovered.id;

    for (const wj of (recovered.workerJobs || [])) {
      project._addJob({
        id: wj.imgID,
        projectId: recovered.id,
        status: wj.status === 'jobStarted' ? 'processing'
          : wj.status === 'assigned' ? 'initiating'
          : 'pending',
        step: wj.performedSteps || 0,
        stepCount: recovered.stepCount,
        workerName: wj.worker?.username,
      });
    }

    const statusMap: Record<string, ProjectStatus> = {
      queued: 'queued', active: 'queued',
      assigned: 'processing', progress: 'processing',
    };
    project._update({
      status: statusMap[recovered.status] || 'processing'
    });

    return project;
  }

  private async _resolveAndCompleteTrackedProject(
    tracked: Project,
    recovered: RecoveredProject
  ) {
    for (const wj of (recovered.completedWorkerJobs || [])) {
      let job = tracked.job(wj.imgID);
      if (!job) {
        job = tracked._addJob({
          id: wj.imgID,
          projectId: tracked.id,
          status: 'pending',
          step: 0,
          stepCount: recovered.stepCount
        });
      }
      if (job.finished) continue;

      let resultUrl: string | null = null;
      if (!wj.triggeredNSFWFilter) {
        try {
          resultUrl = await this._downloadUrlForRecoveredJob(recovered, wj);
        } catch (e) {
          this.client.logger.error('Failed to resolve URL for recovered job', e);
        }
      }
      job._update({
        status: wj.triggeredNSFWFilter ? 'failed' : 'completed',
        step: wj.performedSteps,
        seed: wj.seedUsed,
        resultUrl,
        isNSFW: wj.triggeredNSFWFilter,
        workerName: wj.worker?.username
      });
    }
    // Only mark completed if all expected jobs are accounted for
    const completedJobCount = tracked.jobs.filter((j) => j.finished).length;
    if (completedJobCount >= recovered.imageCount) {
      tracked._update({ status: 'completed' });
    }
  }

  private async _resolveRecoveredProjectUrls(
    recovered: RecoveredProject
  ): Promise<string[]> {
    const urls: string[] = [];
    const isVideo = recovered.model?.type === 'video';
    const isAudio = recovered.model?.type === 'music';
    const isMedia = isVideo || isAudio;

    for (const wj of (recovered.completedWorkerJobs || [])) {
      if (wj.triggeredNSFWFilter) continue;
      try {
        let url: string;
        if (isMedia) {
          url = await this.mediaDownloadUrl({
            jobId: recovered.id,
            id: wj.imgID,
            type: 'complete'
          });
        } else {
          url = await this.downloadUrl({
            jobId: recovered.id,
            imageId: wj.imgID,
            type: 'complete'
          });
        }
        urls.push(url);
      } catch (e) {
        this.client.logger.error('Failed to resolve URL for recovered project', e);
      }
    }
    return urls;
  }

  private async _downloadUrlForRecoveredJob(
    recovered: RecoveredProject,
    wj: RecoveredWorkerJob
  ): Promise<string> {
    const isVideo = recovered.model?.type === 'video';
    const isAudio = recovered.model?.type === 'music';
    if (isVideo || isAudio) {
      return this.mediaDownloadUrl({
        jobId: recovered.id,
        id: wj.imgID,
        type: 'complete'
      });
    }
    return this.downloadUrl({
      jobId: recovered.id,
      imageId: wj.imgID,
      type: 'complete'
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
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.off('availableModels', handler);
          reject(new Error('Timeout waiting for models'));
        }
      }, timeout);

      const handler = (models: AvailableModel[]) => {
        // Only resolve when we get a non-empty models list
        // Empty arrays may be emitted during disconnects/reconnects
        if (models.length && !settled) {
          settled = true;
          clearTimeout(timeoutId);
          this.off('availableModels', handler);
          resolve(models);
        }
      };

      this.on('availableModels', handler);
    });
  }

  /**
   * Send new project request to the network. Returns project instance which can be used to track
   * progress and get resulting images or videos.
   * @param data
   */
  async create(data: ProjectParams): Promise<Project> {
    const project = new Project({ ...data }, { api: this, logger: this.client.logger });
    const modelOptions = await this.getModelOptions(data.modelId);
    const request = createJobRequestMessage(project.id, data, modelOptions);

    switch (data.type) {
      case 'image':
        await this._processImageAssets(project, data);
        break;
      case 'video':
        await this._processVideoAssets(project, data);
        break;
      case 'audio':
        // No assets to upload for audio
        break;
    }
    await this.client.socket.send('jobRequest', request);
    this.projects.push(project);
    return project;
  }

  private async _processImageAssets(project: Project, data: ImageProjectParams) {
    //Guide image
    if (data.startingImage && data.startingImage !== true) {
      await this.uploadGuideImage(project.id, data.startingImage);
    }

    // ControlNet image
    if (data.controlNet?.image && data.controlNet.image !== true) {
      await this.uploadCNImage(project.id, data.controlNet.image);
    }

    // Context images (Flux.2 Dev supports up to 6; Qwen Image Edit Plus supports up to 3; Flux Kontext supports up to 2)
    if (data.contextImages?.length) {
      const maxContextImages = getMaxContextImages(data.modelId);
      if (data.contextImages.length > maxContextImages) {
        throw new ApiError(500, {
          status: 'error',
          errorCode: 0,
          message: `Up to ${maxContextImages} context images are supported for this model`
        });
      }
      await Promise.all(
        data.contextImages.map((image, index) => {
          if (image && image !== true) {
            return this.uploadContextImage(project.id, index as 0 | 1 | 2 | 3 | 4 | 5, image);
          }
        })
      );
    }
  }

  private async _processVideoAssets(project: Project, data: VideoProjectParams) {
    if (data?.referenceImage && data.referenceImage !== true) {
      await this.uploadReferenceImage(project.id, data.referenceImage);
    }
    if (data?.referenceImageEnd && data.referenceImageEnd !== true) {
      await this.uploadReferenceImageEnd(project.id, data.referenceImageEnd);
    }
    if (data?.referenceAudio && data.referenceAudio !== true) {
      await this.uploadReferenceAudio(project.id, data.referenceAudio);
    }
    if (data?.referenceVideo && data.referenceVideo !== true) {
      await this.uploadReferenceVideo(project.id, data.referenceVideo);
    }
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
      imageId,
      jobId: projectId,
      type: 'startingImage'
    });
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: toFetchBody(file)
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
      imageId,
      jobId: projectId,
      type: 'cnImage'
    });
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: toFetchBody(file)
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

  private async uploadContextImage(
    projectId: string,
    index: 0 | 1 | 2 | 3 | 4 | 5,
    file: File | Buffer | Blob
  ) {
    const imageId = getUUID();
    const imageIndex = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6;
    const presignedUrl = await this.uploadUrl({
      imageId,
      jobId: projectId,
      type: `contextImage${imageIndex}`
    });
    const body = toFetchBody(file);
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body
    });
    if (!res.ok) {
      throw new ApiError(res.status, {
        status: 'error',
        errorCode: 0,
        message: `Failed to upload context image ${index}`
      });
    }
    return imageId;
  }

  // ============================================
  // VIDEO WORKFLOW UPLOADS (WAN 2.2)
  // ============================================

  /**
   * Upload reference image for WAN video workflows
   * @internal
   */
  private async uploadReferenceImage(projectId: string, file: File | Buffer | Blob) {
    const imageId = getUUID();
    const presignedUrl = await this.uploadUrl({
      imageId,
      jobId: projectId,
      type: 'referenceImage'
    });
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: toFetchBody(file)
    });
    if (!res.ok) {
      throw new ApiError(res.status, {
        status: 'error',
        errorCode: 0,
        message: 'Failed to upload reference image'
      });
    }
    return imageId;
  }

  /**
   * Upload reference image end for i2v interpolation
   * @internal
   */
  private async uploadReferenceImageEnd(projectId: string, file: File | Buffer | Blob) {
    const imageId = getUUID();
    const presignedUrl = await this.uploadUrl({
      imageId,
      jobId: projectId,
      type: 'referenceImageEnd'
    });
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: toFetchBody(file)
    });
    if (!res.ok) {
      throw new ApiError(res.status, {
        status: 'error',
        errorCode: 0,
        message: 'Failed to upload reference image end'
      });
    }
    return imageId;
  }

  /**
   * Upload reference audio for s2v workflows
   * Supported formats: mp3, m4a, wav
   * @internal
   */
  private async uploadReferenceAudio(projectId: string, file: File | Buffer | Blob) {
    const contentType = getFileContentType(file);
    const presignedUrl = await this.mediaUploadUrl({
      jobId: projectId,
      type: 'referenceAudio'
    });
    const headers: Record<string, string> = {};
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: toFetchBody(file),
      headers
    });
    if (!res.ok) {
      throw new ApiError(res.status, {
        status: 'error',
        errorCode: 0,
        message: 'Failed to upload reference audio'
      });
    }
  }

  /**
   * Upload reference video for animate workflows
   * Supported formats: mp4, mov
   * @internal
   */
  private async uploadReferenceVideo(projectId: string, file: File | Buffer | Blob) {
    const contentType = getFileContentType(file);
    const presignedUrl = await this.mediaUploadUrl({
      jobId: projectId,
      type: 'referenceVideo'
    });
    const headers: Record<string, string> = {};
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: toFetchBody(file),
      headers
    });
    if (!res.ok) {
      throw new ApiError(res.status, {
        status: 'error',
        errorCode: 0,
        message: 'Failed to upload reference video'
      });
    }
  }

  // ============================================
  // COST ESTIMATION
  // ============================================

  /**
   * Estimate image project cost
   */
  async estimateCost({
    network = 'fast',
    tokenType,
    model,
    imageCount,
    stepCount,
    previewCount,
    cnEnabled,
    startingImageStrength,
    width,
    height,
    sizePreset,
    guidance,
    sampler,
    contextImages
  }: EstimateRequest): Promise<CostEstimation> {
    let apiVersion = 2;
    const modelOptions = await this.getModelOptions(model);
    const pathParams = [
      tokenType || 'spark',
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
    } else {
      pathParams.push(0, 0);
    }
    if (sampler) {
      apiVersion = 3;
      pathParams.push(guidance || 0);
      pathParams.push(validateSampler(sampler, modelOptions)!);
      pathParams.push(contextImages || 0);
    }
    const r = await this.client.socket.get<EstimationResponse>(
      `/api/v${apiVersion}/job/estimate/${pathParams.join('/')}`
    );
    return {
      token: r.quote.project.costInToken,
      usd: r.quote.project.costInUSD,
      spark: r.quote.project.costInSpark,
      sogni: r.quote.project.costInSogni
    };
  }

  /**
   * Estimate image enhancement cost
   * @param strength
   * @param tokenType
   */
  async estimateEnhancementCost(strength: EnhancementStrength, tokenType: TokenType = 'spark') {
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
   * Estimates the cost of generating a video based on the provided parameters.
   *
   * @param {VideoEstimateRequest} params - The parameters required for video cost estimation. This includes:
   *   - tokenType: The type of token to be used for generation.
   *   - model: The model to be used for video generation.
   *   - width: The width of the video in pixels.
   *   - height: The height of the video in pixels.
   *   - frames: The total number of frames in the video.
   *   - fps: The frames per second for the video.
   *   - steps: Number of steps.
   * @return {Promise<Object>} Returns an object containing the estimated costs for the video in different units:
   *   - token: Cost in tokens.
   *   - usd: Cost in USD.
   *   - spark: Cost in Spark.
   *   - sogni: Cost in Sogni.
   */
  async estimateVideoCost(params: VideoEstimateRequest) {
    const pathParams = [
      params.tokenType,
      params.model,
      params.width,
      params.height,
      params.frames
        ? params.frames
        : calculateVideoFrames(params.model, params.duration, params.fps),
      params.fps,
      params.steps,
      params.numberOfMedia
    ];
    const path = pathParams.map((p) => encodeURIComponent(p)).join('/');
    const r = await this.client.socket.get<EstimationResponse>(
      `/api/v1/job-video/estimate/${path}`
    );
    return {
      token: r.quote.project.costInToken,
      usd: r.quote.project.costInUSD,
      spark: r.quote.project.costInSpark,
      sogni: r.quote.project.costInSogni
    };
  }

  /**
   * Estimate the cost of an audio generation job.
   *
   * @param {AudioEstimateRequest} params - The parameters required for audio cost estimation. This includes:
   *   - tokenType: The type of token to be used for generation.
   *   - model: The model to be used for audio generation.
   *   - duration: Duration of the audio in seconds.
   *   - steps: Number of inference steps.
   *   - numberOfMedia: Number of audio tracks to generate.
   * @return {Promise<CostEstimation>} Returns an object containing the estimated costs in different units.
   */
  async estimateAudioCost(params: AudioEstimateRequest): Promise<CostEstimation> {
    const pathParams = [
      params.tokenType,
      params.model,
      params.duration,
      params.steps,
      params.numberOfMedia
    ];
    const path = pathParams.map((p) => encodeURIComponent(p)).join('/');
    const r = await this.client.socket.get<EstimationResponse>(
      `/api/v1/job-audio/estimate/${path}`
    );
    return {
      token: r.quote.project.costInToken,
      usd: r.quote.project.costInUSD,
      spark: r.quote.project.costInSpark,
      sogni: r.quote.project.costInSogni
    };
  }

  // ============================================
  // URL HELPERS
  // ============================================

  /**
   * Get upload URL for image
   * @internal
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
   */
  async downloadUrl(params: ImageUrlParams) {
    const r = await this.client.rest.get<ApiResponse<{ downloadUrl: string }>>(
      `/v1/image/downloadUrl`,
      params
    );
    if (!r?.data?.downloadUrl) {
      throw new Error(`API returned no downloadUrl: ${JSON.stringify(r)}`);
    }
    return r.data.downloadUrl;
  }

  /**
   * Get upload URL for media (video/audio)
   * @internal
   */
  async mediaUploadUrl(params: MediaUrlParams) {
    const r = await this.client.rest.get<ApiResponse<{ uploadUrl: string }>>(
      `/v1/media/uploadUrl`,
      params
    );
    return r.data.uploadUrl;
  }

  /**
   * Get download URL for media (video/audio)
   * @internal
   */
  async mediaDownloadUrl(params: MediaUrlParams) {
    const r = await this.client.rest.get<ApiResponse<{ downloadUrl: string }>>(
      `/v1/media/downloadUrl`,
      params
    );
    if (!r?.data?.downloadUrl) {
      throw new Error(`API returned no downloadUrl: ${JSON.stringify(r)}`);
    }
    return r.data.downloadUrl;
  }

  // ============================================
  // MODEL/PRESET HELPERS
  // ============================================

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

  private async _getModelTiers(forceRefresh = false) {
    if (
      this._modelTiers.data &&
      !forceRefresh &&
      Date.now() - this._modelTiers.updatedAt.getTime() < MODELS_REFRESH_INTERVAL
    ) {
      return this._modelTiers.data;
    }
    const tiers = await this.client.socket.get<ModelTiersRaw>(`/api/v2/models/tiers`);
    this._modelTiers = { data: tiers, updatedAt: new Date() };
    return tiers;
  }

  /**
   * Get supported size presets for the model and network. Size presets are cached for 10 minutes.
   *
   * @example
   * ```ts
   * const presets = await sogni.projects.getSizePresets('fast', 'flux1-schnell-fp8');
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
   * Retrieves the video asset configuration for a given video model identifier.
   * Validates whether the provided model ID corresponds to a video model. If it does,
   * returns the appropriate video asset configuration based on the workflow type.
   *
   * @example Returned object for a model that implements image to video workflow:
   * ```json
   * {
   *   "workflowType": "i2v",
   *   "assets": {
   *     "referenceImage": "required",
   *     "referenceImageEnd": "optional",
   *     "referenceAudio": "forbidden",
   *     "referenceVideo": "forbidden"
   *   }
   * }
   * ```
   *
   * @param {string} modelId - The identifier of the video model to retrieve the configuration for.
   * @return {Object} The video asset configuration object where key is asset field and value is
   * either `required`, `forbidden` or `optional`. Returns `null` if no rules defined for the model.
   * @throws {ApiError} Throws an error if the provided model ID is not a video model.
   */
  async getVideoAssetConfig(modelId: string) {
    if (!this.isVideoModelId(modelId)) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `Model ${modelId} is not a video model`
      });
    }
    const workflow = getVideoWorkflowType(modelId);
    if (!workflow) {
      return {
        workflowType: null
      };
    }
    return {
      workflowType: workflow,
      assets: VIDEO_WORKFLOW_ASSETS[workflow]
    };
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
        workerCount,
        media: model?.media || 'image'
      };
    });
  }

  async getModelOptions(modelId: string): Promise<ModelOptions> {
    const models = await this.getSupportedModels();
    const tiers = await this._getModelTiers();
    const model = models.find((m) => m.id === modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not supported`);
    }
    const tier = tiers[model.tier];
    if (!tier) {
      throw new Error(`Unable to find model tier "${model.tier}" please contact support`);
    }
    if (isImageTier(tier)) {
      return mapImageTier(tier);
    }
    if (isVideoTier(tier)) {
      return mapVideoTier(tier);
    }
    if (isComfyImageTier(tier)) {
      return mapComfyImageTier(tier);
    }
    if (isAudioTier(tier)) {
      return mapAudioTier(tier);
    }
    throw new Error(`Unsupported model tier "${model.tier}"`);
  }
}

export default ProjectsApi;
