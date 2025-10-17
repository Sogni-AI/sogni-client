export const SamplerMap = {
  dfs_sd3: 'Discrete Flow Scheduler (SD3)',
  dpm_pp: 'DPM Solver Multistep (DPM-Solver++)',
  dpm_pp_sde: 'DPM++ SDE',
  dpm_pp_2m: 'DPM++ 2M',
  dpm_pp_2m_sde: 'DPM++ 2M SDE',
  euler: 'Euler',
  euler_a: 'Euler a',
  heun: 'Heun',
  lcm: 'LCM (Latent Consistency Model)',
  pndm_plms: 'PNDM (Pseudo-linear multi-step)',
  uni_pc: 'UniPC'
};

export function isSampler(sampler: string): sampler is Sampler {
  return sampler in SamplerMap;
}

export type Sampler = keyof typeof SamplerMap;
