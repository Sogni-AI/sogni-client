import ApiGroup, { ApiConfig } from '../ApiGroup.js';
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
} from './types/index.js';
import {
  JobErrorData,
  JobETAData,
  JobProgressData,
  JobResultData,
  JobStateData,
  SocketEventMap
} from '../ApiClient/WebSocketClient/events.js';
import Project from './Project.js';
import createJobRequestMessage from './createJobRequestMessage.js';
import { ApiError, ApiResponse } from '../ApiClient/index.js';
import { EstimationResponse } from './types/EstimationResponse.js';
import {
  AvailableLorasParams,
  LoraCatalog,
  LoraCatalogEntry,
  LoraConstraints
} from './types/LoraCatalog.js';
import { JobEvent, ProjectApiEvents, ProjectEvent } from './types/events.js';
import getUUID from '../lib/getUUID.js';
import { RawProject } from './types/RawProject.js';
import ErrorData from '../types/ErrorData.js';
import { SupernetType } from '../ApiClient/WebSocketClient/types.js';
import Cache from '../lib/Cache.js';
import { enhancementDefaults } from './Job.js';
import {
  calculateVideoFrames,
  getEnhacementStrength,
  getVideoAssetRequirements,
  getVideoContextImageSlots,
  getMinimaxH3ReferenceAudioSlots,
  getMinimaxH3ReferenceVideoSlots,
  getVideoWorkflowType,
  isAudioModel,
  isMinimaxH3ReferenceModel,
  isVideoModel,
  usesReferenceMask
} from './utils/index.js';
import { TokenType } from '../types/token.js';
import { getMaxContextImages, validateSampler } from '../lib/validation.js';
import ModelTiersRaw, {
  isAudioTier,
  isComfyImageTier,
  isImageTier,
  isVideoTier
} from './types/ModelTiersRaw.js';
import {
  mapAudioTier,
  mapComfyImageTier,
  mapImageTier,
  mapVideoTier,
  ModelOptions
} from './types/ModelOptions.js';

/**
 * Zero-based position of a context image, one less than the `contextImage<n>`
 * upload slot it is written to. Sixteen slots exist; MiniMax H3 r2v uses the
 * first nine of them.
 */
type ContextImageIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

const sizePresetCache = new Cache<SizePreset[]>(10 * 60 * 1000);
// The LoRA catalog changes whenever a LoRA is published or a strength range is
// retuned, and the server serves it `no-cache` for exactly that reason. Five
// minutes keeps a picker from refetching on every keystroke without letting a
// retuned range go stale for long.
const loraCatalogCache = new Cache<LoraCatalog>(5 * 60 * 1000);
/**
 * Used only when talking to an API that predates the advertised constraints.
 * These are the loader's own hard bounds and the render pipeline's stacking
 * cap; a current server sends its own values and those win.
 */
const DEFAULT_LORA_CONSTRAINTS: LoraConstraints = {
  maxPerRequest: 8,
  minStrength: -100,
  maxStrength: 100
};
const GARBAGE_COLLECT_TIMEOUT = 30000;
const MODELS_REFRESH_INTERVAL = 1000 * 60 * 60 * 24; // 24 hours

/** Fallback for an API that does not advertise its LoRA-capable model set. */
function deriveLoraCapableModelIds(loras: LoraCatalogEntry[]): string[] {
  const modelIds = new Set<string>();
  for (const lora of loras) {
    for (const modelId of lora.modelIds ?? []) modelIds.add(modelId);
  }
  return Array.from(modelIds).sort();
}

/**
 * Detect content type from a file object.
 * For File objects in browser, uses the type property.
 * Returns undefined if content type cannot be detected.
 */
function getFileContentType(file: File | Buffer | Blob): string | undefined {
  if (file instanceof Blob && 'type' in file && file.type) {
    return file.type;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) {
    if (file.length >= 12) {
      if (file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) return 'image/jpeg';
      if (file[0] === 0x89 && file[1] === 0x50 && file[2] === 0x4e && file[3] === 0x47) {
        return 'image/png';
      }
      if (file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WEBP') {
        return 'image/webp';
      }
      if (file.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
      if (file.toString('ascii', 4, 8) === 'ftyp') {
        const brand = file.toString('ascii', 8, 12).toLowerCase();
        if (brand.includes('m4a') || brand.includes('m4b')) return 'audio/mp4';
        if (brand.includes('qt')) return 'video/quicktime';
        return 'video/mp4';
      }
      if (file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WAVE') {
        return 'audio/wav';
      }
    }
    if (file.length >= 3 && file.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
    if (file.length >= 2 && file[0] === 0xff && (file[1] & 0xe0) === 0xe0) return 'audio/mpeg';
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
  private _currentNetworkType: SupernetType | null = null;
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

  private handleChangeNetwork(data: SocketEventMap['changeNetwork']) {
    if (data?.network === 'fast' || data?.network === 'relaxed') {
      this._currentNetworkType = data.network;
    }
    this._availableModels = [];
    this.emit('availableModels', this._availableModels);
  }

  /**
   * Network the server last announced for this connection, or null before any
   * announcement.
   *
   * @internal Used to size a job's hard runtime budget when the project did not
   * pin a network explicitly. Relaxed workers run undistilled graphs on older
   * cards and legitimately take hours per video job, so the budget must know
   * which network it is waiting on.
   */
  _currentNetwork(): SupernetType | null {
    return this._currentNetworkType;
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
      case 'queued': {
        const estimatedStartSeconds =
          data.estimatedStartSeconds === null
            ? null
            : typeof data.estimatedStartSeconds === 'number' &&
                Number.isFinite(data.estimatedStartSeconds) &&
                data.estimatedStartSeconds >= 0
              ? data.estimatedStartSeconds
              : undefined;
        const queueStatus =
          data.queueStatus === 'waiting' || data.queueStatus === 'no-workers'
            ? data.queueStatus
            : undefined;
        this.emit('project', {
          type: 'queued',
          projectId: data.jobID,
          queuePosition: data.queuePosition,
          ...(estimatedStartSeconds !== undefined ? { estimatedStartSeconds } : {}),
          ...(queueStatus !== undefined ? { queueStatus } : {})
        });
        return;
      }
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
          jobIndex: data.jobIndex,
          preparation: data.preparation
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
    const event: JobEvent = {
      type: 'progress',
      projectId: data.jobID,
      jobId: data.imgID,
      ...(typeof data.step === 'number' ? { step: data.step } : {}),
      ...(typeof data.stepCount === 'number' ? { stepCount: data.stepCount } : {}),
      ...(typeof data.progress === 'number' ? { progress: data.progress } : {}),
      ...(typeof data.etaSeconds === 'number' ? { etaSeconds: data.etaSeconds } : {}),
      ...(typeof data.etaMin === 'number' ? { etaMin: data.etaMin } : {}),
      ...(typeof data.etaMax === 'number' ? { etaMax: data.etaMax } : {})
    };
    this.emit('job', event);

    if (data.hasImage === true) {
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
    let downloadUrl = data.resultUrl || data.videoUrl || data.videoFile || null; // Use result URL from event if provided

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
    let performedStepCount = data.performedStepCount;
    let seed = data.lastSeed !== undefined ? Number(data.lastSeed) : undefined;
    if (project) {
      const job = project.job(data.imgID);
      if (job) {
        performedStepCount =
          typeof performedStepCount === 'number'
            ? performedStepCount
            : job.stepCount > 0
              ? job.stepCount
              : job.step;
        seed = typeof seed === 'number' && Number.isFinite(seed) ? seed : job.seed;
        job._update({
          status: data.userCanceled ? 'canceled' : 'completed',
          step: performedStepCount,
          seed,
          resultUrl: downloadUrl,
          isNSFW: Boolean(data.triggeredNSFWFilter),
          userCanceled: Boolean(data.userCanceled)
        });
      }
    }

    // Emit job completion event with the generated download URL
    this.emit('job', {
      type: 'completed',
      projectId: data.jobID,
      jobId: data.imgID,
      ...(typeof performedStepCount === 'number' ? { steps: performedStepCount } : {}),
      ...(typeof seed === 'number' && Number.isFinite(seed) ? { seed } : {}),
      resultUrl: downloadUrl,
      isNSFW: Boolean(data.triggeredNSFWFilter),
      userCanceled: Boolean(data.userCanceled)
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
    if (data.subscriptionLimit) {
      error.subscriptionLimit = true;
      if (data.requiredPlans) error.requiredPlans = data.requiredPlans;
      if (data.feature) error.feature = data.feature;
      if (data.limitation) error.limitation = data.limitation;
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
          queuePosition: event.queuePosition,
          queueStatus: event.queueStatus,
          estimatedStartAt:
            typeof event.estimatedStartSeconds === 'number'
              ? new Date(Date.now() + event.estimatedStartSeconds * 1000)
              : undefined
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
    // Any job-level event means a worker has taken this project, so the queue wait is over.
    // Leaving a stale estimate on the project would keep a "starts in ~2 min" label on
    // screen next to a job that is already rendering.
    if (project.estimatedStartAt !== undefined || project.queueStatus !== undefined) {
      project._update({ estimatedStartAt: undefined, queueStatus: undefined });
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
        {
          const delta: {
            status: 'processing';
            step?: number;
            stepCount?: number;
            externalProgress?: number;
            etaRange?: { min: number; max: number };
          } = {
            status: 'processing'
          };
          if (typeof event.step === 'number') {
            // Just in case event comes out of order
            delta.step = Math.max(event.step, job.step);
          }
          if (typeof event.stepCount === 'number') {
            delta.stepCount = event.stepCount;
          }
          if (typeof event.progress === 'number') {
            delta.externalProgress = event.progress;
          }
          if (
            typeof event.etaMin === 'number' &&
            typeof event.etaMax === 'number' &&
            event.etaMax > 0
          ) {
            // Workers send {etaMin: 0, etaMax: 0} when they have no interval yet
            delta.etaRange = { min: event.etaMin, max: event.etaMax };
          }
          job._update(delta);
        }
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
        const delta: {
          status: 'completed' | 'canceled';
          resultUrl: string | null;
          isNSFW: boolean;
          userCanceled: boolean;
          step?: number;
          seed?: number;
        } = {
          status: event.userCanceled ? 'canceled' : 'completed',
          resultUrl: event.resultUrl,
          isNSFW: event.isNSFW,
          userCanceled: event.userCanceled
        };
        if (typeof event.steps === 'number') {
          delta.step = event.steps;
        } else if (job.stepCount > 0) {
          delta.step = job.stepCount;
        }
        if (typeof event.seed === 'number' && Number.isFinite(event.seed)) {
          delta.seed = event.seed;
        }
        job._update({
          ...delta
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
    const requestParams = {
      ...data,
      appSource: data.appSource || this.client.appSource,
      attribution: this.resolveWorkloadAttribution(data.attribution, project.id)
    } as ProjectParams;
    const request = createJobRequestMessage(project.id, requestParams, modelOptions);

    switch (data.type) {
      case 'image':
        await this._processImageAssets(project, data);
        break;
      case 'video':
        await this._processVideoAssets(project, data);
        this._annotateVideoAssetContentTypes(request, data);
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

    // Context images (GPT Image 2 supports up to 16; Qwen Image Edit supports up to 3; Krea 2 Identity Edit and Flux Kontext support up to 2)
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
            return this.uploadContextImage(project.id, index as ContextImageIndex, image);
          }
        })
      );
    }
  }

  private async _processVideoAssets(project: Project, data: VideoProjectParams) {
    const isMinimaxH3R2v = isMinimaxH3ReferenceModel(data.modelId);
    if (data?.referenceImage && data.referenceImage !== true) {
      await this.uploadReferenceImage(project.id, data.referenceImage);
    }
    // MiniMax H3 r2v reference images beyond the first, uploaded to the same
    // numbered contextImage slots image projects use.
    // getVideoContextImageSlots offsets them past referenceImage so the two
    // never land on the same slot. createJobRequestMessage has already checked
    // the model, the entries, and the 9-image ceiling.
    await Promise.all(
      getVideoContextImageSlots(data).map(({ slot, media }) =>
        typeof media === 'boolean'
          ? undefined
          : this.uploadContextImage(project.id, (slot - 1) as ContextImageIndex, media)
      )
    );
    if (data?.referenceImageEnd && data.referenceImageEnd !== true) {
      await this.uploadReferenceImageEnd(project.id, data.referenceImageEnd);
    }
    if (!isMinimaxH3R2v && data?.referenceAudio && data.referenceAudio !== true) {
      await this.uploadReferenceAudio(project.id, data.referenceAudio);
    }
    if (data?.referenceAudioIdentity && data.referenceAudioIdentity !== true) {
      await this.uploadReferenceAudio(project.id, data.referenceAudioIdentity);
    }
    if (!isMinimaxH3R2v && data?.referenceVideo && data.referenceVideo !== true) {
      await this.uploadReferenceVideo(project.id, data.referenceVideo);
    }
    if (isMinimaxH3R2v) {
      await Promise.all([
        ...getMinimaxH3ReferenceAudioSlots(data).map(({ slot, media }) =>
          typeof media === 'boolean'
            ? undefined
            : this.uploadReferenceAudio(project.id, media, `referenceAudio${slot}`)
        ),
        ...getMinimaxH3ReferenceVideoSlots(data).map(({ slot, media }) =>
          typeof media === 'boolean'
            ? undefined
            : this.uploadReferenceVideo(project.id, media, `referenceVideo${slot}`)
        )
      ]);
    }
    if (data?.referenceMask && data.referenceMask !== true && usesReferenceMask(data)) {
      await this.uploadReferenceMask(project.id, data.referenceMask);
    }
  }

  private _annotateVideoAssetContentTypes(request: Record<string, any>, data: VideoProjectParams) {
    const keyFrame = request.keyFrames?.[0];
    if (!keyFrame) return;

    if (data.referenceImage && data.referenceImage !== true) {
      keyFrame.referenceImageContentType = getFileContentType(data.referenceImage);
    }
    if (data.referenceImageEnd && data.referenceImageEnd !== true) {
      keyFrame.referenceImageEndContentType = getFileContentType(data.referenceImageEnd);
    }
    const isMinimaxH3R2v = isMinimaxH3ReferenceModel(data.modelId);
    if (!isMinimaxH3R2v && data.referenceAudio && data.referenceAudio !== true) {
      keyFrame.referenceAudioContentType = getFileContentType(data.referenceAudio);
    }
    if (data.referenceAudioIdentity && data.referenceAudioIdentity !== true) {
      const contentType = getFileContentType(data.referenceAudioIdentity);
      keyFrame.referenceAudioIdentityContentType = contentType;
      keyFrame.referenceAudioContentType ??= contentType;
    }
    if (!isMinimaxH3R2v && data.referenceVideo && data.referenceVideo !== true) {
      keyFrame.referenceVideoContentType = getFileContentType(data.referenceVideo);
    }
    if (isMinimaxH3R2v) {
      for (const { slot, media } of getMinimaxH3ReferenceAudioSlots(data)) {
        if (typeof media !== 'boolean') {
          keyFrame[`referenceAudio${slot}ContentType`] = getFileContentType(media);
        }
      }
      for (const { slot, media } of getMinimaxH3ReferenceVideoSlots(data)) {
        if (typeof media !== 'boolean') {
          keyFrame[`referenceVideo${slot}ContentType`] = getFileContentType(media);
        }
      }
    }
    if (data.referenceMask && data.referenceMask !== true && usesReferenceMask(data)) {
      keyFrame.referenceMaskContentType = getFileContentType(data.referenceMask);
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
   * Ids of this account's projects that are currently live on the socket,
   * including ones still queued with no worker assigned.
   *
   * The REST API above only stores a project once it finishes, so it cannot
   * distinguish "still queued" from "lost" — both are 404. The socket holds the
   * only live copy, and answers scoped to the caller's own authenticated
   * address (the response carries no artist identity at all).
   *
   * @internal
   * @returns live project ids, or `null` when liveness could not be determined
   *   (endpoint unavailable on an older socket, unauthenticated client, or a
   *   transport error) — callers must treat `null` as "unknown", never as "gone".
   */
  async _listActiveProjectIds(): Promise<string[] | null> {
    try {
      const r = await this.client.socket.get<{ projects?: Array<{ id?: string }> }>(
        '/api/v1/artist/projects/active'
      );
      if (!r || !Array.isArray(r.projects)) return null;
      return r.projects.map((p) => p?.id).filter((id): id is string => typeof id === 'string');
    } catch {
      return null;
    }
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

  /**
   * Notify the socket server to cancel a project this client has timed out waiting for.
   * This preserves the local timeout failure state while still using the normal artist
   * cancellation protocol so the server aborts worker/vendor-side work.
   * @internal
   */
  async _notifyProjectTimedOut(projectId: string) {
    await this.client.socket.send('jobError', {
      jobID: projectId,
      error: 'artistCanceled',
      error_message: 'artistCanceled',
      isFromWorker: false
    });
  }

  private async uploadGuideImage(projectId: string, file: File | Buffer | Blob) {
    const imageId = getUUID();
    const contentType = getFileContentType(file);
    const presignedUrl = await this.uploadUrl({
      imageId,
      jobId: projectId,
      type: 'startingImage',
      contentType
    });
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: toFetchBody(file),
      headers
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
    const contentType = getFileContentType(file);
    const presignedUrl = await this.uploadUrl({
      imageId,
      jobId: projectId,
      type: 'cnImage',
      contentType
    });
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: toFetchBody(file),
      headers
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
    index: ContextImageIndex,
    file: File | Buffer | Blob
  ) {
    const imageId = getUUID();
    const imageIndex = (index + 1) as
      | 1
      | 2
      | 3
      | 4
      | 5
      | 6
      | 7
      | 8
      | 9
      | 10
      | 11
      | 12
      | 13
      | 14
      | 15
      | 16;
    const contentType = getFileContentType(file);
    const presignedUrl = await this.uploadUrl({
      imageId,
      jobId: projectId,
      type: `contextImage${imageIndex}`,
      contentType
    });
    const body = toFetchBody(file);
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body,
      headers
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
    const contentType = getFileContentType(file);
    const presignedUrl = await this.uploadUrl({
      imageId,
      jobId: projectId,
      type: 'referenceImage',
      contentType
    });
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: toFetchBody(file),
      headers
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
   * Upload reference mask IMAGE for distilled LTX 2.5 or LTX 2.3 v2v inpaint/outpaint workflows
   * @internal
   */
  private async uploadReferenceMask(projectId: string, file: File | Buffer | Blob) {
    const imageId = getUUID();
    const contentType = getFileContentType(file);
    const presignedUrl = await this.uploadUrl({
      imageId,
      jobId: projectId,
      type: 'referenceMask',
      contentType
    });
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: toFetchBody(file),
      headers
    });
    if (!res.ok) {
      throw new ApiError(res.status, {
        status: 'error',
        errorCode: 0,
        message: 'Failed to upload reference mask'
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
    const contentType = getFileContentType(file);
    const presignedUrl = await this.uploadUrl({
      imageId,
      jobId: projectId,
      type: 'referenceImageEnd',
      contentType
    });
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: toFetchBody(file),
      headers
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
   * Upload reference audio for s2v/ia2v/a2v workflows and ID-LoRA identity audio.
   * Shared S3 path — referenceAudio and referenceAudioIdentity are mutually exclusive by workflow type.
   * Supported formats: mp3, m4a, wav
   * @internal
   */
  private async uploadReferenceAudio(projectId: string, file: File | Buffer | Blob, id?: string) {
    const contentType = getFileContentType(file);
    const presignedUrl = await this.mediaUploadUrl({
      jobId: projectId,
      type: 'referenceAudio',
      id,
      contentType
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
  private async uploadReferenceVideo(projectId: string, file: File | Buffer | Blob, id?: string) {
    const contentType = getFileContentType(file);
    const presignedUrl = await this.mediaUploadUrl({
      jobId: projectId,
      type: 'referenceVideo',
      id,
      contentType
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
    contextImages,
    gptImageQuality,
    outputFormat
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
    if (sampler || contextImages !== undefined) {
      apiVersion = 3;
      pathParams.push(guidance || 0);
      pathParams.push(sampler ? validateSampler(sampler, modelOptions)! : '_');
      pathParams.push(contextImages || 0);
    }
    const queryParams = new URLSearchParams();
    if (gptImageQuality) queryParams.set('gptImageQuality', gptImageQuality);
    if (outputFormat) queryParams.set('outputFormat', outputFormat);
    const query = queryParams.toString();
    const r = await this.client.socket.get<EstimationResponse>(
      `/api/v${apiVersion}/job/estimate/${pathParams.join('/')}${query ? `?${query}` : ''}`
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
   *   - hasVideoInput: Whether to price a Seedance estimate with video input.
   *   - referenceImageCount: Number of image references submitted by the estimated job.
   * @return {Promise<Object>} Returns an object containing the estimated costs for the video in different units:
   *   - token: Cost in tokens.
   *   - usd: Cost in USD.
   *   - spark: Cost in Spark.
   *   - sogni: Cost in Sogni.
   */
  async estimateVideoCost(params: VideoEstimateRequest) {
    const frames = params.frames
      ? params.frames
      : calculateVideoFrames(params.model, params.duration, params.fps);
    const numberOfMedia = params.numberOfMedia ?? 1;
    const pathParams: Array<string | number> = [
      params.tokenType,
      params.model,
      params.width,
      params.height,
      frames,
      params.fps
    ];
    if (params.steps !== undefined && params.steps !== null) {
      pathParams.push(params.steps);
      pathParams.push(numberOfMedia);
    } else if (numberOfMedia !== 1) {
      pathParams.push(0);
      pathParams.push(numberOfMedia);
    }
    const path = pathParams.map((p) => encodeURIComponent(p)).join('/');
    const query = new URLSearchParams();
    const hasVideoInput =
      params.hasVideoInput === true ||
      Boolean(params.referenceVideo) ||
      (Array.isArray(params.referenceVideoUrls) && params.referenceVideoUrls.length > 0);
    if (hasVideoInput) {
      query.set('hasVideoInput', '1');
    }
    if (
      Number.isFinite(params.referenceImageCount) &&
      (params.referenceImageCount as number) >= 0
    ) {
      query.set('referenceImageCount', String(Math.floor(params.referenceImageCount as number)));
    }
    const queryString = query.toString();
    const r = await this.client.socket.get<EstimationResponse>(
      `/api/v1/job-video/estimate/${path}${queryString ? `?${queryString}` : ''}`
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
   * Request a presigned upload URL for an image asset (reference image,
   * starting image, ControlNet image, context image, etc.). The caller
   * uploads the image bytes via `PUT` to the returned URL before
   * starting a project or workflow that references the asset.
   *
   * @param {ImageUrlParams} params - Image asset coordinates:
   *   - imageId: Stable identifier for the asset within the job
   *     (e.g. `"media_ref_1"`). The same id is later used to reference
   *     the asset in workflow inputs.
   *   - jobId: Caller-generated job/correlation id (e.g.
   *     `"sogni-agent-1735000000-1-abcdef"`). Ties the asset to a
   *     specific request.
   *   - type: Asset role. Supported values include `'referenceImage'`,
   *     `'referenceImageEnd'`, `'startingImage'`, `'cnImage'`,
   *     `'contextImage1'`..`'contextImage16'`, `'preview'`, `'complete'`.
   *   - contentType: Optional MIME type the caller will `PUT` (e.g.
   *     `"image/png"`). Forwarded so the storage layer can pin the
   *     Content-Type on the presigned URL.
   * @return {Promise<string>} Presigned `PUT` URL the caller should
   *   upload the image bytes to. Short-lived; use immediately.
   */
  async uploadUrl(params: ImageUrlParams) {
    const r = await this.client.rest.get<ApiResponse<{ uploadUrl: string }>>(
      `/v1/image/uploadUrl`,
      params
    );
    return r.data.uploadUrl;
  }

  /**
   * Request a presigned download URL for a stored image asset.
   *
   * @param {ImageUrlParams} params - Same shape as
   *   {@link ProjectsApi.uploadUrl}; `imageId`, `jobId`, and `type`
   *   must match the values used at upload time.
   * @return {Promise<string>} Presigned `GET` URL for the image.
   *   Throws if the server response does not include a `downloadUrl`.
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
   * Request a presigned upload URL for an audio or video asset
   * (reference audio, reference video, finished media artifacts, etc.).
   * The caller uploads the media bytes via `PUT` to the returned URL
   * before starting a project or workflow that references the asset.
   *
   * @param {MediaUrlParams} params - Media asset coordinates:
   *   - id: Stable identifier for the asset within the job
   *     (e.g. `"media_ref_1"`). Optional for some asset roles.
   *   - jobId: Caller-generated job/correlation id.
   *   - type: Asset role. Supported values are `'referenceAudio'`,
   *     `'referenceVideo'`, `'preview'`, `'complete'`.
   *   - contentType: Optional MIME type the caller will `PUT`
   *     (e.g. `"audio/mp4"` or `"video/mp4"`).
   * @return {Promise<string>} Presigned `PUT` URL the caller should
   *   upload the media bytes to.
   */
  async mediaUploadUrl(params: MediaUrlParams) {
    const r = await this.client.rest.get<ApiResponse<{ uploadUrl: string }>>(
      `/v1/media/uploadUrl`,
      params
    );
    return r.data.uploadUrl;
  }

  /**
   * Request a presigned download URL for a stored audio or video asset.
   *
   * @param {MediaUrlParams} params - Same shape as
   *   {@link ProjectsApi.mediaUploadUrl}; `id`, `jobId`, and `type`
   *   must match the values used at upload time.
   * @return {Promise<string>} Presigned `GET` URL for the media.
   *   Throws if the server response does not include a `downloadUrl`.
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
   * @example Returned object for a MiniMax H3 image-to-video model:
   * ```json
   * {
   *   "workflowType": "i2v",
   *   "assets": {
   *     "referenceImage": "optional",
   *     "referenceImageEnd": "optional",
   *     "referenceAudio": "forbidden",
   *     "referenceAudioIdentity": "forbidden",
   *     "referenceVideo": "forbidden",
   *     "referenceMask": "forbidden"
   *   }
   * }
   * ```
   * MiniMax H3 requires at least one of `referenceImage` or
   * `referenceImageEnd`; each field is independently optional so callers can
   * request first-frame-only, last-frame-only, or first-and-last-frame input.
   *
   * Requirements are resolved per model, not per workflow type alone: the `r2v`
   * workflow type is shared by HappyHorse, which is image-only, and MiniMax H3
   * (`minimax-h3-ref2va-fp8_r2v` and `minimax-h3-ref2va-fp8_r2v_turbo`), which also takes reference video and
   * reference audio.
   *
   * This table describes the first upload slot only. MiniMax H3 r2v also uses
   * `contextImages`, `referenceVideos`, and `referenceAudios`; callers should
   * read those fields on `VideoProjectParams` for the multi-reference limits.
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
      assets: getVideoAssetRequirements(modelId)
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

  /**
   * Returns the server-advertised controls for a model. Video options include
   * width and height ranges and the optional total-pixel budget so clients can
   * build selectors from the same constraints enforced by the Supernet.
   */
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

  /**
   * List the LoRAs available for a model, with the strength contract of each.
   *
   * Pass the result's `loraId` values to {@link ProjectParams.loras}, and use
   * each entry's `ui.min`/`ui.max` and `ui.recommendedMin`/`ui.recommendedMax`
   * to bound the matching {@link ProjectParams.loraStrengths}. Do not assume a
   * 0-1 range: most Krea 2 LoRAs are bipolar sliders where a negative strength
   * applies the inverse effect.
   *
   * The catalog is public, so this works on an unauthenticated client. Results
   * are cached for 5 minutes per filter.
   *
   * @example
   * ```ts
   * const { loras } = await sogni.projects.availableLoras({
   *   modelId: 'krea2_turbo_fp8_scaled'
   * });
   * for (const lora of loras) {
   *   console.log(lora.loraId, lora.ui.min, lora.ui.max, lora.ui.default);
   * }
   * ```
   *
   * @param params.modelId - restrict to the LoRAs this model accepts. An
   *   unrecognized id, or a model with no LoRAs, yields an empty `loras` array.
   * @param params.forceRefresh - bypass the cache
   */
  async availableLoras(params: AvailableLorasParams = {}): Promise<LoraCatalog> {
    const { modelId, forceRefresh } = params;
    const cacheKey = modelId ?? '';
    const cached = loraCatalogCache.read(cacheKey);
    if (cached && !forceRefresh) {
      return cached;
    }
    const res = await this.client.rest.get<ApiResponse<LoraCatalog>>(
      '/v1/loras/comfy',
      modelId ? { modelId } : {}
    );
    const loras = res.data.loras ?? [];
    // The server applies `modelId`, but every row also carries the authoritative
    // `modelIds` it was joined from. Re-applying the predicate here keeps the
    // result correct against an API deployment that predates the query
    // parameter and would otherwise silently return the whole catalog.
    const scoped = modelId ? loras.filter((lora) => lora.modelIds?.includes(modelId)) : loras;
    const catalog: LoraCatalog = {
      lastUpdated: res.data.lastUpdated,
      loras: scoped,
      // Both are catalog-level facts the server advertises so clients need not
      // hard-code them. An API predating them leaves the derived model set
      // (from the rows we did get) and the loader's own documented limits.
      models: res.data.models ?? deriveLoraCapableModelIds(loras),
      constraints: res.data.constraints ?? DEFAULT_LORA_CONSTRAINTS
    };
    loraCatalogCache.write(cacheKey, catalog);
    return catalog;
  }

  /**
   * Look up one LoRA's catalog entry by id, or `undefined` if the catalog does
   * not carry it. Shares the {@link availableLoras} cache.
   *
   * @example
   * ```ts
   * const lora = await sogni.projects.getLora('krea2-warm-light');
   * console.log(lora?.ui.rangeLabels); // { min: 'Cooler & Darker', max: 'Warmer & Golden' }
   * ```
   */
  async getLora(loraId: string): Promise<LoraCatalogEntry | undefined> {
    const { loras } = await this.availableLoras();
    return loras.find((lora) => lora.loraId === loraId);
  }

  /**
   * Whether a model accepts LoRAs at all — use it to decide whether to offer a
   * LoRA control, instead of hard-coding a model list that goes stale the next
   * time a LoRA ships for a new model. Shares the {@link availableLoras} cache.
   *
   * @example
   * ```ts
   * if (await sogni.projects.supportsLoras(modelId)) {
   *   // render the LoRA picker
   * }
   * ```
   */
  async supportsLoras(modelId: string): Promise<boolean> {
    const { models } = await this.availableLoras();
    return models.includes(modelId);
  }

  /**
   * The limits that apply to every LoRA request: how many stack on one render,
   * and the loader's hard strength bounds. Shares the {@link availableLoras}
   * cache.
   *
   * @example
   * ```ts
   * const { maxPerRequest } = await sogni.projects.loraConstraints();
   * console.log(`Attach up to ${maxPerRequest} LoRAs`);
   * ```
   */
  async loraConstraints(): Promise<LoraConstraints> {
    const { constraints } = await this.availableLoras();
    return constraints;
  }
}

export default ProjectsApi;
