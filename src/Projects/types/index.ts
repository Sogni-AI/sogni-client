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

export interface ProjectParams {
  /* AI model ID */
  modelId: string;
  /* Text prompt */
  positivePrompt: string;
  /* Prompt for what to be avoided */
  negativePrompt: string;
  /* Image style prompt */
  stylePrompt: string;
  /* Number of steps */
  steps: number;
  /* Guidance scale */
  guidance: number;
  /* Seed for one of images in project. Other will get random seed*/
  seed: string;
  /* Number of images to generate */
  numberOfImages: number;
}

export type ImageUrlParams = {
  imageId: string;
  jobId: string;
  type: 'preview' | 'complete' | 'startingImage' | 'cnImage';
  // This seems to be unused currently
  startContentType?: string;
};

export interface EstimateRequest {
  network: SupernetType;
  model: string;
  imageCount: number;
  stepCount: number;
  previewCount: number;
  cnEnabled?: boolean;
  denoiseStrength?: number;
}
