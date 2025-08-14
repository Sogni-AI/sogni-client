import { SupernetType } from '../../ApiClient/WebSocketClient/types';
import { ControlNetParams } from './ControlNetParams';
import { TokenType } from '../../types/token';

export interface SupportedModel {
  id: string;
  name: string;
  SID: number;
}

export interface AvailableModel {
  id: string;
  name: string;
  workerCount: number;
}

export interface SizePreset {
  label: string;
  id: string;
  width: number;
  height: number;
  ratio: string;
  aspect: string;
}

export type Scheduler =
  | 'DPM Solver Multistep (DPM-Solver++)'
  | 'PNDM (Pseudo-linear multi-step)'
  | 'LCM (Latent Consistency Model)'
  | 'Discrete Flow Scheduler (SD3)'
  | 'Euler' // Used by Flux
  | 'Euler a'; // Used by Flux

export type TimeStepSpacing = 'Leading' | 'Linear' | 'Karras' | 'Simple' | 'SGM Uniform';

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
  /**
   * Generate images based on the starting image.
   * Supported types:
   * `File` - file object from input[type=file]
   * `Buffer` - Node.js buffer object with image data
   * `Blob` - blob object with image data
   * `true` - indicates that the image is already uploaded to the server
   */
  startingImage?: File | Buffer | Blob | boolean;
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
}

export type EnhancementStrength = 'light' | 'medium' | 'heavy';
