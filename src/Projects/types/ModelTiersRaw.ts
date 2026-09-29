export type ModelTiersRaw = Record<string, ModelTier>;

export type ModelTier = ImageTier | VideoTier | ComfyImageTier | AudioTier;

export interface ComfyImageTier {
  benchmark: Benchmark;
  comfySampler: StringDefaults;
  comfyScheduler?: StringDefaults;
  defaultSize: number;
  guidance?: NumericDefaults;
  steps: NumericDefaults;
  type: 'image';
  vae?: StringDefaults;
}

export function isComfyImageTier(t: ModelTier): t is ComfyImageTier {
  return 'type' in t && t.type === 'image';
}

export interface StringDefaults {
  allowed: string[];
  default: string;
}

export interface NumericDefaults {
  min: number;
  max: number;
  decimals?: number;
  default: number;
  step?: number;
}

export interface ImageTier {
  benchmark: Benchmark;
  /**
   * Optional: promptless tiers advertise no guidance range. Matches
   * ComfyImageTier, and keeps `mapImageTier` from reading `.min` off
   * `undefined` when the Supernet serves a sparse tier.
   */
  guidance?: NumericDefaults;
  modelFeeUSD?: number;
  nickname?: string;
  scheduler: StringDefaults;
  steps: NumericDefaults;
  sampler: StringDefaults;
}

export function isImageTier(t: ModelTier): t is ImageTier {
  return !Object.prototype.hasOwnProperty.call(t, 'type');
}

export interface Benchmark {
  sec: number;
  secContext1?: number;
  secContext2?: number;
  secContext3?: number;
  secCN: number;
  secMaxPreviews: number;
}

export interface VideoTier {
  task?: 'video-upscale';
  outputResolutions?: number[];
  preservesSourceTiming?: boolean;
  requiresReferenceVideo?: boolean;
  audioDuration?: DurationDefaults;
  audioStart?: DurationDefaults;
  benchmark: Benchmark;
  comfySampler?: StringDefaults;
  comfyScheduler?: StringDefaults;
  fps?: NumericOptions;
  frames?: NumericDefaults;
  guidance?: NumericDefaults;
  height: NumericDefaults;
  maxPixels?: number;
  shift?: NumericDefaults;
  steps?: NumericDefaults;
  type: 'video';
  videoStart?: DurationDefaults;
  width: NumericDefaults;
}

export function isVideoTier(t: ModelTier): t is VideoTier {
  return 'type' in t && t.type === 'video';
}

export interface DurationDefaults {
  min: number;
  default: number;
}

export interface NumericOptions {
  allowed: number[];
  default: number;
}

export interface BooleanDefault {
  default: boolean;
}

/**
 * An audio model tier.
 *
 * Music and speech share this shape but use disjoint halves of it. A music
 * model composes for a requested duration with a diffusion sampler; a speech
 * model reads a script for however long the words take and has no sampler, no
 * step count and no tempo. Everything either family lacks is optional here, so
 * a tier declares only the controls its model can actually honour.
 */
export interface AudioTier {
  benchmark: Benchmark;
  bpm?: NumericDefaults;
  comfySampler?: StringDefaults;
  comfyScheduler?: StringDefaults;
  composerMode?: BooleanDefault;
  creativity?: NumericDefaults;
  duration?: NumericDefaults;
  guidance?: NumericDefaults;
  keyscale?: StringDefaults;
  language?: StringDefaults;
  promptStrength?: NumericDefaults;
  shift?: NumericDefaults;
  steps: NumericDefaults;
  timesignature?: StringDefaults;
  type: 'audio';
  /** Speech: the preset voices this model can speak in. */
  speaker?: StringDefaults;
  /** Speech: whether the model takes a written direction for the delivery. */
  instruct?: { maxLength: number; required?: boolean; description?: string };
  /** Speech: whether the model takes a transcript of the reference recording. */
  referenceText?: { maxLength: number; description?: string };
  /** Speech: whether a reference recording may be uploaded. */
  acceptInputAudio?: boolean;
  /** Speech: whether a reference recording is mandatory (voice cloning). */
  requiresReferenceAudio?: boolean;
}

export function isAudioTier(t: ModelTier): t is AudioTier {
  return 'type' in t && t.type === 'audio';
}

export default ModelTiersRaw;
