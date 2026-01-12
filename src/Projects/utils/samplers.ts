/**
 * Maps display name formats (from API) to lowercase aliases.
 * Used to normalize the allowed sampler list so users can use consistent aliases.
 */
const SamplerDisplayToAlias: Record<string, string> = {
  Euler: 'euler',
  'Euler a': 'euler_a',
  'Euler Ancestral': 'euler_ancestral',
  Heun: 'heun',
  'DPM++ 2M': 'dpmpp_2m',
  'DPM++ 2M SDE': 'dpmpp_2m_sde',
  'DPM++ SDE': 'dpmpp_sde',
  'DPM++ 3M SDE': 'dpmpp_3m_sde',
  UniPC: 'uni_pc',
  'LCM (Latent Consistency Model)': 'lcm',
  LMS: 'lms',
  'DPM 2': 'dpm_2',
  'DPM 2 Ancestral': 'dpm_2_ancestral',
  'DPM Fast': 'dpm_fast',
  'DPM Adaptive': 'dpm_adaptive',
  'DPM++ 2S Ancestral': 'dpmpp_2s_ancestral',
  DDPM: 'ddpm',
  'Discrete Flow Sampler (SD3)': 'dfs_sd3',
  'Discrete Flow Scheduler (SD3)': 'dfs_sd3',
  'DPM Solver Multistep (DPM-Solver++)': 'dpm_pp',
  'PNDM (Pseudo-linear multi-step)': 'pndm_plms'
};

/**
 * Convert a sampler display name to its alias.
 * If already an alias or unknown, returns unchanged.
 * Used to normalize API tier data for consistent validation.
 */
export function samplerValueToAlias(value: string): string {
  return SamplerDisplayToAlias[value] || value;
}
