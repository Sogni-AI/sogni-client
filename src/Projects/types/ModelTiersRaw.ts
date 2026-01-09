export type ModelTiersRaw = Record<string, ModelTier>;

export type ModelTier = ImageTier | VideoTier | ComfyImageTier;

export interface ComfyImageTier {
  benchmark: Benchmark;
  comfySampler: StringDefaults;
  comfyScheduler?: StringDefaults;
  defaultSize: number;
  guidance: NumericDefaults;
  steps: NumericDefaults;
  type: 'image';
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
  guidance: NumericDefaults;
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
  audioDuration?: DurationDefaults;
  audioStart?: DurationDefaults;
  benchmark: Benchmark;
  comfySampler: StringDefaults;
  comfyScheduler: StringDefaults;
  fps: NumericOptions;
  frames: NumericDefaults;
  guidance: NumericDefaults;
  height: NumericDefaults;
  shift: NumericDefaults;
  steps: NumericDefaults;
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

export default ModelTiersRaw;
