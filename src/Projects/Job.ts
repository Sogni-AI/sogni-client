import DataEntity, { EntityEvents } from '../lib/DataEntity';
import ErrorData from '../types/ErrorData';
import { RawJob, RawProject } from './types/RawProject';
import ProjectsApi from './index';
import { Logger } from '../lib/DefaultLogger';
import getUUID from '../lib/getUUID';
import { EnhancementStrength } from './types';
import Project from './Project';
import { SupernetType } from '../ApiClient/WebSocketClient/types';
import { getEnhacementStrength } from './utils';
import { TokenType } from '../types/token';
import has from 'lodash/has';

export const enhancementDefaults = {
  network: 'fast' as SupernetType,
  modelId: 'flux1-schnell-fp8',
  positivePrompt: '',
  negativePrompt: '',
  stylePrompt: '',
  startingImageStrength: 0.5,
  steps: 5,
  guidance: 1,
  numberOfMedia: 1,
  numberOfPreviews: 0
};

export type JobStatus =
  | 'pending'
  | 'initiating'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled';

const JOB_STATUS_MAP: Record<RawJob['status'], JobStatus> = {
  created: 'pending',
  queued: 'pending',
  assigned: 'initiating',
  initiatingModel: 'initiating',
  jobStarted: 'processing',
  jobProgress: 'processing',
  jobCompleted: 'completed',
  jobError: 'failed'
};

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeProgressPercent(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return clampProgress(value >= 0 && value <= 1 ? value * 100 : value);
}

function directResultUrlFromRawJob(rawJob: RawJob): string | null {
  const legacy = rawJob as RawJob & {
    imageUrl?: string | null;
    imageFile?: string | null;
    videoUrl?: string | null;
    videoFile?: string | null;
  };
  return (
    rawJob.resultUrl ||
    legacy.imageUrl ||
    legacy.imageFile ||
    legacy.videoUrl ||
    legacy.videoFile ||
    null
  );
}

function etaProgressPercent(
  startedAt: Date | undefined,
  eta: Date | undefined
): number | undefined {
  if (!startedAt || !eta) return undefined;
  const totalMs = eta.getTime() - startedAt.getTime();
  if (!Number.isFinite(totalMs) || totalMs <= 0) return undefined;
  const elapsedMs = Date.now() - startedAt.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 1;
  return Math.max(1, Math.min(95, Math.round((elapsedMs / totalMs) * 100)));
}

/**
 * @inline
 */
export interface JobData {
  id: string;
  projectId: string;
  status: JobStatus;
  step: number;
  stepCount: number;
  workerName?: string;
  seed?: number;
  isNSFW?: boolean;
  userCanceled?: boolean;
  previewUrl?: string;
  resultUrl?: string | null;
  error?: ErrorData;
  positivePrompt?: string;
  negativePrompt?: string;
  jobIndex?: number;
  /**
   * Direct progress percentage from external API-backed workers. Values may be
   * 0-1 or 0-100 depending on the upstream provider event.
   */
  externalProgress?: number;
  /**
   * Estimated time remaining in seconds (for long-running jobs like video generation).
   * Updated by ComfyUI workers during inference.
   * @deprecated Use `eta` instead.
   */
  etaSeconds?: number;
  /**
   * Estimate completion time of the job (for long-running jobs like video generation).
   * Updated by ComfyUI workers during inference.
   */
  eta?: Date;
  etaStartedAt?: Date;
}

export interface JobEventMap extends EntityEvents {
  progress: number;
  completed: string;
  failed: ErrorData;
}

export interface JobOptions {
  api: ProjectsApi;
  logger: Logger;
  project: Project;
}

class Job extends DataEntity<JobData, JobEventMap> {
  static fromRaw(rawProject: RawProject, rawJob: RawJob, options: JobOptions) {
    return new Job(
      {
        id: rawJob.imgID || getUUID(),
        projectId: rawProject.id,
        status: JOB_STATUS_MAP[rawJob.status],
        step: rawJob.performedSteps,
        stepCount: rawProject.stepCount,
        workerName: rawJob.worker.name,
        seed: rawJob.seedUsed,
        isNSFW: rawJob.triggeredNSFWFilter,
        resultUrl: directResultUrlFromRawJob(rawJob)
      },
      options
    );
  }

  private readonly _api: ProjectsApi;
  private readonly _logger: Logger;
  private readonly _project: Project;
  private _enhancementProject: Project | null = null;

  constructor(data: JobData, options: JobOptions) {
    super(data);

    this._api = options.api;
    this._logger = options.logger;
    this._project = options.project;

    this.on('updated', this.handleUpdated.bind(this));
    this.handleEnhancementUpdate = this.handleEnhancementUpdate.bind(this);
  }

  get id() {
    return this.data.id;
  }

  get projectId() {
    return this.data.projectId;
  }

  /**
   * Current status of the job.
   */
  get status() {
    return this.data.status;
  }

  get finished() {
    return ['completed', 'failed', 'canceled'].includes(this.status);
  }

  /**
   * Progress of the job in percentage (0-100).
   */
  get progress() {
    if (this.status === 'completed') return 100;
    const externalProgress = normalizeProgressPercent(this.data.externalProgress);
    if (externalProgress !== undefined) return externalProgress;
    if (this.data.stepCount > 0) {
      return clampProgress((this.data.step / this.data.stepCount) * 100);
    }
    return etaProgressPercent(this.data.etaStartedAt, this.data.eta) ?? 0;
  }

  /**
   * Current step of the job.
   */
  get step() {
    return this.data.step;
  }

  /**
   * Total number of steps that worker will perform.
   */
  get stepCount() {
    return this.data.stepCount;
  }

  /**
   * Seed used to generate the image. This property is only available when the job is completed.
   */
  get seed() {
    return this.data.seed;
  }

  /**
   * Last preview image URL generated by the worker.
   */
  get previewUrl() {
    return this.data.previewUrl;
  }

  /**
   * URL to the result image, could be null if the job was canceled or triggered NSFW filter while
   * it was not disabled explicitly.
   */
  get resultUrl() {
    return this.data.resultUrl;
  }

  get imageUrl() {
    return this.data.resultUrl || this.data.previewUrl;
  }

  get error() {
    return this.data.error;
  }

  /**
   * Whether this job has a result media file available for download.
   * Returns true if completed and not NSFW filtered.
   */
  get hasResultMedia() {
    return this.status === 'completed' && !this.isNSFW;
  }

  /**
   * Media type produced by this job's model
   */
  get type(): 'image' | 'video' | 'audio' {
    if (this._api.isVideoModelId(this._project.params.modelId)) return 'video';
    if (this._api.isAudioModelId(this._project.params.modelId)) return 'audio';
    return 'image';
  }

  get enhancedImage() {
    if (!this._enhancementProject) {
      return null;
    }
    const project = this._enhancementProject;
    const job = project.jobs[0];
    return {
      status: project.status,
      progress: project.progress,
      result: job?.resultUrl || null,
      error: project.error,
      getResultUrl: () => job?.getResultUrl()
    };
  }

  /**
   * Get the MIME content type for audio downloads based on the project's output format.
   */
  private get _audioContentType(): string {
    const format = (this._project.params as any).outputFormat;
    switch (format) {
      case 'flac':
        return 'audio/flac';
      case 'wav':
        return 'audio/wav';
      default:
        return 'audio/mpeg';
    }
  }

  /**
   * Get the MIME content type for image downloads based on the project's output format.
   */
  private get _imageContentType(): string | undefined {
    const format = (this._project.params as any).outputFormat;
    switch (format) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'webp':
        return 'image/webp';
      case 'png':
        return 'image/png';
      default:
        return undefined;
    }
  }

  /**
   * Get the result URL of the job. This method will make a request to the API to get signed URL.
   * IMPORTANT: URL expires after 30 minutes, so make sure to download the result as soon as possible.
   * For video jobs, this returns a video URL. For image jobs, this returns an image URL.
   */
  async getResultUrl(): Promise<string> {
    if (this.data.resultUrl) {
      return this.data.resultUrl;
    }
    if (this.data.status !== 'completed') {
      throw new Error('Job is not completed yet');
    }
    let url: string;
    if (this.type === 'video' || this.type === 'audio') {
      url = await this._api.mediaDownloadUrl({
        jobId: this.projectId,
        id: this.id,
        type: 'complete',
        ...(this.type === 'audio' ? { contentType: this._audioContentType } : {})
      });
    } else {
      url = await this._api.downloadUrl({
        jobId: this.projectId,
        imageId: this.id,
        type: 'complete',
        ...(this._imageContentType ? { contentType: this._imageContentType } : {})
      });
    }
    this._update({ resultUrl: url });
    return url;
  }

  /**
   * Whether the image is NSFW or not. Only makes sense if job is completed.
   * If NSFW filter is disabled, this property will always be false.
   * If NSFW filter is enabled and the image is NSFW, image will not be available for download.
   */
  get isNSFW() {
    return !!this.data.isNSFW;
  }

  /**
   * Name of the worker that is processing this job.
   */
  get workerName() {
    return this.data.workerName;
  }

  /**
   * Estimated time remaining in seconds for long-running jobs (e.g., video generation).
   * Only available for ComfyUI-based workers during inference.
   * Returns undefined if no ETA has been received.
   * @deprecated Use `timeLeft` instead.
   */
  get etaSeconds() {
    return this.data.etaSeconds;
  }

  /**
   * Estimate completion time of the job.
   * Only available for ComfyUI-based workers during inference.
   * Is useful when data is persisted
   * Returns undefined if no ETA has been received.
   */
  get eta() {
    return this.data.eta;
  }

  /**
   * Syncs the job data with the data received from the REST API.
   * @internal
   * @param data
   */
  async _syncWithRestData(data: RawJob) {
    const directResultUrl = directResultUrlFromRawJob(data);
    const delta: Partial<JobData> = {
      step: data.performedSteps,
      workerName: data.worker?.name,
      seed: data.seedUsed,
      isNSFW: data.triggeredNSFWFilter
    };
    if (JOB_STATUS_MAP[data.status]) {
      delta.status = JOB_STATUS_MAP[data.status];
    }
    if (!this.data.resultUrl && directResultUrl) {
      delta.resultUrl = directResultUrl;
    }
    if (
      !this.data.resultUrl &&
      !delta.resultUrl &&
      delta.status === 'completed' &&
      !data.triggeredNSFWFilter
    ) {
      try {
        if (this.type === 'video' || this.type === 'audio') {
          delta.resultUrl = await this._api.mediaDownloadUrl({
            jobId: this.projectId,
            id: this.id,
            type: 'complete',
            ...(this.type === 'audio' ? { contentType: this._audioContentType } : {})
          });
        } else {
          delta.resultUrl = await this._api.downloadUrl({
            jobId: this.projectId,
            imageId: this.id,
            type: 'complete',
            ...(this._imageContentType ? { contentType: this._imageContentType } : {})
          });
        }
      } catch (error) {
        this._logger.error(error);
      }
    }
    this._update(delta);
  }

  /**
   * Updates the job data with the provided delta.
   * @internal
   * @param delta
   */
  _update(delta: Partial<JobData>) {
    if (has(delta, 'eta')) {
      // Keeping etaSeconds for backwards compatibility
      if (delta.eta) {
        delta.etaSeconds = Math.round((delta.eta.getTime() - Date.now()) / 1000);
        if (!this.data.etaStartedAt && !delta.etaStartedAt) {
          delta.etaStartedAt = new Date();
        }
      }
    }
    super._update(delta);
  }

  private handleUpdated(keys: string[]) {
    if (
      keys.includes('step') ||
      keys.includes('stepCount') ||
      keys.includes('externalProgress') ||
      keys.includes('eta')
    ) {
      this.emit('progress', this.progress);
    }
    if (keys.includes('status') && this.status === 'completed') {
      this.emit('completed', this.resultUrl!);
    }
    if (keys.includes('status') && this.status === 'failed') {
      this.emit('failed', this.data.error!);
    }
  }

  private handleEnhancementUpdate() {
    this.emit('updated', ['enhancedImage']);
  }

  async getResultData() {
    if (!this.hasResultMedia) {
      throw new Error('No result media available');
    }
    const url = await this.getResultUrl();
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    return response.blob();
  }

  /**
   * Enhance the image using the Flux model. This method will create a new project with the
   * enhancement parameters and use the result image of the current job as the starting image.
   * @param strength - how much freedom the model has to change the image.
   * @param overrides - optional parameters to override original prompt, style or token type.
   */
  async enhance(
    strength: EnhancementStrength,
    overrides: { positivePrompt?: string; stylePrompt?: string; tokenType?: TokenType } = {}
  ) {
    const parentProjectParams = this._project.params;
    if (parentProjectParams.type !== 'image') {
      throw new Error('Enhancement is only available for images');
    }
    if (this.status !== 'completed') {
      throw new Error('Job is not completed yet');
    }
    if (this.isNSFW) {
      throw new Error('Job did not pass NSFW filter');
    }
    if (this._enhancementProject) {
      this._enhancementProject.off('updated', this.handleEnhancementUpdate);
      this._enhancementProject = null;
    }
    const imageData = await this.getResultData();
    const project = await this._api.create({
      type: 'image',
      ...enhancementDefaults,
      positivePrompt: overrides.positivePrompt || this._project.params.positivePrompt,
      stylePrompt: overrides.stylePrompt || this._project.params.stylePrompt,
      tokenType: overrides.tokenType || this._project.params.tokenType,
      seed: this.seed || this._project.params.seed,
      startingImage: imageData,
      startingImageStrength: 1 - getEnhacementStrength(strength),
      sizePreset: parentProjectParams.sizePreset
    });
    this._enhancementProject = project;
    this._enhancementProject.on('updated', this.handleEnhancementUpdate);
    const images = await project.waitForCompletion();
    return images[0];
  }
}

export default Job;
