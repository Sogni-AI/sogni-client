export const SchedulerMap = {
  beta: 'Beta',
  ddim: 'DDIM',
  karras: 'Karras',
  kl_optimal: 'KL Optimal',
  leading: 'Automatic',
  linear: 'Automatic',
  normal: 'Normal',
  sgm_uniform: 'SGM Uniform',
  simple: 'Simple'
};

export function isScheduler(scheduler: string): scheduler is Scheduler {
  return scheduler in SchedulerMap;
}

export type Scheduler = keyof typeof SchedulerMap;
