const SchedulerAliases: Record<string, string> = {
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

const SchedulerValueToAlias = Object.fromEntries(
  Object.entries(SchedulerAliases).map(([k, v]) => [v, k])
);

export function schedulerAliasToValue(alias: string): string {
  return SchedulerAliases[alias] || alias;
}

export function schedulerValueToAlias(value: string): string {
  return SchedulerValueToAlias[value] || value;
}
