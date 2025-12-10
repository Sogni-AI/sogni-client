import { AssetRequirement, EnhancementStrength, VideoAssetKey, VideoWorkflowType } from './types';

export function getEnhacementStrength(strength: EnhancementStrength): number {
  switch (strength) {
    case 'light':
      return 0.15;
    case 'heavy':
      return 0.49;
    default:
      return 0.35;
  }
}

/**
 * Check if a model ID is for a video workflow.
 * This is consistent with the `media` property returned by the models list API.
 * Video models produce MP4 output; image models produce PNG/JPG output.
 */
export function isVideoModel(modelId: string): boolean {
  return modelId.startsWith('wan_');
}

/**
 * Get the video workflow type from a model ID.
 * Returns null for non-video models.
 */
export function getVideoWorkflowType(modelId: string): VideoWorkflowType {
  if (!modelId || !modelId.startsWith('wan_')) return null;
  if (modelId.includes('_i2v')) return 'i2v';
  if (modelId.includes('_s2v')) return 's2v';
  if (modelId.includes('_animate-move')) return 'animate-move';
  if (modelId.includes('_animate-replace')) return 'animate-replace';
  if (modelId.includes('_t2v')) return 't2v';
  return null;
}

/**
 * Asset requirements for each video workflow type.
 * - required: Must be provided
 * - optional: Can be provided
 * - forbidden: Must NOT be provided
 */
export const VIDEO_WORKFLOW_ASSETS: Record<
  NonNullable<VideoWorkflowType>,
  Record<VideoAssetKey, AssetRequirement>
> = {
  t2v: {
    referenceImage: 'forbidden',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden',
    referenceVideo: 'forbidden'
  },
  i2v: {
    referenceImage: 'required',
    referenceImageEnd: 'optional',
    referenceAudio: 'forbidden',
    referenceVideo: 'forbidden'
  },
  s2v: {
    referenceImage: 'required',
    referenceAudio: 'required',
    referenceImageEnd: 'forbidden',
    referenceVideo: 'forbidden'
  },
  'animate-move': {
    referenceImage: 'required',
    referenceVideo: 'required',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden'
  },
  'animate-replace': {
    referenceImage: 'required',
    referenceVideo: 'required',
    referenceImageEnd: 'forbidden',
    referenceAudio: 'forbidden'
  }
};
