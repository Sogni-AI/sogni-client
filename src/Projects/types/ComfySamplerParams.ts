/**
 * ComfyUI sampler parameters for video models and ComfyUI-based image models.
 * These use lowercase underscore format directly matching ComfyUI's internal names.
 */
export const SupportedComfySamplers = {
  euler: 'euler',
  euler_ancestral: 'euler_ancestral',
  heun: 'heun',
  dpmpp_2m: 'dpmpp_2m',
  dpmpp_2m_sde: 'dpmpp_2m_sde',
  dpmpp_sde: 'dpmpp_sde',
  dpmpp_3m_sde: 'dpmpp_3m_sde',
  uni_pc: 'uni_pc',
  lcm: 'lcm',
  // Additional ComfyUI samplers
  lms: 'lms',
  dpm_2: 'dpm_2',
  dpm_2_ancestral: 'dpm_2_ancestral',
  dpm_fast: 'dpm_fast',
  dpm_adaptive: 'dpm_adaptive',
  dpmpp_2s_ancestral: 'dpmpp_2s_ancestral',
  ddpm: 'ddpm',
  ddim: 'ddim',
  uni_pc_bh2: 'uni_pc_bh2'
};

export function isComfySampler(sampler: string): sampler is ComfySampler {
  return sampler in SupportedComfySamplers;
}

export type ComfySampler = keyof typeof SupportedComfySamplers;

