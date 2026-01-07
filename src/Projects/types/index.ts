import { SupernetType } from '../../ApiClient/WebSocketClient/types';
import { ControlNetParams } from './ControlNetParams';
import { TokenType } from '../../types/token';
import { ForgeSampler, SupportedForgeSamplers } from './ForgeSamplerParams';
import { ForgeScheduler, SupportedForgeSchedulers } from './ForgeSchedulerParams';
import { ComfySampler, SupportedComfySamplers } from './ComfySamplerParams';
import { ComfyScheduler, SupportedComfySchedulers } from './ComfySchedulerParams';

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

export type Sampler = ForgeSampler | ComfySampler;

export type Scheduler = ForgeScheduler | ComfyScheduler;

export type { ForgeSampler, ForgeScheduler, ComfySampler, ComfyScheduler };

export {
  SupportedForgeSamplers,
  SupportedForgeSchedulers,
  SupportedComfySamplers,
  SupportedComfySchedulers
};

export type ImageOutputFormat = 'png' | 'jpg';
export type VideoOutputFormat = 'mp4';

export interface BaseProjectParams {
  /**
   * ID of the model to use, available models are available in the `availableModels` property of the `ProjectsApi` instance.
   */
  modelId: string;
  /**
   * Number of media files to generate. Depending on project type, this can be number of images or number of videos.
   */
  numberOfMedia: number;
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
   * Number of steps. For most Stable Diffusion models, optimal value is 20.
   */
  steps?: number;
  /**
   * Guidance scale. For most Stable Diffusion models, optimal value is 7.5.
   * For video models: Regular models range 0.7-8.0, LoRA version (lightx2v) range 0.7-1.6, step 0.01.
   * This maps to `guidanceScale` in the keyFrame for both image and video models.
   */
  guidance?: number;
  /**
   * Override current network type. Default value can be read from `sogni.account.currentAccount.network`
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
   * Select which tokens to use for the project.
   * If not specified, the Sogni token will be used.
   */
  tokenType?: TokenType;
}

export type InputMedia = File | Buffer | Blob | boolean;

/**
 * Video-specific parameters for video workflows (t2v, i2v, s2v, animate).
 * Only applicable when using video models like wan_v2.2-14b-fp8_t2v.
 * Includes frame count, fps, shift, and reference assets (image, audio, video).
 */
export interface VideoProjectParams extends BaseProjectParams {
  type: 'video';
  /**
   * Number of frames to generate
   * @deprecated Use duration instead
   */
  frames?: number;
  /**
   * Duration of the video in seconds. Supported range 1 to 10
   */
  duration?: number;
  /**
   * Frames per second for output video
   */
  fps?: number;
  /**
   * Shift parameter for video diffusion models.
   * Controls motion intensity. Range: 1.0-8.0, step 0.1.
   * Default: 8.0 for regular models, 5.0 for speed lora (lightx2v) except s2v and animate which use 8.0
   */
  shift?: number;
  /**
   * TeaCache optimization threshold for T2V and I2V models.
   * Range: 0.0-1.0. 0.0 = disabled.
   * Recommended: 0.15 for T2V (~1.5x speedup), 0.2 for I2V (conservative quality-focused)
   */
  teacacheThreshold?: number;
  /**
   * Reference image for WAN video workflows.
   * Maps to: startImage (i2v), characterImage (animate), referenceImage (s2v)
   */
  referenceImage?: InputMedia;
  /**
   * Optional end image for i2v interpolation workflows.
   * When provided with referenceImage, the video will interpolate between the two images.
   */
  referenceImageEnd?: InputMedia;
  /**
   * Reference audio for s2v (sound-to-video) workflows.
   */
  referenceAudio?: InputMedia;
  /**
   * Audio start position in seconds for s2v workflows.
   * Specifies where to begin reading from the audio file.
   * Default: 0
   */
  audioStart?: number;
  /**
   * Audio duration in seconds for s2v workflows.
   * Specifies how many seconds of audio to use.
   * If not provided, defaults to 30 seconds on the server.
   */
  audioDuration?: number;
  /**
   * Reference video for animate workflows.
   * Maps to: drivingVideo (animate-move), sourceVideo (animate-replace)
   */
  referenceVideo?: InputMedia;
  /**
   * Output video width. Only used if `sizePreset` is "custom"
   */
  width?: number;
  /**
   * Output video height. Only used if `sizePreset` is "custom"
   */
  height?: number;
  /**
   * ComfyUI sampler for video generation.
   * Uses ComfyUI's native lowercase format: euler, euler_ancestral, dpmpp_2m, etc.
   * Default: euler (or uni_pc for s2v models)
   */
  sampler?: ComfySampler;
  /**
   * ComfyUI scheduler for video generation.
   * Uses ComfyUI's native lowercase format: simple, normal, karras, sgm_uniform, etc.
   * Default: simple
   */
  scheduler?: ComfyScheduler;
  /**
   * Output video format. For now only 'mp4' is supported, defaults to 'mp4'.
   */
  outputFormat?: VideoOutputFormat;
}

export interface ImageProjectParams extends BaseProjectParams {
  type: 'image';
  /**
   * Number of previews to generate. Note that previews affect project cost
   */
  numberOfPreviews?: number;
  /**
   * Starting image for img2img workflows.
   * Supported types:
   * `File` - file object from input[type=file]
   * `Buffer` - Node.js buffer object with image data
   * `Blob` - blob object with image data
   * `true` - indicates that the image is already uploaded to the server
   */
  startingImage?: InputMedia;
  /**
   * How strong effect of starting image should be. From 0 to 1, default 0.5
   */
  startingImageStrength?: number;
  /**
   * Context images for multi-reference image generation.
   * Flux.2 Dev and Qwen Image Edit Plus support up to 3 context images.
   * Flux Kontext supports up to 2 context images.
   */
  contextImages?: InputMedia[];
  /**
   * Legacy sampler for non-ComfyUI models (Automatic1111 workers).
   * Not supported for ComfyUI models - use comfySampler instead.
   */
  sampler?: Sampler;
  /**
   * Legacy scheduler for non-ComfyUI models (Automatic1111 workers).
   * Not supported for ComfyUI models - use comfyScheduler instead.
   */
  scheduler?: Scheduler;
  /**
   * Size preset ID to use. You can query available size presets
   * from `sogni.projects.sizePresets(network, modelId)`
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
   * Output format. Can be 'png' or 'jpg'. Defaults to 'png'.
   */
  outputFormat?: ImageOutputFormat;
}

export type ProjectParams = ImageProjectParams | VideoProjectParams;

export function isVideoParams(params: ProjectParams): params is VideoProjectParams {
  return params.type === 'video';
}

export function isImageParams(params: ProjectParams): params is ImageProjectParams {
  return params.type === 'image';
}

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
    | 'contextImage3'
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

export interface VideoEstimateRequest {
  tokenType: TokenType;
  model: string;
  width: number;
  height: number;
  duration: number;
  /**
   * Number of frames to generate.
   * @deprecated Use duration instead
   */
  frames?: number;
  fps: number;
  steps: number;
  numberOfMedia: number;
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
 * Video workflow types for WAN models
 */
export type VideoWorkflowType = 't2v' | 'i2v' | 's2v' | 'animate-move' | 'animate-replace' | null;

export type AssetRequirement = 'required' | 'optional' | 'forbidden';

export type VideoAssetKey =
  | 'referenceImage'
  | 'referenceImageEnd'
  | 'referenceAudio'
  | 'referenceVideo';
