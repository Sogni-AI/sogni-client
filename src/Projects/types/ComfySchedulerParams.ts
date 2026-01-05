/**
 * ComfyUI scheduler parameters for video models and ComfyUI-based image models.
 * These use lowercase underscore format directly matching ComfyUI's internal names.
 */
export const SupportedComfySchedulers = {
  simple: 'simple',
  normal: 'normal',
  karras: 'karras',
  exponential: 'exponential',
  sgm_uniform: 'sgm_uniform',
  ddim_uniform: 'ddim_uniform',
  beta: 'beta',
  linear_quadratic: 'linear_quadratic',
  kl_optimal: 'kl_optimal'
};

export function isComfyScheduler(scheduler: string): scheduler is ComfyScheduler {
  return scheduler in SupportedComfySchedulers;
}

export type ComfyScheduler = keyof typeof SupportedComfySchedulers;
