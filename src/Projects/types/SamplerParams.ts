export const SupportedSamplers = {
  euler: 'Euler',
  euler_ancestral: 'Euler Ancestral',
  heun: 'Heun',
  dpmpp_2m: 'DPM++ 2M',
  dpmpp_2m_sde: 'DPM++ 2M SDE',
  dpmpp_sde: 'DPM++ SDE',
  dpmpp_3m_sde: 'DPM++ 3M SDE',
  uni_pc: 'UniPC',
  lcm: 'LCM (Latent Consistency Model)',
  // Legacy/other supported samplers
  lms: 'LMS',
  dpm_2: 'DPM 2',
  dpm_2_ancestral: 'DPM 2 Ancestral',
  dpm_fast: 'DPM Fast',
  dpm_adaptive: 'DPM Adaptive',
  dpmpp_2s_ancestral: 'DPM++ 2S Ancestral',
  ddpm: 'DDPM',
  // SDK compatibility aliases
  dfs_sd3: 'Discrete Flow Scheduler (SD3)',
  dpm_pp: 'DPM Solver Multistep (DPM-Solver++)',
  dpm_pp_sde: 'DPM++ SDE',
  dpm_pp_2m: 'DPM++ 2M',
  euler_a: 'Euler a',
  pndm_plms: 'PNDM (Pseudo-linear multi-step)'
};

export function isSampler(sampler: string): sampler is Sampler {
  return sampler in SupportedSamplers;
}

export function isRawSampler(sampler: string): boolean {
  const samplers = Object.values(SupportedSamplers);
  return samplers.includes(sampler);
}

export type Sampler = keyof typeof SupportedSamplers;
