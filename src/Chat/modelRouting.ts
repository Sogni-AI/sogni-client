import { getVideoWorkflowType } from '../Projects/utils';

export { getVideoWorkflowType };

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
  | 'canny'
  | 'pose'
  | 'depth'
  | 'detailer';

export const PREFERRED_MODEL_IDS = {
  image: {
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
    animateMove: 'wan_v2.2-14b-fp8_animate-move_lightx2v',
    animateReplace: 'wan_v2.2-14b-fp8_animate-replace_lightx2v'
  },
  audio: {
    aceStepTurbo: 'ace_step_1.5_turbo',
    aceStepSft: 'ace_step_1.5_sft'
  }
} as const;

export function isEditImageModel(modelId: string): boolean {
  return (
    modelId.startsWith('qwen_image_edit_') ||
    modelId.startsWith('flux2_') ||
    modelId.includes('kontext')
  );
}

export function filterVideoModelsByWorkflow(
  availableModels: Array<{ id: string; media?: string }>,
  workflows: VideoWorkflow[]
): string[] {
  return availableModels
    .filter((model) => model.media === 'video')
    .filter((model) => {
      const workflow = getVideoWorkflowType(model.id);
      return workflow !== null && workflows.includes(workflow);
    })
    .map((model) => model.id);
}

export function getVideoDefaults(modelId: string): { width: number; height: number; fps: number } {
  const workflow = getVideoWorkflowType(modelId);
  const isLtx2 = modelId.startsWith('ltx2-') || modelId.startsWith('ltx23-');

  if (workflow === 's2v' || workflow === 'animate-move' || workflow === 'animate-replace') {
    return { width: 832, height: 480, fps: 16 };
  }
  if (isLtx2) {
    return { width: 1920, height: 1088, fps: 24 };
  }
  return { width: 848, height: 480, fps: 16 };
}
