import { SupernetType } from '../../ApiClient/WebSocketClient/types.js';
import { ControlNetParams, VideoControlNetParams } from './ControlNetParams.js';
import { TokenType } from '../../types/token.js';
import type { WorkloadAttributionInput } from '../../types/attribution.js';

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
export type GptImageQuality = 'low' | 'medium' | 'high' | 'auto' | 'standard' | 'hd';
export type GptImageBackground = 'opaque' | 'auto';
export type VideoOutputFormat = 'mp4';
export type AudioOutputFormat = 'mp3' | 'flac' | 'wav';
export type BillingMode = 'auto' | 'subscription' | 'tokens';

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
   * Wan Animate 2 is fixed at 10.
   */
  steps?: number;
  /**
   * Guidance scale. For most Stable Diffusion models, optimal value is 7.5.
   * For video models: Regular models range 0.7-8.0, LoRA version (lightx2v) range 0.7-1.6, step 0.01.
   * Wan Animate 2 is fixed at 1.
   * This maps to `guidanceScale` in the keyFrame for both image and video models.
   */
  guidance?: number;
  /**
   * Override current network type. Default value can be read from `sogni.account.currentAccount.network`
   */
  network?: SupernetType;
  /** Requested content-filter policy. The server remains authoritative. */
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
   * Select how eligible jobs should be billed.
   * - auto: use Unlimited subscription coverage when available, otherwise use tokens.
   * - subscription: require Unlimited subscription coverage; fail if unavailable.
   * - tokens: opt out of Unlimited coverage and use Spark/SOGNI tokens.
   */
  billingMode?: BillingMode;
  /**
   * Optional client app/source label to attach to the project request for server-side attribution.
   */
  appSource?: string;
  /**
   * Optional workload attribution for this project. Fields override the
   * immutable defaults configured on SogniClient.
   */
  attribution?: WorkloadAttributionInput;
  /**
   * LoRA IDs to apply, in the order they should be chained.
   *
   * Which LoRAs are available depends on the model; the Krea 2 family carries
   * the largest set. Workers download a LoRA on first use, so the first render
   * with an uncached one takes longer to start.
   *
   * Order is significant. The LoRAs are applied in sequence and the same set in
   * a different order produces a measurably different image, because these
   * models run fp8-quantized and the patches do not commute.
   *
   * Up to 8 per render. IDs are resolved to filenames by the worker.
   * Example: ['krea2-detail-enhancer', 'krea2-amateur']
   */
  loras?: string[];
  /**
   * Strength for each entry in `loras`, positionally matched. Defaults to 1.0.
   *
   * Not restricted to positive values. Most Krea 2 LoRAs are bipolar sliders
   * where a negative strength applies the inverse effect and 0 does nothing -
   * Warm Light warms at 2 and cools at -2. Each LoRA has its own valid range
   * and its author's recommended band; values outside the valid range are
   * clamped server-side, and pushing past the recommended band usually costs
   * detail rather than adding effect.
   *
   * Example: [3, -2]
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
 * ### Wan Animate 2 (`wan_animate_2-14b-distill-int8-convrot_animate-move`)
 * - Native motion transfer from a reference image plus raw driving video
 * - Fixed 1280x720 at 24fps with source audio retained
 * - 17-81 generated frames on a `1 + n*4` grid
 * - Fixed 10 steps, guidance 1, shift 5, Euler sampler, and simple scheduler
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
 * - Full tier supports up to 4K output; Fast caps at 720p
 * - Direct SDK project duration range is 4 to 15 seconds
 * - Frame count is calculated as: `duration * 24 + 1`
 * - Vendor reference limits are 9 images, 3 videos, 3 audios, and 12 asset files total
 *
 * ### HappyHorse 1.1 Models (happyhorse-1.1-*)
 * - External API-backed (Alibaba) video models with native audio
 * - `happyhorse-1.1-t2v` (text-to-video), `happyhorse-1.1-i2v` (single
 *   first-frame image-to-video), and `happyhorse-1.1-r2v` (1-9 reference
 *   images-to-video)
 * - Generate at fixed 24fps; output up to 720P/1080P
 * - Direct SDK project duration range is 3 to 15 seconds
 * - Frame count is calculated as: `duration * 24 + 1`
 * - Image-only reference context: no reference video or reference audio assets
 *
 * ### MiniMax H3 Models (minimax-h3-*)
 * - Text-to-video, first-frame image-to-video, first-and-last-frame video, and
 *   multi-reference video. Two checkpoints ship: FL2VA
 *   (`minimax-h3-fl2va-fp8_t2v` / `_i2v` / `_flf2v`) and Ref2VA
 *   (`minimax-h3-ref2va-fp8_r2v`).
 * - FL2VA Turbo adds `_turbo` to the t2v, i2v, and flf2v IDs. It uses a
 *   4-step distillation LoRA for about 3.5x faster iteration, with some loss of
 *   fine visual detail and audio polish. There is no Turbo Ref2VA workflow.
 * - Video and 32kHz stereo audio are generated jointly. Audio is included by
 *   default; set `generateAudio: false` to return a video without an audio track.
 * - Generation is fixed at 24fps and guidance 1, with no separate
 *   negative-prompt input. Standard H3 uses 20 steps and
 *   `res_multistep`/`simple`; Turbo uses its fixed 4-step sampling path.
 * - Frames follow `124 + n*17` from 124 through 362. Dimensions use a 32px
 *   grid, with a 1344px per-axis limit and a 1032192-pixel canvas limit.
 * - The `flf2v` model requires both `referenceImage` and `referenceImageEnd`.
 *
 * #### MiniMax H3 `r2v` (Ref2VA) multi-reference video
 * - `minimax-h3-ref2va-fp8_r2v` conditions on labelled reference material
 *   rather than on frame anchors. The checkpoint accepts up to 9 reference
 *   images, 3 reference videos (24fps, 2-15 seconds each), and 3 reference
 *   audio clips, with at most 12 reference files in total.
 * - All of those ceilings apply, and at least one visual reference (image or
 *   video) is required. Audio-only reference sets are rejected.
 * - r2v is the only reference workflow that runs on Sogni's own workers rather
 *   than at a vendor, so every reference is uploaded to S3 before the request is
 *   sent. Images use `referenceImage` plus `contextImages`; videos use
 *   `referenceVideo` plus `referenceVideos`; audio uses `referenceAudio` plus
 *   `referenceAudios`.
 * - Upload order is preserved, so a prompt ordinal refers to a predictable file.
 * - References are presented to the model in a fixed order - images, then
 *   videos (each video's own soundtrack immediately before it), then standalone
 *   audio - and are numbered from 1 per type. The H3 text encoder splices a
 *   literal label in front of each one before your prompt text
 *   (`comfy/text_encoders/minimax.py` emits `"<Picture %d>: "`, `"<Video %d>: "`
 *   and `"<Audio %d>: "`), so write the SAME form in the prompt - `<Picture 1>`,
 *   `<Video 1>`, `<Audio 1>`, angle brackets included - and the reference and
 *   the sentence about it share one token sequence. Prose aliases like "Image 1"
 *   or "the second photo" do not.
 * - Give every reference an explicit job, or the model averages them. Separate
 *   identity from style, motion from appearance, and voice character from
 *   spoken words, and state the priority when two references conflict: "Use
 *   `<Picture 1>` for the character's face and hairstyle. Use `<Picture 2>`
 *   only for environment and lighting. When `<Picture 1>` and `<Picture 2>`
 *   disagree, `<Picture 1>` wins."
 * - Reference resolution has a real cost/quality tradeoff. The workflow's
 *   `ref_image_size` is `match` by default, which scales references down to the
 *   generation pixel area. `max` uses a 2048px short edge for the best identity
 *   fidelity, but its reference tokens ride through every sampling step, making
 *   the render several times slower. `match` is what Sogni ships; `max` is not
 *   exposed as an SDK parameter.
 * - r2v has no frame anchors, so `referenceImageEnd` is rejected. There is no
 *   closing frame to pin.
 *
 * - See the repository's authoring examples:
 *   https://github.com/Sogni-AI/sogni-client/blob/alpha/examples/workflow_minimax_h3_video.mjs
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
   * 4 to 15 (Seedance direct SDK projects), 3 to 15 (HappyHorse direct SDK projects),
   * or 124/24 to 362/24 seconds (MiniMax H3).
   *
   * The SDK automatically calculates the correct frame count based on the model:
   * - WAN 2.2: `duration * 16 + 1` (always 16fps generation)
   * - Wan Animate 2: `duration * 24`, snapped to `1 + n*4` and clamped to 17-81
   * - LTX-2.3: `duration * fps + 1`, snapped to frame step constraint
   * - Seedance: `duration * 24 + 1`
   * - HappyHorse: `duration * 24 + 1`
   * - MiniMax H3: `duration * 24` snapped to the `124 + n*17` grid and clamped
   *   to 124-362 frames (always 24fps generation, and no `+1` term)
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
   *
   * **HappyHorse Models:** Fixed 24fps external API generation.
   *
   * **MiniMax H3 Models:** Fixed 24fps. Omit this field or pass 24.
   *
   * **Wan Animate 2:** Fixed 24fps. Omit this field or pass 24.
   */
  fps?: number;
  /**
   * Shift parameter for video diffusion models.
   * Controls motion intensity. Range: 1.0-8.0, step 0.1.
   * Default: 8.0 for regular models, 5.0 for speed lora (lightx2v) except s2v and animate which use 8.0
   * Wan Animate 2 is fixed at 5.
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
   *
   * On the MiniMax H3 `r2v` workflow (`minimax-h3-ref2va-fp8_r2v`) this is
   * reference image 1 (`<Picture 1>`) rather than a frame anchor, and it is
   * optional: the same slot can be filled from `contextImages` instead.
   */
  referenceImage?: InputMedia;
  /**
   * Loose image context references for Seedance and HappyHorse. These must be
   * publicly accessible HTTPS URLs and are handed to the external vendor. Use
   * referenceImage / referenceImageEnd when the
   * image should lock the first or last frame. HappyHorse r2v accepts 1-9
   * reference images here.
   *
   * MiniMax H3 r2v does not accept URL references; use `referenceImage` and
   * `contextImages`, which the SDK uploads through Sogni's asset path.
   */
  referenceImageUrls?: string[];
  /**
   * Uploaded reference images for the MiniMax H3 `r2v` multi-reference workflow
   * (`minimax-h3-ref2va-fp8_r2v`), in the order the model is shown them.
   *
   * This is the video counterpart of `ImageProjectParams.contextImages`, and it
   * uses the same `contextImage1`..`contextImage9` upload slots that Flux.2 and
   * Qwen Image Edit already use. It exists because H3 is Comfy-native: the
   * worker builds the ComfyUI graph locally from Sogni-hosted assets.
   *
   * The uploaded reference set is `[referenceImage, ...contextImages]`. Both
   * fields count against the same 9-image ceiling. Images are optional when at
   * least one reference video is supplied. Prompt ordinals follow that
   * order: with `referenceImage` set, `contextImages[0]` is `<Picture 2>`;
   * without it, `contextImages[0]` is `<Picture 1>`. Entries must not be empty -
   * a hole would renumber every reference after it.
   *
   * Any other video model rejects this field.
   */
  contextImages?: InputMedia[];
  /**
   * Optional end image for i2v interpolation workflows.
   * When provided with referenceImage, the video will interpolate between the two images.
   *
   * Required, together with `referenceImage`, for the MiniMax H3 `flf2v`
   * workflow (`minimax-h3-fl2va-fp8_flf2v`), which always interpolates between
   * two anchor frames.
   *
   * Rejected by the MiniMax H3 `r2v` workflow, which has no closing frame to
   * pin. Its second reference image is the next entry in `contextImages`.
   */
  referenceImageEnd?: InputMedia;
  /**
   * Reference audio for audio-driven video workflows (s2v, ia2v, a2v).
   *
   * On the MiniMax H3 `r2v` workflow this is standalone reference audio 1 - a
   * voice or soundtrack the prompt assigns a job to, not a track the video is
   * driven by. It is the first item in `[referenceAudio, ...referenceAudios]`.
   */
  referenceAudio?: InputMedia;
  /**
   * Additional uploaded standalone audio references for MiniMax H3 r2v.
   * Together with `referenceAudio`, at most three clips are accepted. Entries
   * are uploaded to distinct S3 objects and retain array order.
   */
  referenceAudios?: InputMedia[];
  /**
   * Audio context references for Seedance. These must be
   * publicly accessible HTTPS URLs. Seedance does not support text+audio-only
   * requests; include at least one image or video reference when using audio
   * URL references. MiniMax H3 r2v uses uploaded `referenceAudios` instead.
   */
  referenceAudioUrls?: string[];
  /**
   * Include the model's generated/native audio track when supported. Audio is
   * enabled by default; set to false to return a video without an audio track.
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
   *
   * On the MiniMax H3 `r2v` workflow this is reference video 1 (`<Video 1>`,
   * read as 24fps) that the prompt assigns a job to - camera movement,
   * blocking, or subject motion - rather than a source clip to transform. Its
   * own soundtrack is also presented to the model, numbered before any
   * standalone reference audio. It is the first item in
   * `[referenceVideo, ...referenceVideos]`.
   */
  referenceVideo?: InputMedia;
  /**
   * Additional uploaded video references for MiniMax H3 r2v. Together with
   * `referenceVideo`, at most three clips are accepted. Entries are uploaded to
   * distinct S3 objects and retain array order.
   */
  referenceVideos?: InputMedia[];
  /**
   * Inpaint mask IMAGE for LTX-2.3 v2v inpaint workflows.
   * White pixels mark the region to regenerate. Maps to jobKey 'referenceMask'.
   * Used by the 'inpaint' control type.
   */
  referenceMask?: InputMedia;
  /**
   * Video context references for Seedance. These must be
   * publicly accessible HTTPS URLs, and map to Seedance reference_video assets.
   * MiniMax H3 r2v uses uploaded `referenceVideos` instead.
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
  /** Optional pose/camera prompt for Wan Animate 2's driving-video conditioning. */
  posePrompt?: string;
  /** Wan Animate 2 pose-video conditioning strength. Range 0-10, default 1. */
  poseStrength?: number;
  /** Start of Wan Animate 2 pose conditioning as a fraction of sampling. Range 0-1. */
  poseStartPercent?: number;
  /** End of Wan Animate 2 pose conditioning as a fraction of sampling. Range 0-1. */
  poseEndPercent?: number;
  /** Wan Animate 2 identity/reference-image conditioning strength. Range 0-10, default 1. */
  referenceImageStrength?: number;
  /**
   * Trim the last frame from the generated video.
   * Used for seamless stitching of transition videos where the last frame
   * duplicates the end reference image.
   * Default: false
   */
  trimEndFrame?: boolean;
  /**
   * Output video width. Only used if `sizePreset` is "custom"
   * Wan Animate 2 is fixed at 1280.
   */
  width?: number;
  /**
   * Output video height. Only used if `sizePreset` is "custom"
   * Wan Animate 2 is fixed at 720.
   */
  height?: number;
  /**
   * Sampler, available options depend on the model. Use `sogni.projects.getModelOptions(modelId)`
   * to get the list of available samplers.
   * Wan Animate 2 is fixed to Euler (`euler`).
   */
  sampler?: string;
  /**
   * Scheduler, available options depend on the model. Use `sogni.projects.getModelOptions(modelId)`
   * to get the list of available schedulers.
   * Wan Animate 2 is fixed to `simple`.
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
  /**
   * Outpaint canvas anchor for LTX-2.3 v2v outpaint workflows.
   * Determines where the original frame is placed within the expanded canvas.
   * Default: 'center'.
   */
  outpaintPosition?: 'center' | 'top' | 'bottom' | 'left' | 'right';
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
   * GPT Image 2 supports up to 16 context images.
   * Flux.2 Dev supports up to 6 context images.
   * Qwen Image Edit supports up to 3 context images.
   * Krea 2 Identity Edit supports up to 2 context images.
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
   * VAE filename, available options depend on the model. Use `sogni.projects.getModelOptions(modelId)`
   * to get the list of available VAEs.
   */
  vae?: string;
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
    | 'contextImage7'
    | 'contextImage8'
    | 'contextImage9'
    | 'contextImage10'
    | 'contextImage11'
    | 'contextImage12'
    | 'contextImage13'
    | 'contextImage14'
    | 'contextImage15'
    | 'contextImage16'
    | 'referenceImage'
    | 'referenceImageEnd'
    | 'referenceMask';
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
   * Number of context images to use. Affects GPT Image 2 input-image pricing
   * and context-aware worker timing estimates.
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
 * Video workflow types for WAN, LTX-2.3, Seedance, HappyHorse, and MiniMax H3
 * models.
 * `r2v` (reference-to-video) is the multi-reference workflow shared by
 * HappyHorse (1-9 reference images fetched from `referenceImageUrls`) and
 * MiniMax H3 (`minimax-h3-ref2va-fp8_r2v`, uploaded images and/or videos, plus
 * optional audio). Because the two families do not take the same assets over
 * the same transport, resolve requirements with
 * `getVideoAssetRequirements(modelId)` instead of reading
 * `VIDEO_WORKFLOW_ASSETS.r2v` directly.
 * `flf2v` (first-and-last-frame-to-video) is the MiniMax H3 workflow that
 * interpolates between two required anchor images.
 */
export type VideoWorkflowType =
  | 't2v'
  | 'i2v'
  | 'flf2v'
  | 's2v'
  | 'ia2v'
  | 'a2v'
  | 'v2v'
  | 'r2v'
  | 'animate-move'
  | 'animate-replace'
  | null;

export type AssetRequirement = 'required' | 'optional' | 'forbidden';

export type VideoAssetKey =
  | 'referenceImage'
  | 'referenceImageEnd'
  | 'referenceAudio'
  | 'referenceAudioIdentity'
  | 'referenceVideo'
  | 'referenceMask';
