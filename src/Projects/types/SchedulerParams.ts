export const SupportedSchedulers = {
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

export function isScheduler(scheduler: string): scheduler is Scheduler {
  return scheduler in SupportedSchedulers;
}

export function isRawScheduler(scheduler: string): boolean {
  const schedulers = Object.values(SupportedSchedulers);
  return schedulers.includes(scheduler);
}

export type Scheduler = keyof typeof SupportedSchedulers;
