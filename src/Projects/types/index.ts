import { SupernetType } from '../../ApiClient/WebSocketClient/types';
import { ControlNetParams } from './ControlNetParams';
import { TokenType } from '../../types/token';
import { Sampler, SupportedSamplers } from './SamplerParams';
import { Scheduler, SupportedSchedulers } from './SchedulerParams';

export interface SupportedModel {
  id: string;
  name: string;
  SID: number;
  /**
   * Media type produced by this model: 'image' or 'video'
   */
  media: 'image' | 'video';
}

export interface AvailableModel {
  id: string;
  name: string;
  workerCount: number;
  /**
   * Media type produced by this model: 'image' or 'video'
   */
  media: 'image' | 'video';
}

export interface SizePreset {
  label: string;
  id: string;
  width: number;
  height: number;
  ratio: string;
  aspect: string;
}

export type { Sampler, Scheduler };

export { SupportedSamplers, SupportedSchedulers };

export type OutputFormat = 'png' | 'jpg' | 'mp4';

export type InputImage = File | Buffer | Blob | boolean;

export type InputMedia = File | Buffer | Blob | boolean;

/**
 * Media type for job results
 */
export type MediaType = 'image' | 'video';

/**
 * Video-specific parameters for video workflows (t2v, i2v, s2v, animate)
 */
export interface VideoParams {
  /**
   * Number of frames to generate
   */
  frames?: number;
  /**
   * Frames per second for output video
   */
  fps?: number;
  /**
   * Shift parameter for video diffusion models
   */
  shift?: number;
  /**
   * Reference image for WAN video workflows.
   * Maps to: startImage (i2v), characterImage (animate), referenceImage (s2v)
   */
  referenceImage?: InputImage;
  /**
   * Optional end image for i2v interpolation workflows.
   * When provided with referenceImage, the video will interpolate between the two images.
   */
  referenceImageEnd?: InputImage;
  /**
   * Reference audio for s2v (sound-to-video) workflows.
   */
  referenceAudio?: InputMedia;
  /**
   * Reference video for animate workflows.
   * Maps to: drivingVideo (animate-move), sourceVideo (animate-replace)
   */
  referenceVideo?: InputMedia;
}

export interface ProjectParams {
  /**
   * ID of the model to use, available models are available in the `availableModels` property of the `ProjectsApi` instance.
   */
  modelId: string;
  /**
   * Prompt for what to be created
   */
  positivePrompt: string;
  /**
   * Prompt for what to be avoided
   */
  negativePrompt: string;
  /**
   * Image style prompt
   */
  stylePrompt: string;
  /**
   * Number of steps. For most Stable Diffusion models, optimal value is 20
   */
  steps: number;
  /**
   * Guidance scale. For most Stable Diffusion models, optimal value is 7.5
   */
  guidance: number;
  /**
   * Override current network type. Default value can be read from `client.account.currentAccount.network`
   */
  network?: SupernetType;
  /**
   * Disable NSFW filter for Project. Default is false, meaning NSFW filter is enabled.
   * If image triggers NSFW filter, it will not be available for download.
   */
  disableNSFWFilter?: boolean;
  /**
   * Seed for one of images in project. Other will get random seed. Must be Uint32
   */
  seed?: number;
  /**
   * Number of images to generate
   */
  numberOfImages: number;

  // ============================================
  // IMAGE WORKFLOW PARAMS (SD, Flux, etc.)
  // ============================================

  /**
   * Starting image for img2img workflows.
   * Supported types:
   * `File` - file object from input[type=file]
   * `Buffer` - Node.js buffer object with image data
   * `Blob` - blob object with image data
   * `true` - indicates that the image is already uploaded to the server
   */
  startingImage?: InputImage;
  /**
   * How strong effect of starting image should be. From 0 to 1, default 0.5
   */
  startingImageStrength?: number;
  /**
   * Context images for Flux Kontext model. Flux Kontext support up to 2 context images.
   */
  contextImages?: InputImage[];

  // ============================================
  // VIDEO WORKFLOW PARAMS
  // ============================================

  /**
   * Video-specific parameters for video workflows (t2v, i2v, s2v, animate).
   * Only applicable when using video models like wan_v2.2-14b-fp8_t2v.
   * Includes frame count, fps, shift, and reference assets (image, audio, video).
   */
  video?: VideoParams;

  // ============================================
  // OTHER PARAMS
  // ============================================

  /**
   * Number of previews to generate. Note that previews affect project cost
   */
  numberOfPreviews?: number;
  /**
   * Scheduler to use
   */
  sampler?: Sampler;
  /**
   * Time step spacing method
   */
  scheduler?: Scheduler;
  /**
   * Size preset ID to use. You can query available size presets
   * from `client.projects.sizePresets(network, modelId)`
   */
  sizePreset?: 'custom' | string;
  /**
   * Output image width. Only used if `sizePreset` is "custom"
   */
  width?: number;
  /**
   * Output image height. Only used if `sizePreset` is "custom"
   */
  height?: number;
  /**
   * ControlNet model parameters
   */
  controlNet?: ControlNetParams;
  /**
   * Select which tokens to use for the project.
   * If not specified, the Sogni token will be used.
   */
  tokenType?: TokenType;
  /**
   * Output format. Can be 'png', 'jpg', or 'mp4'.
   * Defaults to 'png' for image models, 'mp4' for video models.
   */
  outputFormat?: OutputFormat;
}

/**
 * Supported image formats
 */
export type ImageFormat = 'png' | 'jpg' | 'jpeg' | 'webp';

/**
 * Supported audio formats
 */
export type AudioFormat = 'm4a' | 'mp3' | 'wav';

/**
 * Supported video formats
 */
export type VideoFormat = 'mp4' | 'mov';

/**
 * Parameters for image asset URL requests (upload/download)
 */
export type ImageUrlParams = {
  imageId: string;
  jobId: string;
  type:
    | 'preview'
    | 'complete'
    | 'startingImage'
    | 'cnImage'
    | 'contextImage1'
    | 'contextImage2'
    | 'referenceImage'
    | 'referenceImageEnd';
  startContentType?: string;
};

/**
 * Parameters for media asset URL requests (video/audio upload/download)
 */
export type MediaUrlParams = {
  id?: string;
  jobId: string;
  type: 'complete' | 'preview' | 'referenceAudio' | 'referenceVideo';
};

export interface EstimateRequest {
  /**
   * Network to use. Can be 'fast' or 'relaxed'
   */
  network: SupernetType;
  /**
   * Token type
   */
  tokenType?: TokenType;
  /**
   * Model ID
   */
  model: string;
  /**
   * Number of images to generate
   */
  imageCount: number;
  /**
   * Number of steps
   */
  stepCount: number;
  /**
   * Number of preview images to generate
   */
  previewCount: number;
  /**
   * Control network enabled
   */
  cnEnabled?: boolean;
  /**
   * How strong effect of starting image should be. From 0 to 1, default 0.5
   */
  startingImageStrength?: number;
  /**
   * Size preset ID
   */
  sizePreset?: string;
  /**
   * Size preset image width, if not using size preset
   * @internal
   */
  width?: number;
  /**
   * Size preset image height, if not using size preset
   * @internal
   */
  height?: number;
  /**
   * Guidance, note that this parameter is ignored if `scheduler` is not provided
   */
  guidance?: number;
  /**
   * Sampler
   */
  sampler?: Sampler;
  /**
   * Number of context images to use (for Flux Kontext).
   * Note that this parameter is ignored if `scheduler` is not provided
   */
  contextImages?: number;
}

/**
 * Represents estimation of project cost in different currency formats
 */
export interface CostEstimation {
  /** Cost in selected token type */
  token: string;
  /** Cost in USD */
  usd: string;
  /** Cost in Spark Points */
  spark: string;
  /** Cost in Sogni tokens */
  sogni: string;
}

export type EnhancementStrength = 'light' | 'medium' | 'heavy';

/**
 * Check if a model ID is for a video workflow.
 * This is consistent with the `media` property returned by the models list API.
 * Video models produce MP4 output; image models produce PNG/JPG output.
 */
export function isVideoModel(modelId: string): boolean {
  return modelId.startsWith('wan_');
}

/**
 * Video workflow types for WAN models
 */
export type VideoWorkflowType = 't2v' | 'i2v' | 's2v' | 'animate-move' | 'animate-replace' | null;

/**
 * Get the video workflow type from a model ID.
 * Returns null for non-video models.
 */
export function getVideoWorkflowType(modelId: string): VideoWorkflowType {
  if (!modelId || !modelId.startsWith('wan_')) return null;
  if (modelId.includes('_i2v')) return 'i2v';
  if (modelId.includes('_s2v')) return 's2v';
  if (modelId.includes('_animate-move')) return 'animate-move';
  if (modelId.includes('_animate-replace')) return 'animate-replace';
  if (modelId.includes('_t2v')) return 't2v';
  return null;
}

/**
 * Asset requirements for each video workflow type.
 * - required: Must be provided
 * - optional: Can be provided
 * - forbidden: Must NOT be provided
 */
export const VIDEO_WORKFLOW_ASSETS: Record<
  NonNullable<VideoWorkflowType>,
  {
    referenceImage: 'required' | 'optional' | 'forbidden';
    referenceImageEnd: 'required' | 'optional' | 'forbidden';
    referenceAudio: 'required' | 'optional' | 'forbidden';
    referenceVideo: 'required' | 'optional' | 'forbidden';
  }
> = {
  t2v: {
    referenceImage: 'forbidden',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden',
    referenceVideo: 'forbidden'
  },
  i2v: {
    referenceImage: 'required',
    referenceImageEnd: 'optional',
    referenceAudio: 'forbidden',
    referenceVideo: 'forbidden'
  },
  s2v: {
    referenceImage: 'required',
    referenceAudio: 'required',
    referenceImageEnd: 'forbidden',
    referenceVideo: 'forbidden'
  },
  'animate-move': {
    referenceImage: 'required',
    referenceVideo: 'required',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden'
  },
  'animate-replace': {
    referenceImage: 'required',
    referenceVideo: 'required',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden'
  }
};
