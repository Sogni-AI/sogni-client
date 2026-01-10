/**
 * Maps display name formats (from API) to lowercase aliases.
 * Used to normalize the allowed scheduler list so users can use consistent aliases.
 */
const SchedulerDisplayToAlias: Record<string, string> = {
  Simple: 'simple',
  Normal: 'normal',
  Karras: 'karras',
  Exponential: 'exponential',
  'SGM Uniform': 'sgm_uniform',
  'DDIM Uniform': 'ddim_uniform',
  Beta: 'beta',
  'Linear Quadratic': 'linear_quadratic',
  'KL Optimal': 'kl_optimal',
  DDIM: 'ddim',
  Leading: 'leading',
  Linear: 'linear'
};

/**
 * Convert a scheduler display name to its alias.
 * If already an alias or unknown, returns unchanged.
 * Used to normalize API tier data for consistent validation.
 */
export function schedulerValueToAlias(value: string): string {
  return SchedulerDisplayToAlias[value] || value;
}
