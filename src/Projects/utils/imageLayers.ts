import type { ImageLayer } from '../types/index.js';

type Box = [number, number, number, number];

function box(value: unknown): Box | undefined {
  return Array.isArray(value) &&
    value.length === 4 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    ? (value.slice() as Box)
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}

/**
 * The layers of a Seedream layer decomposition, as the socket's `jobResult`
 * (or a recovered job's `result`) carries them, ordered by `zIndex`.
 * Undefined for every other result.
 */
export function imageLayersFromResult(value: unknown): ImageLayer[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const layers: ImageLayer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const bounds = (raw.boundingBox ?? {}) as Record<string, unknown>;
    const absolute = box(bounds.absolute);
    const normalized = box(bounds.normalized);
    const width = positiveInteger(raw.width);
    const height = positiveInteger(raw.height);
    const zIndex = positiveInteger(raw.zIndex);
    if (typeof raw.url !== 'string' || !raw.url || !absolute || !normalized) continue;
    if (width === undefined || height === undefined || zIndex === undefined) continue;
    layers.push({
      url: raw.url,
      width,
      height,
      zIndex,
      boundingBox: { absolute, normalized },
      ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {})
    });
  }
  return layers.length ? layers.sort((a, b) => a.zIndex - b.zIndex) : undefined;
}
