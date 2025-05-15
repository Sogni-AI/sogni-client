/**
 * ControlNet model names
 * @inline
 */
export type ControlNetName =
  | 'canny'
  | 'depth'
  | 'inpaint'
  | 'instrp2p'
  | 'lineart'
  | 'lineartanime'
  | 'mlsd'
  | 'normalbae'
  | 'openpose'
  | 'scribble'
  | 'segmentation'
  | 'shuffle'
  | 'softedge'
  | 'tile'
  | 'instantid';

/**
 * Raw ControlNet parameters passed to the API
 */
export interface ControlNetParamsRaw {
  name: ControlNetName;
  mlmodelc?: string;
  cnImageState: 'original';
  hasImage: boolean;
  controlStrength?: number;
  /**
   * 0 = "Balanced": (default) balanced, no preference between prompt and control model
   * 1 = "My prompt is more important": the prompt has more impact than the model
   * 2 = "ControlNet is more important": the controlnet model has more impact than the prompt
   */
  controlMode?: 0 | 1 | 2;
  controlGuidanceStart?: number;
  controlGuidanceEnd?: number;
}

/**
 * ControlNet mode
 * @inline
 */
export type ControlNetMode = 'balanced' | 'prompt_priority' | 'cn_priority';

/**
 * ControlNet parameters
 */
export interface ControlNetParams {
  /**
   * Short name of the ControlNet model
   */
  name: ControlNetName;
  /**
   * ControlNet input image
   * Supported types:
   * `File` - file object from input[type=file]
   * `Buffer` - Node.js buffer object with image data
   * `Blob` - blob object with image data
   * `true` - indicates that the image is already uploaded to the server
   */
  image?: File | Buffer | Blob | boolean;
  /**
   * ControlNet strength 0 to 1. 0 full control to prompt, 1 full control to ControlNet
   */
  strength?: number;
  /**
   * How control and prompt should be weighted
   * 'balanced' (default) balanced, no preference between prompt and control model
   * 'prompt_priority' the prompt has more impact than the model
   * 'cn_priority' the controlnet model has more impact than the prompt
   */
  mode?: ControlNetMode;
  /**
   * Step when ControlNet first applied, 0 means first step, 1 means last step.
   * Must be less than guidanceEnd
   */
  guidanceStart?: number;
  /**
   * Step when ControlNet last applied, 0 means first step, 1 means last step.
   * Must be greater than guidanceStart
   */
  guidanceEnd?: number;
}
