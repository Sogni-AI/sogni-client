import { EnhancementStrength } from './types';

export function getEnhacementStrength(strength: EnhancementStrength): number {
  switch (strength) {
    case 'light':
      return 0.15;
    case 'heavy':
      return 0.49;
    default:
      return 0.35;
  }
}
