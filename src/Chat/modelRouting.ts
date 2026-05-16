import { getVideoWorkflowType } from '../Projects/utils';

export { getVideoWorkflowType };

/**
 * Public SDK-local routing helpers. The validator surface is generated from
 * @sogni/creative-agent/src/backbone/reference/toolValidation.ts via
 * `npm run sync:hosted-tool-validation` and re-exported below so SDK
 * consumers do not need the private creative-agent package while still
 * inheriting the full validator (pattern auto-anchoring, bounds, oneOf/anyOf,
 * nested recursion, coercion, stripping).
 */

export type {
  HostedToolSchemaProperty,
  HostedToolSchema,
  HostedToolDefinition,
  ValidateHostedToolArgumentsOptions,
  HostedToolArgumentValidationResult,
  NormalizeHostedToolArgumentsResult
} from './hostedToolValidation.generated';
export {
  validateAndNormalizeHostedToolArguments,
  validateHostedToolArguments,
  assertHostedToolArguments
} from './hostedToolValidation.generated';

export type BackboneMediaType = 'image' | 'video' | 'audio';

export type VideoWorkflow =
  | 't2v'
  | 'i2v'
  | 's2v'
  | 'ia2v'
  | 'a2v'
  | 'v2v'
  | 'animate-move'
  | 'animate-replace';

export type VideoControlMode =
  | 'animate-move'
  | 'animate-replace'
  | 'seedance-v2v'
  | 'canny'
  | 'pose'
  | 'depth'
  | 'detailer';

export interface BackboneAvailableModel {
  id: string;
  media?: string;
  workerCount?: number;
}

export interface SelectBackboneModelInput {
  mediaType: BackboneMediaType;
  requestedModel?: string;
  workflows?: VideoWorkflow[];
  filter?: (modelId: string) => boolean;
  preferredModelIds?: string[];
}

export interface SelectedBackboneModel {
  modelId: string;
  model: BackboneAvailableModel;
  selectedBy: 'requestedModel' | 'preferredModel' | 'workerCount';
}

export const PREFERRED_MODEL_IDS = {
  image: {
    gptImage2: 'gpt-image-2',
    flux1Schnell: 'flux1-schnell-fp8',
    flux2: 'flux2_dev_fp8',
    chromaFlash: 'chroma-v.46-flash_fp8',
    zTurbo: 'z_image_turbo_bf16'
  },
  video: {
    t2v: 'ltx23-22b-fp8_t2v_distilled',
    i2v: 'ltx23-22b-fp8_i2v_distilled',
    a2v: 'ltx23-22b-fp8_a2v_distilled',
    ia2v: 'ltx23-22b-fp8_ia2v_distilled',
    s2v: 'wan_v2.2-14b-fp8_s2v_lightx2v',
    v2v: 'ltx23-22b-fp8_v2v_distilled',
    seedanceT2v: 'seedance-2-0',
    seedanceI2v: 'seedance-2-0',
    seedanceIa2v: 'seedance-2-0',
    seedanceFastT2v: 'seedance-2-0-fast',
    seedanceFastI2v: 'seedance-2-0-fast',
    seedanceV2v: 'seedance-2-0',
    animateMove: 'wan_v2.2-14b-fp8_animate-move_lightx2v',
    animateReplace: 'wan_v2.2-14b-fp8_animate-replace_lightx2v'
  },
  audio: {
    aceStepTurbo: 'ace_step_1.5_turbo',
    aceStepSft: 'ace_step_1.5_sft'
  }
} as const;

const GPT_IMAGE_MODEL_ALIASES = [
  'chatgpt',
  'chatgpt-image',
  'chat-gpt',
  'chat-gpt-image',
  'openai',
  'openai-image',
  'open-ai',
  'open-ai-image',
  'gpt',
  'gpt-image',
  'gpt2',
  'gpt-2',
  'gpt2-image',
  'gpt-2-image',
  'gptimage2',
  'gpt-image2',
  'gpt-image-2'
];

function normalizeSelectorKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

const IMAGE_MODEL_SELECTORS: Record<string, string> = {
  ...Object.fromEntries(
    GPT_IMAGE_MODEL_ALIASES.map((alias) => [alias, PREFERRED_MODEL_IDS.image.gptImage2])
  ),
  'z-turbo': 'z_image_turbo_bf16',
  'z-image': 'z_image_bf16',
  'chroma-v46-flash': 'chroma-v.46-flash_fp8',
  'chroma-detail': 'chroma-v48-detail-svd_fp8',
  'flux1-krea': 'flux1-krea-dev_fp8_scaled',
  flux2: PREFERRED_MODEL_IDS.image.flux2,
  'pony-v7': 'coreml-cyberrealisticPony_v7',
  'qwen-2512': 'qwen_image_2512_fp8',
  'qwen-2512-lightning': 'qwen_image_2512_fp8_lightning',
  'albedo-xl': 'coreml-albedobaseXL_v31Large',
  'animagine-xl': 'coreml-animagineXL40_v4Opt',
  'anima-pencil-xl': 'coreml-animaPencilXL_v500',
  'art-universe-xl': 'coreml-artUniverse_sdxlV60',
  'hyphoria-real': 'coreml-hyphoriaRealIllu_v05',
  'analog-madness-xl': 'coreml-analogMadnessSDXL_xl2',
  'cyberrealistic-xl': 'coreml-cyberrealisticXL_v60',
  'real-dream-xl': 'coreml-realDream_sdxlPony11',
  'faetastic-xl': 'coreml-sdxlFaetastic_v24',
  'zavychroma-xl': 'coreml-zavychromaxl_v80',
  'pony-faetality': 'coreml-ponyFaetality_v11',
  'dreamshaper-xl': 'coreml-DreamShaper-XL1-Alpha2'
};

const EDIT_IMAGE_MODEL_SELECTORS: Record<string, string> = {
  ...Object.fromEntries(
    GPT_IMAGE_MODEL_ALIASES.map((alias) => [alias, PREFERRED_MODEL_IDS.image.gptImage2])
  ),
  'qwen-lightning': 'qwen_image_edit_2511_fp8_lightning',
  qwen: 'qwen_image_edit_2511_fp8',
  flux2: PREFERRED_MODEL_IDS.image.flux2
};

const TEXT_VIDEO_MODEL_SELECTORS: Record<string, string> = {
  ltx23: PREFERRED_MODEL_IDS.video.t2v,
  wan22: 'wan_v2.2-14b-fp8_t2v_lightx2v',
  seedance2: PREFERRED_MODEL_IDS.video.seedanceT2v,
  'seedance2-fast': PREFERRED_MODEL_IDS.video.seedanceFastT2v
};

const IMAGE_VIDEO_MODEL_SELECTORS: Record<string, string> = {
  ltx23: PREFERRED_MODEL_IDS.video.i2v,
  wan22: 'wan_v2.2-14b-fp8_i2v_lightx2v',
  seedance2: PREFERRED_MODEL_IDS.video.seedanceI2v,
  'seedance2-fast': PREFERRED_MODEL_IDS.video.seedanceFastI2v
};

const VIDEO_TO_VIDEO_MODEL_SELECTORS: Record<string, string> = {
  ltx23: PREFERRED_MODEL_IDS.video.v2v,
  'ltx23-v2v': PREFERRED_MODEL_IDS.video.v2v,
  seedance2: PREFERRED_MODEL_IDS.video.seedanceV2v
};

const SOUND_TO_VIDEO_MODEL_SELECTORS: Record<string, string> = {
  'wan-s2v': PREFERRED_MODEL_IDS.video.s2v,
  seedance2: PREFERRED_MODEL_IDS.video.seedanceIa2v,
  'ltx23-ia2v': PREFERRED_MODEL_IDS.video.ia2v,
  'ltx23-a2v': PREFERRED_MODEL_IDS.video.a2v
};

const MUSIC_MODEL_SELECTORS: Record<string, string> = {
  turbo: PREFERRED_MODEL_IDS.audio.aceStepTurbo,
  sft: PREFERRED_MODEL_IDS.audio.aceStepSft
};

export function clampVariationCount(value: unknown, fallback = 1): number {
  const count = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(16, Math.round(count)));
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isNonEmptyString);
}

export function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asBooleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function normalizeTimeSignature(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.round(value));
  }
  return undefined;
}

export function normalizeVideoControlMode(value: unknown): VideoControlMode {
  switch (value) {
    case 'animate-replace':
    case 'seedance-v2v':
    case 'canny':
    case 'pose':
    case 'depth':
    case 'detailer':
      return value;
    default:
      return 'animate-move';
  }
}

export function getHostedVariationCount(
  args: Record<string, unknown>,
  fallback: unknown = 1
): number {
  if (args.number_of_variations !== undefined) {
    return clampVariationCount(args.number_of_variations);
  }
  return clampVariationCount(fallback, 1);
}

export function resolveHostedToolModelSelector(
  toolName: string,
  args: Record<string, unknown>
): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

  const requestedModel = isNonEmptyString(args.model) ? args.model : undefined;
  if (!requestedModel) {
    return undefined;
  }

  let selectors: Record<string, string> | null = null;
  switch (toolName) {
    case 'generate_image':
      selectors = IMAGE_MODEL_SELECTORS;
      break;
    case 'edit_image':
      selectors = EDIT_IMAGE_MODEL_SELECTORS;
      break;
    case 'generate_video':
      selectors =
        isNonEmptyString(args.reference_image_url) || isNonEmptyString(args.reference_image_end_url)
          ? IMAGE_VIDEO_MODEL_SELECTORS
          : TEXT_VIDEO_MODEL_SELECTORS;
      break;
    case 'sound_to_video':
      selectors = SOUND_TO_VIDEO_MODEL_SELECTORS;
      break;
    case 'video_to_video':
      selectors = VIDEO_TO_VIDEO_MODEL_SELECTORS;
      break;
    case 'generate_music':
      selectors = MUSIC_MODEL_SELECTORS;
      break;
    default:
      return requestedModel;
  }

  return (
    selectors[requestedModel] ?? selectors[normalizeSelectorKey(requestedModel)] ?? requestedModel
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function safeJsonStringify(value: unknown): string | null {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (typeof nestedValue === 'function') {
        return `[Function ${(nestedValue as { name?: string }).name || 'anonymous'}]`;
      }
      if (isObject(nestedValue)) {
        if (seen.has(nestedValue)) {
          return '[Circular]';
        }
        seen.add(nestedValue);
      }
      return nestedValue;
    });
  } catch {
    return null;
  }
}

export function serializeUnknownError(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) {
    return nonEmptyString(error.message) ?? error.name ?? fallback;
  }

  const directString = nonEmptyString(error);
  if (directString) {
    return directString;
  }

  if (!isObject(error)) {
    return String(error ?? fallback);
  }

  for (const key of ['message', 'errorMessage', 'reason', 'description']) {
    const message = nonEmptyString(error[key]);
    if (message) return message;
  }

  const nestedError = error.error;
  if (nestedError !== undefined && nestedError !== error) {
    const nestedMessage = serializeUnknownError(nestedError, '');
    if (nestedMessage) return nestedMessage;
  }

  const nestedCause = error.cause;
  if (nestedCause !== undefined && nestedCause !== error) {
    const nestedMessage = serializeUnknownError(nestedCause, '');
    if (nestedMessage) return nestedMessage;
  }

  return safeJsonStringify(error) ?? fallback;
}

export function isEditImageModel(modelId: string): boolean {
  return (
    modelId === PREFERRED_MODEL_IDS.image.gptImage2 ||
    modelId.startsWith('qwen_image_edit_') ||
    modelId.startsWith('flux2_') ||
    modelId.includes('kontext')
  );
}

const SEEDANCE_CANONICAL_WORKFLOWS: VideoWorkflow[] = ['t2v', 'i2v', 'ia2v', 'v2v'];

function getCompatibleVideoWorkflows(modelId: string): VideoWorkflow[] {
  if (modelId === 'seedance-2-0' || modelId === 'seedance-2-0-fast') {
    return SEEDANCE_CANONICAL_WORKFLOWS;
  }
  const workflow = getVideoWorkflowType(modelId);
  return workflow ? [workflow] : [];
}

export function filterVideoModelsByWorkflow(
  availableModels: Array<{ id: string; media?: string }>,
  workflows: VideoWorkflow[]
): string[] {
  return availableModels
    .filter((model) => model.media === 'video')
    .filter((model) => {
      const compatibleWorkflows = getCompatibleVideoWorkflows(model.id);
      return compatibleWorkflows.some((workflow) => workflows.includes(workflow));
    })
    .map((model) => model.id);
}

export function getVideoDefaults(modelId: string): { width: number; height: number; fps: number } {
  const workflow = getVideoWorkflowType(modelId);
  const isLtx2 = modelId.startsWith('ltx2-') || modelId.startsWith('ltx23-');
  const isSeedance = modelId.startsWith('seedance-2-0');

  if (workflow === 's2v' || workflow === 'animate-move' || workflow === 'animate-replace') {
    return { width: 832, height: 480, fps: 16 };
  }
  if (modelId.includes('seedance-2-0-fast')) {
    return { width: 1280, height: 720, fps: 24 };
  }
  if (isSeedance) {
    return { width: 1920, height: 1088, fps: 24 };
  }
  if (isLtx2) {
    return { width: 1920, height: 1088, fps: 24 };
  }
  return { width: 848, height: 480, fps: 16 };
}

function workerCount(model: BackboneAvailableModel): number {
  return typeof model.workerCount === 'number' && Number.isFinite(model.workerCount)
    ? model.workerCount
    : 0;
}

export function selectBackboneModel(
  models: BackboneAvailableModel[],
  options: SelectBackboneModelInput
): SelectedBackboneModel {
  const byMedia = models.filter((model) => model.media === options.mediaType);
  if (byMedia.length === 0) {
    throw new Error(`No ${options.mediaType} models currently available on the network`);
  }

  const compatible = byMedia.filter((model) => {
    if (options.filter && !options.filter(model.id)) {
      return false;
    }
    if (options.workflows) {
      const compatibleWorkflows = getCompatibleVideoWorkflows(model.id);
      return compatibleWorkflows.some((workflow) => options.workflows?.includes(workflow));
    }
    return true;
  });

  if (options.requestedModel) {
    const requested = compatible.find((model) => model.id === options.requestedModel);
    if (requested) {
      return {
        modelId: requested.id,
        model: requested,
        selectedBy: 'requestedModel'
      };
    }
  }

  if (compatible.length === 0) {
    if (options.workflows) {
      throw new Error(
        `No compatible ${options.mediaType} models available for workflows: ${options.workflows.join(', ')}`
      );
    }
    throw new Error(`No compatible ${options.mediaType} models currently available on the network`);
  }

  if (options.preferredModelIds) {
    for (const preferredId of options.preferredModelIds) {
      const preferred = compatible
        .filter((model) => model.id === preferredId)
        .sort((a, b) => workerCount(b) - workerCount(a))[0];
      if (preferred) {
        return {
          modelId: preferred.id,
          model: preferred,
          selectedBy: 'preferredModel'
        };
      }
    }
  }

  const selected = [...compatible].sort((a, b) => workerCount(b) - workerCount(a))[0];
  return {
    modelId: selected.id,
    model: selected,
    selectedBy: 'workerCount'
  };
}
