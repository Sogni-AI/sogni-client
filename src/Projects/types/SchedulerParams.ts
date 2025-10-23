export const SupportedSchedulers = {
  beta: 'Beta',
  ddim: 'DDIM',
  karras: 'Karras',
  kl_optimal: 'KL Optimal',
  leading: 'Leading',
  linear: 'Linear',
  normal: 'Normal',
  sgm_uniform: 'SGM Uniform',
  simple: 'Simple'
};

export function isScheduler(scheduler: string): scheduler is Scheduler {
  return scheduler in SupportedSchedulers;
}

export function isRawScheduler(scheduler: string): boolean {
  const schedulers = Object.values(SupportedSchedulers);
  return schedulers.includes(scheduler);
}

export type Scheduler = keyof typeof SupportedSchedulers;
