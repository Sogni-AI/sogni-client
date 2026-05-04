import { SupernetType } from '../../ApiClient/WebSocketClient/types';
import { ControlNetParams, VideoControlNetParams } from './ControlNetParams';
import { TokenType } from '../../types/token';

export interface SupportedModel {
  id: string;
  name: string;
  SID: number;
  tier: string;
  /**
   * Media type produced by this model: 'image', 'video', or 'audio'
   */
  media: 'image' | 'video' | 'audio';
}

export interface AvailableModel {
  id: string;
  name: string;
  workerCount: number;
  /**
   * Media type produced by this model: 'image', 'video', or 'audio'
   */
  media: 'image' | 'video' | 'audio';
}

export interface SizePreset {
  label: string;
  id: string;
  width: number;
  height: number;
  ratio: string;
  aspect: string;
}

export type ImageOutputFormat = 'png' | 'jpg' | 'webp';
export type GptImageQuality = 'low' | 'medium' | 'high' | 'standard' | 'hd';
export type GptImageBackground = 'opaque' | 'auto';
export type VideoOutputFormat = 'mp4';
export type AudioOutputFormat = 'mp3' | 'flac' | 'wav';

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
   * Prompt for what to be avoided. If not provided, server default is used.
   */
  negativePrompt?: string;
  /**
   * Image style prompt. If not provided, server default is used.
   */
  stylePrompt?: string;
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
  /**
   * Optional client app/source label to attach to the project request for server-side attribution.
   */
  appSource?: string;
  /**
   * Array of LoRA IDs to apply.
   * Available LoRAs are model-specific. The worker will download the LoRA
   * if not already present on the persistent volume.
   * LoRA IDs are resolved to filenames via the worker config API.
   * Example: ['multiple_angles']
   */
  loras?: string[];
  /**
   * Array of LoRA strengths corresponding to each LoRA in the loras array.
   * Values should be between 0.0 and 2.0. Defaults to 1.0 if not specified.
   * Example: [0.9]
   */
  loraStrengths?: number[];
}

export type InputMedia = File | Buffer | Blob | boolean;

/**
 * Video-specific parameters for video workflows (t2v, i2v, s2v, ia2v, a2v, animate).
 * Only applicable when using video models like wan_v2.2-14b-fp8_t2v or ltx23-22b-fp8_t2v_distilled.
 * Includes frame count, fps, shift, and reference assets (image, audio, video).
 *
 * ## Important: FPS and Frame Count Behavior Differs by Model
 *
 * ### WAN 2.2 Models (wan_v2.2-*)
 * - Always generate video at 16fps internally
 * - The `fps` parameter (16 or 32) only controls post-render frame interpolation
 * - fps=32 doubles the frames via interpolation after generation
 * - Frame count is always calculated as: `duration * 16 + 1`
 * - Example: 5 seconds at 32fps = 81 frames generated, then interpolated to 161 output frames
 *
 * ### LTX-2.3 Models (ltx2-*, ltx23-*)
 * - Generate video at the actual specified FPS (1-60 fps range)
 * - No post-render interpolation - fps directly affects generation
 * - Frame count is calculated as: `duration * fps + 1`
 * - Frame count must follow the pattern: `1 + n*8` (i.e., 1, 9, 17, 25, 33, ...)
 * - Example: 5 seconds at 24fps = 121 frames (since 121 = 1 + 15*8)
 *
 * ### Seedance 2.0 Models (seedance-2-0*)
 * - External API-backed video models for text-to-video, image-to-video,
 *   multimodal reference generation, image+audio-to-video, and video-to-video
 * - Generate at fixed 24fps
 * - Direct SDK project duration range is 4 to 15 seconds
 * - Frame count is calculated as: `duration * 24 + 1`
 * - Vendor reference limits are 9 images, 3 videos, 3 audios, and 12 asset files total
 */
export interface VideoProjectParams extends BaseProjectParams {
  type: 'video';
  /**
   * Number of frames to generate.
   * @deprecated Use duration instead. When using duration, the SDK automatically
   * calculates the correct frame count based on the model type.
   */
  frames?: number;
  /**
   * Duration of the video in seconds. Supported range 1 to 10 (WAN), 4 to 20 (LTX-2.3),
   * or 4 to 15 (Seedance direct SDK projects).
   *
   * The SDK automatically calculates the correct frame count based on the model:
   * - WAN 2.2: `duration * 16 + 1` (always 16fps generation)
   * - LTX-2.3: `duration * fps + 1`, snapped to frame step constraint
   * - Seedance: `duration * 24 + 1`
   */
  duration?: number;
  /**
   * Frames per second for output video.
   *
   * **WAN 2.2 Models:** Only 16 or 32 fps allowed. The 32fps option is post-render
   * frame interpolation that doubles the output frames. Internal generation is always 16fps.
   *
   * **LTX-2.3 Models:** Any value from 1-60 fps. This directly controls the generation
   * frame rate - there is no post-render interpolation.
   *
   * **Seedance Models:** Fixed 24fps external API generation.
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
   * Reference image for video workflows.
   * Maps to: startImage (i2v), characterImage (animate), referenceImage (s2v, ia2v)
   */
  referenceImage?: InputMedia;
  /**
   * Seedance-only loose image context references. These must be publicly
   * accessible HTTPS URLs that the vendor can fetch. Use referenceImage /
   * referenceImageEnd when the image should lock the first or last frame.
   */
  referenceImageUrls?: string[];
  /**
   * Optional end image for i2v interpolation workflows.
   * When provided with referenceImage, the video will interpolate between the two images.
   */
  referenceImageEnd?: InputMedia;
  /**
   * Reference audio for audio-driven video workflows (s2v, ia2v, a2v).
   */
  referenceAudio?: InputMedia;
  /**
   * Seedance-only audio context references. These must be publicly accessible
   * HTTPS URLs. Seedance does not support text+audio-only requests; include at
   * least one image or video reference when using audio URL references.
   */
  referenceAudioUrls?: string[];
  /**
   * Enable native audio generation for external API-backed video models that support it.
   * Seedance defaults to audio enabled server-side; set to false to request a silent video.
   */
  generateAudio?: boolean;
  /**
   * Reference audio for ID-LoRA speaker identity transfer (LTX-2.3 only).
   * Provide a ~5 second audio clip of the target speaker's voice.
   * The model uses this to transfer vocal identity into the generated video.
   * Available on t2v, i2v, and v2v LTX-2.3 workflows.
   * Not compatible with audio-driven workflows (s2v, ia2v, a2v).
   */
  referenceAudioIdentity?: InputMedia;
  /**
   * Controls how strongly the speaker's vocal identity is applied.
   * Uses an extra forward pass per denoising step to amplify identity features.
   * Range: 0-10. Default: 3.0. Set to 0 to disable (skips extra forward pass).
   * Only used when referenceAudioIdentity is provided.
   */
  audioIdentityStrength?: number;
  /**
   * Audio start position in seconds for audio-driven workflows (s2v, ia2v, a2v).
   * Specifies where to begin reading from the audio file.
   * Default: 0
   */
  audioStart?: number;
  /**
   * Audio duration in seconds for audio-driven workflows (s2v, ia2v, a2v).
   * Specifies how many seconds of audio to use.
   * If not provided, defaults to 30 seconds on the server.
   */
  audioDuration?: number;
  /**
   * Reference video for animate and v2v (ControlNet) workflows.
   * Maps to: drivingVideo (animate-move), sourceVideo (animate-replace), referenceVideo (v2v)
   */
  referenceVideo?: InputMedia;
  /**
   * Seedance-only video context references. These must be publicly accessible
   * HTTPS URLs and map to Seedance reference_video assets.
   */
  referenceVideoUrls?: string[];
  /**
   * ControlNet parameters for LTX-2.3 v2v workflows.
   * Specifies which control signal to extract from the reference video.
   */
  controlNet?: VideoControlNetParams;
  /**
   * Detailer LoRA strength for LTX-2.3 v2v IC-Control workflows.
   * The detailer LoRA is always loaded alongside the control LoRA (canny/pose/depth).
   * Range: 0.0-1.0, default 0.6.
   */
  detailerStrength?: number;
  /**
   * Video start position in seconds for animate workflows (animate-move, animate-replace).
   * Specifies where to begin reading from the reference video file.
   * Default: 0
   */
  videoStart?: number;
  /**
   * Trim the last frame from the generated video.
   * Used for seamless stitching of transition videos where the last frame
   * duplicates the end reference image.
   * Default: false
   */
  trimEndFrame?: boolean;
  /**
   * Output video width. Only used if `sizePreset` is "custom"
   */
  width?: number;
  /**
   * Output video height. Only used if `sizePreset` is "custom"
   */
  height?: number;
  /**
   * Sampler, available options depend on the model. Use `sogni.projects.getModelOptions(modelId)`
   * to get the list of available samplers.
   */
  sampler?: string;
  /**
   * Scheduler, available options depend on the model. Use `sogni.projects.getModelOptions(modelId)`
   * to get the list of available schedulers.
   */
  scheduler?: string;
  /**
   * First frame strength for LTX-2.3 keyframe interpolation (when referenceImageEnd is provided).
   * Controls how strictly the first frame is matched.
   * Range: 0.0-1.0, default 0.6. Set to 0 to disable first frame (last-frame-only mode).
   */
  firstFrameStrength?: number;
  /**
   * Last frame strength for LTX-2.3 keyframe interpolation (when referenceImageEnd is provided).
   * Controls how strictly the last frame is matched.
   * Range: 0.0-1.0, default 0.6.
   */
  lastFrameStrength?: number;
  /**
   * Output video format. For now only 'mp4' is supported, defaults to 'mp4'.
   */
  outputFormat?: VideoOutputFormat;
  /**
   * SAM2 click coordinates for subject detection in animate-replace workflows.
   * Array of {x, y} coordinate objects indicating where the subject is located
   * in the reference image.
   *
   * Coordinates can be normalized (0.0-1.0) or absolute pixel values.
   * Normalized coordinates are automatically converted to pixel values by the server.
   * If not provided, the server defaults to the center of the frame.
   *
   * Example: [{ x: 0.5, y: 0.5 }] for center of frame
   */
  sam2Coordinates?: Array<{ x: number; y: number }>;
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
   * Flux.2 Dev supports up to 6 context images.
   * Qwen Image Edit Plus supports up to 3 context images.
   * Flux Kontext supports up to 2 context images.
   */
  contextImages?: InputMedia[];
  /**
   * Sampler, available options depend on the model. Use `sogni.projects.getModelOptions(modelId)`
   * to get the list of available samplers.
   */
  sampler?: string;
  /**
   * Scheduler, available options depend on the model. Use `sogni.projects.getModelOptions(modelId)`
   * to get the list of available schedulers.
   */
  scheduler?: string;
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
  /**
   * GPT Image 2 quality preset. Only used by external OpenAI image models.
   * Defaults to 'medium'.
   */
  gptImageQuality?: GptImageQuality;
  /**
   * GPT Image 2 background mode. Only used by external OpenAI image models.
   */
  gptImageBackground?: GptImageBackground;
}

export interface AudioProjectParams extends BaseProjectParams {
  type: 'audio';
  /**
   * Duration of the audio in seconds (10-600, default: 30)
   */
  duration?: number;
  /**
   * Beats per minute (30-300, default: 120)
   */
  bpm?: number;
  /**
   * Time signature (2, 3, 4, or 6 - default: 4)
   */
  timesignature?: string;
  /**
   * Lyrics language code (default: en)
   */
  language?: string;
  /**
   * Song lyrics. Omit for instrumental generation.
   */
  lyrics?: string;
  /**
   * Key/scale setting (e.g., "C major", "A minor"). Omitted to use server default.
   */
  keyscale?: string;
  /**
   * Enable AI composer mode for higher quality music generation (default: true).
   * Disable for faster generation or when using reference audio.
   * Maps to generate_audio_codes in the ComfyUI workflow.
   */
  composerMode?: boolean;
  /**
   * How closely the AI composer follows your prompt (0-10, default: 2.0).
   * Higher values = stricter prompt adherence.
   * Maps to cfg_scale in the ComfyUI workflow.
   */
  promptStrength?: number;
  /**
   * Composition variation / temperature (0-2, default: 0.85).
   * Higher = more creative, lower = more predictable.
   * Maps to temperature in the ComfyUI workflow.
   */
  creativity?: number;
  /**
   * Shift parameter for ModelSamplingAuraFlow (1-6, default: 3 for turbo).
   * Controls how denoising effort is distributed across generation steps.
   * Higher values front-load structure/composition, producing more coherent arrangements.
   * Lower values distribute effort evenly, focusing more on detail/texture.
   * Official ComfyUI template uses shift=3 for ACE-Step 1.5 Turbo.
   */
  shift?: number;
  /**
   * Sampler, available options depend on the model.
   */
  sampler?: string;
  /**
   * Scheduler, available options depend on the model.
   */
  scheduler?: string;
  /**
   * Output audio format. Can be 'mp3', 'flac', or 'wav'. Defaults to 'mp3'.
   */
  outputFormat?: AudioOutputFormat;
}

export type ProjectParams = ImageProjectParams | VideoProjectParams | AudioProjectParams;

export function isVideoParams(params: ProjectParams): params is VideoProjectParams {
  return params.type === 'video';
}

export function isImageParams(params: ProjectParams): params is ImageProjectParams {
  return params.type === 'image';
}

export function isAudioParams(params: ProjectParams): params is AudioProjectParams {
  return params.type === 'audio';
}

/**
 * Supported audio formats
 */
export type AudioFormat = 'm4a' | 'mp3' | 'wav' | 'flac';

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
    | 'contextImage4'
    | 'contextImage5'
    | 'contextImage6'
    | 'referenceImage'
    | 'referenceImageEnd';
  startContentType?: string;
  contentType?: string;
};

/**
 * Parameters for media asset URL requests (video/audio upload/download)
 */
export type MediaUrlParams = {
  id?: string;
  jobId: string;
  type: 'complete' | 'preview' | 'referenceAudio' | 'referenceVideo';
  contentType?: string;
};

export interface EstimateRequest {
  /**
   * Network to use. Can be 'fast' or 'relaxed'
   * @default 'fast'
   */
  network?: SupernetType;
  /**
   * Token type
   * @default 'sogni'
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
  sampler?: string;
  /**
   * Number of context images to use (for Flux Kontext).
   * Note that this parameter is ignored if `scheduler` is not provided
   */
  contextImages?: number;
  /**
   * GPT Image 2 quality preset, when estimating external OpenAI image jobs.
   */
  gptImageQuality?: GptImageQuality;
  /**
   * Output format, when estimating models with format-specific request metadata.
   */
  outputFormat?: ImageOutputFormat;
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
  steps?: number;
  numberOfMedia: number;
  /**
   * Price Seedance estimates using the video-input rate band.
   */
  hasVideoInput?: boolean;
  /**
   * Optional estimate-only signal: presence implies Seedance video-input pricing.
   */
  referenceVideo?: unknown;
  /**
   * Optional estimate-only signal: non-empty list implies Seedance video-input pricing.
   */
  referenceVideoUrls?: string[];
}

export interface AudioEstimateRequest {
  tokenType: TokenType;
  model: string;
  duration: number;
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
 * Video workflow types for WAN, LTX-2.3, and Seedance models
 */
export type VideoWorkflowType =
  | 't2v'
  | 'i2v'
  | 's2v'
  | 'ia2v'
  | 'a2v'
  | 'v2v'
  | 'animate-move'
  | 'animate-replace'
  | null;

export type AssetRequirement = 'required' | 'optional' | 'forbidden';

export type VideoAssetKey =
  | 'referenceImage'
  | 'referenceImageEnd'
  | 'referenceAudio'
  | 'referenceAudioIdentity'
  | 'referenceVideo';
