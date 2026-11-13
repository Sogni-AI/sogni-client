import type { VideoProjectParams } from './types/index.js';

export const MINIMAX_H3_CONTROL_MODEL_ID = 'minimax-h3-ref2va-fp8_v2v_controlnet';
/** The guide types MiniMax H3 Control takes at launch; the Socket refuses any other. */
export const MINIMAX_H3_CONTROL_TYPES = [
  'canny',
  'depth',
  'pose',
  'hed',
  'mlsd',
  'inpaint'
] as const;
/** Guide types the worker can extract from the source video itself (every type but inpaint). */
const MINIMAX_H3_AUTOMATIC_CONTROL_TYPES = ['canny', 'depth', 'pose', 'hed', 'mlsd'];

export function isMinimaxH3ControlModel(modelId: string): boolean {
  return modelId === MINIMAX_H3_CONTROL_MODEL_ID;
}

/**
 * The moving mask and the prepared control video upload to the numbered
 * private video slots the server reads for this model: `referenceVideo2` and
 * `referenceVideo3`.
 */
export function getMinimaxH3ControlUploads(params: VideoProjectParams) {
  return [
    { id: 'referenceVideo2', media: params.referenceMaskVideo },
    { id: 'referenceVideo3', media: params.controlVideo }
  ].filter((entry): entry is { id: string; media: NonNullable<typeof entry.media> } =>
    Boolean(entry.media)
  );
}

/**
 * Refuse a MiniMax H3 Control request the server and worker would refuse, before
 * anything is uploaded. Other models never read `controlVideo`,
 * `referenceMaskVideo` or the H3-only `controlNet` fields, so this returns at once
 * for them and their requests are built exactly as before.
 *
 * Extra references, end frames, uploaded audio and keyframes are already refused
 * for this model by validateVideoWorkflowAssets, and `controlNet.strength` by
 * getVideoControlNet.
 */
export function validateMinimaxH3Control(params: VideoProjectParams): void {
  if (!isMinimaxH3ControlModel(params.modelId)) return;
  const control = params.controlNet;
  const name = control?.name ?? 'depth';
  if (!(MINIMAX_H3_CONTROL_TYPES as readonly string[]).includes(name)) {
    throw new Error('Choose a supported MiniMax H3 Control type.');
  }
  if (!params.referenceVideo && !params.controlVideo) {
    throw new Error('MiniMax H3 Control requires referenceVideo or a prepared controlVideo.');
  }
  if (params.referenceMask && params.referenceMaskVideo) {
    throw new Error('Choose one referenceMask image or referenceMaskVideo.');
  }
  const masked = Boolean(params.referenceMask || params.referenceMaskVideo);
  if (masked && !params.referenceVideo) {
    throw new Error('MiniMax H3 masked editing requires the source referenceVideo.');
  }
  if (name === 'inpaint' && !masked) {
    throw new Error('MiniMax H3 inpaint requires referenceMask or referenceMaskVideo.');
  }
  for (const [key, value] of [
    ['guidanceStart', control?.guidanceStart],
    ['guidanceEnd', control?.guidanceEnd]
  ] as const) {
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    ) {
      throw new Error(`controlNet.${key} must be from 0 to 1.`);
    }
  }
  if ((control?.guidanceStart ?? 0) > (control?.guidanceEnd ?? 1)) {
    throw new Error('controlNet.guidanceStart must not exceed guidanceEnd.');
  }
  if (control?.preprocess !== undefined && typeof control.preprocess !== 'boolean') {
    throw new Error('controlNet.preprocess must be a boolean.');
  }
  if (params.controlVideo && control?.preprocess === true) {
    throw new Error('controlVideo is a prepared map; omit preprocess or set it to false.');
  }
  // Inpaint has no map to extract; the Socket and worker refuse preprocess for it.
  if (control?.preprocess && !MINIMAX_H3_AUTOMATIC_CONTROL_TYPES.includes(name)) {
    throw new Error(`${name} has no map to extract; omit preprocess or set it to false.`);
  }
}
