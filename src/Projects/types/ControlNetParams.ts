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
 * Video control model names for LTX 2.5/2.3 and MiniMax H3 Control workflows.
 * Each workflow accepts its own subset of these names.
 * @inline
 */
export type VideoControlNetName =
  | 'canny'
  | 'pose'
  | 'depth'
  | 'detailer'
  | 'outpaint'
  | 'inpaint'
  | 'hed'
  | 'mlsd';

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
  /**
   * Sent only as `true`: the worker makes the control map from the uploaded image.
   * Omitted: the uploaded image is the control map.
   */
  preprocess?: true;
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
  /**
   * Make the control map from `image` on the worker. Default `false`.
   *
   * - `true`: `image` is an ordinary photo. The worker generates the control map that matches `name`
   *   from it (edges for `canny`, a depth map for `depth`, a pose skeleton for `openpose`, and so on).
   *   Use this for ordinary photos.
   * - `false` or omitted: `image` is used as the control map as-is, exactly as before this option existed.
   *   Use this for ready-made depth maps, pose skeletons, edge maps and scribbles.
   *
   * Only affects the Stable Diffusion ControlNet types. InstantID always uses the face photo as given,
   * and `inpaint` / `instrp2p` always use the image as given.
   */
  preprocess?: boolean;
}

/**
 * Raw Video ControlNet parameters passed to the API
 */
export interface VideoControlNetParamsRaw {
  name: VideoControlNetName;
  controlStrength?: number;
  preprocess?: boolean;
  controlGuidanceStart?: number;
  controlGuidanceEnd?: number;
}

/**
 * Video control parameters for LTX 2.5/2.3 and MiniMax H3 Control workflows.
 * MiniMax H3 Control also accepts prepared maps via `controlVideo`.
 */
export interface VideoControlNetParams {
  /**
   * ControlNet type specifying which control signal to extract from the reference video.
   * - 'canny': Edge detection-based control
   * - 'pose': Body pose detection. Requires `referenceImage` as well as `referenceVideo`:
   *   the image supplies the subject's appearance and the video supplies the motion.
   * - 'depth': Depth estimation
   * - 'detailer': Quality enhancement
   * - 'outpaint': Extend the reference video's canvas. Positional, driven by
   *   `outpaintPosition` (plus width/height).
   * - 'inpaint': Regenerate a masked region of the reference video (requires `referenceMask`)
   *
   * MiniMax H3 Control accepts canny, depth, pose, hed, mlsd and inpaint, and runs
   * depth when `controlNet` is omitted. Any of them can take a mask
   * (`referenceMask` or `referenceMaskVideo`); inpaint requires one.
   */
  name: VideoControlNetName;
  /**
   * Control strength. Higher values follow the control signal more strictly.
   * LTX range: 0.0-1.0, default 0.85. MiniMax H3 Control range: 0.0-1.0, default 1.
   * For canny/depth: controls how strongly the preprocessor output (edges/depth maps)
   * is injected into the generation. For pose: controls pose adherence.
   * For detailer: controls appearance preservation.
   */
  strength?: number;
  /**
   * MiniMax H3 Control only; other models ignore it. Whether the worker extracts
   * the map from `referenceVideo` (canny, depth, pose, hed and mlsd). Omitted, it
   * extracts unless `controlVideo` is set; `false` reads `referenceVideo` as a
   * prepared map.
   */
  preprocess?: boolean;
  /** MiniMax H3 Control only; other models ignore it. Fraction of sampling where guidance starts, 0-1 (default 0). */
  guidanceStart?: number;
  /** MiniMax H3 Control only; other models ignore it. Fraction of sampling where guidance ends, 0-1 (default 1). */
  guidanceEnd?: number;
}
