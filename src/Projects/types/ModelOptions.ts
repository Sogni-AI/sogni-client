import {
  AudioTier,
  ComfyImageTier,
  ImageTier,
  NumericDefaults,
  VideoTier
} from './ModelTiersRaw.js';
import { samplerValueToAlias } from '../utils/samplers.js';
import { schedulerValueToAlias } from '../utils/scheduler.js';

interface NumRange {
  min: number;
  max: number;
  step: number;
  default: number;
}

interface Options<T> {
  allowed: T[];
  default: T | null;
}

interface NumOptions {
  options: number[];
  default: number;
}

export interface ImageModelOptions {
  type: 'image';
  steps: NumRange;
  guidance?: NumRange;
  scheduler: Options<string>;
  sampler: Options<string>;
  vae?: Options<string>;
}

export interface VideoModelOptions {
  type: 'video';
  task?: 'video-upscale';
  outputResolutions?: number[];
  preservesSourceTiming?: boolean;
  requiresReferenceVideo?: boolean;
  /** Server-advertised horizontal pixel range and grid. */
  width: NumRange;
  /** Server-advertised vertical pixel range and grid. */
  height: NumRange;
  /** Maximum total output pixels, when the model defines an area budget. */
  maxPixels?: number;
  steps?: NumRange;
  guidance?: NumRange;
  fps?: Options<number>;
  sampler: Options<string>;
  scheduler: Options<string>;
}

export interface AudioModelOptions {
  type: 'audio';
  steps: NumRange;
  guidance?: NumRange;
  /** Music only. Speech models have no diffusion sampler. */
  sampler?: Options<string>;
  /** Music only. Speech models have no diffusion scheduler. */
  scheduler?: Options<string>;
  /** Music only. A speech render is as long as the script takes to read. */
  duration?: NumRange;
  /** Music only. */
  bpm?: NumRange;
  /** Music only. */
  timesignature?: Options<string>;
  language?: Options<string>;
  keyscale?: Options<string>;
  composerMode?: { default: boolean };
  promptStrength?: NumRange;
  creativity?: NumRange;
  shift?: NumRange;
  /** Speech only. The preset voices this model can speak in. */
  speaker?: Options<string>;
  /** Speech only. Maximum length of the delivery direction, and whether it is required. */
  instruct?: { maxLength: number; required: boolean };
  /** Speech only. Maximum length of the reference recording's transcript. */
  referenceText?: { maxLength: number };
  /** Speech only. Whether a reference recording may be uploaded. */
  acceptsReferenceAudio?: boolean;
  /** Speech only. Whether a reference recording is mandatory (voice cloning). */
  requiresReferenceAudio?: boolean;
}

export type ModelOptions = ImageModelOptions | VideoModelOptions | AudioModelOptions;

function mapRange(data: NumericDefaults): NumRange {
  return {
    min: data.min,
    max: data.max,
    step: data.decimals ? Math.pow(10, 0 - data.decimals) : data.step || 1,
    default: data.default
  };
}

function mapOptions<T>(data: Options<T> | undefined, mapper = (value: T) => value): Options<T> {
  if (!data) {
    return {
      allowed: [],
      default: null
    };
  }
  return {
    allowed: data.allowed.map(mapper),
    default: data.default !== null ? mapper(data.default) : null
  };
}

export function mapImageTier(tier: ImageTier): ImageModelOptions {
  const options: ImageModelOptions = {
    type: 'image',
    steps: mapRange(tier.steps),
    scheduler: mapOptions(tier.scheduler, schedulerValueToAlias),
    sampler: mapOptions(tier.sampler, samplerValueToAlias)
  };
  // Mirrors mapComfyImageTier: guidance is absent on promptless tiers, and
  // mapRange would throw reading `.min` off undefined. `isImageTier` claims
  // every tier with no `type`, so anything sparse the Supernet serves lands
  // here and would otherwise crash getModelOptions - which projects.create()
  // calls on every project.
  if (tier.guidance) {
    options.guidance = mapRange(tier.guidance);
  }
  return options;
}

export function mapComfyImageTier(tier: ComfyImageTier): ImageModelOptions {
  const options: ImageModelOptions = {
    type: 'image',
    steps: mapRange(tier.steps),
    scheduler: mapOptions(tier.comfyScheduler, schedulerValueToAlias),
    sampler: mapOptions(tier.comfySampler, samplerValueToAlias),
    vae: tier.vae ? mapOptions(tier.vae) : undefined
  };
  if (tier.guidance) {
    options.guidance = mapRange(tier.guidance);
  }
  return options;
}

export function mapVideoTier(tier: VideoTier): VideoModelOptions {
  const options: VideoModelOptions = {
    type: 'video',
    width: mapRange(tier.width),
    height: mapRange(tier.height),
    scheduler: mapOptions(tier.comfyScheduler, schedulerValueToAlias),
    sampler: mapOptions(tier.comfySampler, samplerValueToAlias)
  };
  if (tier.task !== undefined) options.task = tier.task;
  if (tier.outputResolutions !== undefined) options.outputResolutions = [...tier.outputResolutions];
  if (tier.preservesSourceTiming !== undefined)
    options.preservesSourceTiming = tier.preservesSourceTiming;
  if (tier.requiresReferenceVideo !== undefined)
    options.requiresReferenceVideo = tier.requiresReferenceVideo;
  if (tier.maxPixels !== undefined) {
    options.maxPixels = tier.maxPixels;
  }
  if (tier.steps) {
    options.steps = mapRange(tier.steps);
  }
  if (tier.guidance) {
    options.guidance = mapRange(tier.guidance);
  }
  if (tier.fps) {
    options.fps = tier.fps;
  }
  return options;
}

export function mapAudioTier(tier: AudioTier): AudioModelOptions {
  // `steps` is the only control both music and speech always declare. Everything
  // else is set below when the tier declares it, so a speech model does not
  // advertise a tempo or a sampler it will refuse, and a music tier keeps
  // exactly the fields it had before speech existed.
  const options: AudioModelOptions = {
    type: 'audio',
    steps: mapRange(tier.steps)
  };
  if (tier.comfySampler) {
    options.sampler = mapOptions(tier.comfySampler, samplerValueToAlias);
  }
  if (tier.comfyScheduler) {
    options.scheduler = mapOptions(tier.comfyScheduler, schedulerValueToAlias);
  }
  if (tier.duration) {
    options.duration = mapRange(tier.duration);
  }
  if (tier.bpm) {
    options.bpm = mapRange(tier.bpm);
  }
  if (tier.timesignature) {
    options.timesignature = mapOptions(tier.timesignature);
  }
  if (tier.speaker) {
    options.speaker = mapOptions(tier.speaker);
  }
  if (tier.instruct) {
    options.instruct = {
      maxLength: tier.instruct.maxLength,
      required: tier.instruct.required === true
    };
  }
  if (tier.referenceText) {
    options.referenceText = { maxLength: tier.referenceText.maxLength };
  }
  if (tier.acceptInputAudio) {
    options.acceptsReferenceAudio = true;
  }
  if (tier.requiresReferenceAudio) {
    options.acceptsReferenceAudio = true;
    options.requiresReferenceAudio = true;
  }
  if (tier.guidance) {
    options.guidance = mapRange(tier.guidance);
  }
  if (tier.bpm) {
    options.bpm = mapRange(tier.bpm);
  }
  if (tier.timesignature) {
    options.timesignature = mapOptions(tier.timesignature);
  }
  if (tier.language) {
    options.language = mapOptions(tier.language);
  }
  if (tier.keyscale) {
    options.keyscale = mapOptions(tier.keyscale);
  }
  if (tier.composerMode) {
    options.composerMode = { default: tier.composerMode.default };
  }
  if (tier.promptStrength) {
    options.promptStrength = mapRange(tier.promptStrength);
  }
  if (tier.creativity) {
    options.creativity = mapRange(tier.creativity);
  }
  if (tier.shift) {
    options.shift = mapRange(tier.shift);
  }
  return options;
}
