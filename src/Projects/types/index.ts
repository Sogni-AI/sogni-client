import { SupernetType } from '../../ApiClient/WebSocketClient/types';

export interface AvailableModel {
  id: string;
  name: string;
  workerCount: number;
}

export interface AiModel {
  isSD3: boolean;
  modelShortName: string;
  isIOSslowest: boolean;
  hasOriginalVersionOnly: boolean;
  isUserModel: boolean;
  isTurboXL: boolean;
  isRealistic: boolean;
  isArtistic: boolean;
  tier: string;
  splitAttentionSuffix: string;
  isSD3XL: boolean;
  originalAttentionSuffix: string;
  isLCM: boolean;
  zipWeight: number;
  modelId: string;
  modelVersion: string;
  parentId: string;
  quantized: boolean;
  isXL: boolean;
  splitAttentionV2Suffix: string;
  supportsAttentionV2: boolean;
  supportsControlNet: boolean;
  supportsEncoder: boolean;
  onlySplitEinsumV2available: boolean;
  customSize?: number[];
}

export type Scheduler =
  | 'DPM Solver Multistep (DPM-Solver++)'
  | 'PNDM (Pseudo-linear multi-step)'
  | 'LCM (Latent Consistency Model)'
  | 'Discrete Flow Scheduler (SD3)'
  | 'Euler'; // Used by Flux

export type TimeStepSpacing = 'Karras' | 'Leading' | 'Linear';

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
  /**
   * Generate images based on starting image.
   * `File` - file object from input[type=file]
   * `Buffer` - buffer object with image data
   * `Blob` - blob object with image data
   */
  startingImage?: File | Buffer | Blob;
  /**
   * How strong effect of starting image should be. From 0 to 1, default 0.5
   */
  startingImageStrength?: number;
  /**
   * Number of previews to generate. Note that previews affect project cost\
   */
  numberOfPreviews?: number;
  /**
   * Scheduler to use
   */
  scheduler?: Scheduler;
  /**
   * Time step spacing method
   */
  timeStepSpacing?: TimeStepSpacing;
}

export type ImageUrlParams = {
  imageId: string;
  jobId: string;
  type: 'preview' | 'complete' | 'startingImage' | 'cnImage';
  // This seems to be unused currently
  startContentType?: string;
};

export interface EstimateRequest {
  /**
   * Network to use. Can be 'fast' or 'relaxed'
   */
  network: SupernetType;
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
}
