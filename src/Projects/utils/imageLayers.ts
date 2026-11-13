import type {
  ImageLayer,
  ImageLayerBoundingBox,
  ImageLayerTextLine,
  ImageLayerTextRecognition,
  ImageLayerTextRun,
  ImageLayerTextStyle
} from '../types/index.js';

type Box = [number, number, number, number];

/** Layers stack above the base image (z-index 0): Seedream returns at most 99. */
const MAX_LAYER_Z_INDEX = 99;

const TEXT_STYLE_FLAGS = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'shadow',
  'translucent'
] as const;

function box(value: unknown): Box | undefined {
  return Array.isArray(value) &&
    value.length === 4 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    ? (value.slice() as Box)
    : undefined;
}

function boundingBox(value: unknown): ImageLayerBoundingBox | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const absolute = box(raw.absolute);
  const normalized = box(raw.normalized);
  return absolute && normalized ? { absolute, normalized } : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}

function textStyle(value: unknown): ImageLayerTextStyle | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.similarFontFamily !== 'string' || typeof raw.foregroundColor !== 'string')
    return undefined;
  if (TEXT_STYLE_FLAGS.some((flag) => typeof raw[flag] !== 'boolean')) return undefined;
  return {
    similarFontFamily: raw.similarFontFamily,
    foregroundColor: raw.foregroundColor,
    bold: raw.bold as boolean,
    italic: raw.italic as boolean,
    underline: raw.underline as boolean,
    strikethrough: raw.strikethrough as boolean,
    shadow: raw.shadow as boolean,
    translucent: raw.translucent as boolean
  };
}

function textRun(value: unknown): ImageLayerTextRun | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const style = textStyle(raw.style);
  return typeof raw.text === 'string' && style ? { text: raw.text, style } : undefined;
}

function textLine(value: unknown): ImageLayerTextLine | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const bounds = boundingBox(raw.boundingBox);
  if (!bounds || !Array.isArray(raw.runs)) return undefined;
  const runs: ImageLayerTextRun[] = [];
  for (const entry of raw.runs) {
    const run = textRun(entry);
    if (!run) return undefined;
    runs.push(run);
  }
  return { boundingBox: bounds, runs };
}

/**
 * A layer's rich-text recognition, only when it is complete: a malformed
 * result is left out rather than reported in part.
 */
function textRecognition(value: unknown): ImageLayerTextRecognition | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.text !== 'string' || !Array.isArray(raw.lines)) return undefined;
  const lines: ImageLayerTextLine[] = [];
  for (const entry of raw.lines) {
    const line = textLine(entry);
    if (!line) return undefined;
    lines.push(line);
  }
  return { text: raw.text, lines };
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
    const bounds = boundingBox(raw.boundingBox);
    const width = positiveInteger(raw.width);
    const height = positiveInteger(raw.height);
    const zIndex = positiveInteger(raw.zIndex);
    if (typeof raw.url !== 'string' || !raw.url || !bounds) continue;
    if (width === undefined || height === undefined || zIndex === undefined) continue;
    if (zIndex > MAX_LAYER_Z_INDEX) continue;
    const recognition = textRecognition(raw.textRecognition);
    layers.push({
      url: raw.url,
      width,
      height,
      zIndex,
      boundingBox: bounds,
      ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(recognition ? { textRecognition: recognition } : {})
    });
  }
  return layers.length ? layers.sort((a, b) => a.zIndex - b.zIndex) : undefined;
}
