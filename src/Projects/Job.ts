import DataEntity, { EntityEvents } from '../lib/DataEntity.js';
import ErrorData from '../types/ErrorData.js';
import { RawJob, RawProject } from './types/RawProject.js';
import ProjectsApi from './index.js';
import { Logger } from '../lib/DefaultLogger.js';
import getUUID from '../lib/getUUID.js';
import { EnhancementStrength } from './types/index.js';
import Project from './Project.js';
import { SupernetType } from '../ApiClient/WebSocketClient/types.js';
import { getEnhacementStrength } from './utils/index.js';
import { TokenType } from '../types/token.js';
import has from 'lodash/has.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

type RuntimeLimitMedia = 'image' | 'video' | 'audio';

/**
 * Floor of the hard per-job runtime budget, by network and media type.
 *
 * A worker job must never occupy a worker indefinitely, but the budget has to
 * sit ABOVE the real render-time distribution or it destroys healthy work. The
 * previous flat 30 minutes sat inside it: on the fast network a 15 s MiniMax H3
 * reference-video render legitimately reaches ~60 min and Wan 2.2 i2v ~70 min,
 * and roughly 11% of runnable reference-video jobs were being cancelled at
 * exactly 30 minutes (measured over 15 days of production timings, 2026-08).
 * The relaxed network runs the same graphs undistilled on older cards, where a
 * single video job can take upwards of six hours.
 *
 * These are deliberately generous because this timer is the last-resort
 * backstop, not the primary guard. A stuck render is killed by the worker's own
 * watchdog (max(40 min, 6x ETA)), and a silent project is resolved within two
 * minutes by Project's staleness check, which asks the socket whether the job
 * is still alive. Waiting too long costs latency; cancelling too early costs
 * the artist the entire render and the fleet every GPU-hour already spent, so
 * ambiguity resolves toward waiting.
 */
const RUNTIME_LIMIT_FLOOR_MS: Record<SupernetType, Record<RuntimeLimitMedia, number>> = {
  fast: { image: 30 * MINUTE_MS, audio: 30 * MINUTE_MS, video: 90 * MINUTE_MS },
  relaxed: { image: 2 * HOUR_MS, audio: 2 * HOUR_MS, video: 8 * HOUR_MS }
};

/**
 * Scale the budget with the worker's own estimate, mirroring the worker-side
 * overrun rule (`max(floor, 6 x initial ETA)`) so the client never gives up on a
 * render the worker still considers healthy.
 */
const RUNTIME_LIMIT_ETA_MULTIPLIER = 6;

/** Absolute ceiling, so "never occupy a worker indefinitely" still holds. */
const RUNTIME_LIMIT_MAX_MS = 12 * HOUR_MS;

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
  /**
   * A safety signal fired on media that was still delivered, because the artist
   * turned the Sensitive Content Filter off. Advisory: the media is
   * downloadable and the app decides whether to blur it.
   */
  nsfwDetected?: boolean;
  /** Which signals fired: 'prompt' (text vocabulary), 'image' (classifier). */
  nsfwSources?: string[];
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
  /**
   * Worker's ETA confidence interval in seconds, updated with each progress
   * event. Wide early in a render while the worker's step-timing model
   * settles, narrowing as steps complete.
   */
  etaRange?: { min: number; max: number };
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
        isNSFW: rawJob.triggeredNSFWFilter || rawJob.nsfwDetected === true,
        nsfwDetected: rawJob.nsfwDetected === true,
        nsfwSources: rawJob.nsfwSources ? [...rawJob.nsfwSources] : undefined,
        resultUrl: directResultUrlFromRawJob(rawJob)
      },
      options
    );
  }

  private readonly _api: ProjectsApi;
  private readonly _logger: Logger;
  private readonly _project: Project;
  private _enhancementProject: Project | null = null;
  private _runtimeTimeout: NodeJS.Timeout | null = null;

  constructor(data: JobData, options: JobOptions) {
    super(data);

    this._api = options.api;
    this._logger = options.logger;
    this._project = options.project;

    this.on('updated', this.handleUpdated.bind(this));
    this.handleEnhancementUpdate = this.handleEnhancementUpdate.bind(this);

    if (this.status === 'processing') {
      this._startRuntimeTimeout();
    }
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
   *
   * Media existence, not a content judgement. A render the artist made with the
   * Sensitive Content Filter off is delivered even when a safety signal fired
   * on it (see {@link nsfwDetected}), so it has media like any other result.
   * Only a job the server actually withheld has none.
   */
  get hasResultMedia() {
    return this.status === 'completed' && !this.isWithheld;
  }

  /**
   * Whether the server withheld this job's media for sensitive content. True
   * only for a job that ran with the Sensitive Content Filter ON, and it means
   * no media exists to download.
   */
  get isWithheld() {
    return this.isNSFW && !this.nsfwDetected;
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
   * Whether a safety signal fired for this job. Only makes sense once the job
   * is completed.
   *
   * True in two different situations, which {@link nsfwDetected} tells apart:
   * the filter was ON and the media was withheld (no download), or the artist
   * turned the filter OFF and the media was delivered and merely labelled. Show
   * or blur delivered media from the viewer's own current filter setting rather
   * than from this flag alone.
   */
  get isNSFW() {
    return !!this.data.isNSFW;
  }

  /**
   * Whether the safety signal is a label on delivered media rather than a
   * withhold. True only when the artist rendered with the filter off, in which
   * case {@link resultUrl} is available like any other completed job.
   */
  get nsfwDetected() {
    return !!this.data.nsfwDetected;
  }

  /**
   * Which safety signals fired: `prompt` (shared text vocabulary) and/or
   * `image` (output classifier). Empty when none fired or none were reported.
   */
  get nsfwSources(): string[] {
    return this.data.nsfwSources ? [...this.data.nsfwSources] : [];
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
   * Worker's ETA confidence interval in seconds, updated with each progress
   * event. Wide early in a render while the worker's step-timing model
   * settles, narrowing as steps complete. Undefined until the worker reports
   * an interval.
   */
  get etaRange() {
    return this.data.etaRange;
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
      isNSFW: data.triggeredNSFWFilter || data.nsfwDetected === true,
      nsfwDetected: data.nsfwDetected === true,
      ...(data.nsfwSources ? { nsfwSources: [...data.nsfwSources] } : {})
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
      // Withheld media has nothing to mint. Labelled-but-delivered media does.
      // A record claiming both resolves to withheld, the safe reading.
      !(data.triggeredNSFWFilter === true && data.nsfwDetected !== true)
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
    if (this.status === 'processing') {
      this._startRuntimeTimeout();
    } else if (this.finished) {
      this._stopRuntimeTimeout();
    }
  }

  /** @internal */
  _stopRuntimeTimeout() {
    if (this._runtimeTimeout) {
      clearTimeout(this._runtimeTimeout);
      this._runtimeTimeout = null;
    }
  }

  /**
   * Network this job is budgeted against.
   *
   * An explicit per-project pin wins; otherwise the last network the server
   * announced. An unknown network resolves to `relaxed` on purpose: the relaxed
   * budget is the generous one, and over-waiting is recoverable while a
   * wrongly cancelled render is not.
   */
  private _runtimeLimitNetwork(): SupernetType {
    const pinned = this._project?.params?.network;
    if (pinned === 'fast' || pinned === 'relaxed') return pinned;
    return this._api._currentNetwork?.() === 'fast' ? 'fast' : 'relaxed';
  }

  private _runtimeLimitMedia(): RuntimeLimitMedia {
    const type = this._project?.params?.type;
    return type === 'video' || type === 'audio' ? type : 'image';
  }

  /** Hard runtime budget for this job, in milliseconds. */
  private _runtimeLimitMs(): number {
    const floor = RUNTIME_LIMIT_FLOOR_MS[this._runtimeLimitNetwork()][this._runtimeLimitMedia()];
    const etaSeconds = this.data.etaSeconds;
    const etaBudget =
      typeof etaSeconds === 'number' && etaSeconds > 0
        ? etaSeconds * 1000 * RUNTIME_LIMIT_ETA_MULTIPLIER
        : 0;
    return Math.min(RUNTIME_LIMIT_MAX_MS, Math.max(floor, etaBudget));
  }

  private _startRuntimeTimeout() {
    // Never reset the deadline on progress. The first processing transition is
    // the hard start time for this actual worker job.
    if (this._runtimeTimeout || this.finished) return;
    const limitMs = this._runtimeLimitMs();
    this._runtimeTimeout = setTimeout(() => {
      this._runtimeTimeout = null;
      if (this.status !== 'processing' || this._project.finished) return;
      this._project._handleJobRuntimeTimeout(this, limitMs);
    }, limitMs);
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
    // Only withheld media is unusable here. Media the artist rendered with the
    // filter off exists and can be enhanced like any other result.
    if (this.isWithheld) {
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
