export const SupportedForgeSchedulers = {
  simple: 'Simple',
  normal: 'Normal',
  karras: 'Karras',
  exponential: 'Exponential',
  sgm_uniform: 'SGM Uniform',
  ddim_uniform: 'DDIM Uniform',
  beta: 'Beta',
  linear_quadratic: 'Linear Quadratic',
  kl_optimal: 'KL Optimal',
  // Legacy aliases
  ddim: 'DDIM',
  leading: 'Leading',
  linear: 'Linear'
};

export function isForgeScheduler(scheduler: string): scheduler is ForgeScheduler {
  return scheduler in SupportedForgeSchedulers;
}

export function isRawForgeScheduler(scheduler: string): boolean {
  const schedulers = Object.values(SupportedForgeSchedulers);
  return schedulers.includes(scheduler);
}

export type ForgeScheduler = keyof typeof SupportedForgeSchedulers;
