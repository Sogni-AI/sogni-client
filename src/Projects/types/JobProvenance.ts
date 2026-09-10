import type { Sam3Selection } from './index.js';

/**
 * Worker-attested hashes used to bind generated media to its exact inputs.
 * Every field is optional because ordinary projects and older workers do not
 * emit a receipt. Hashes are lowercase SHA-256 hex digests when present.
 */
export interface JobProvenance {
  /** Hash of the exact bytes uploaded as the completed artifact. */
  sha256?: string;
  /** Hash of the original still used by an image edit or segmentation job. */
  sourceImageSha256?: string;
  /** Hash of the canonical normalized SAM point/box/text prompt. */
  samPromptSha256?: string;
  /** Hash of the canonical SAM mask run-length encoding. */
  maskRleSha256?: string;
  maskWidth?: number;
  maskHeight?: number;
  /** Selection bounds as normalized [x0, y0, x1, y1]; absent for an empty mask. */
  maskBox?: [number, number, number, number];
  /** Fraction of the source covered by the returned mask, 0 to 1. */
  maskCoverage?: number;
  /** Selections that passed the threshold; may exceed the reported window. */
  maskDetectedCount?: number;
  /** Selections unioned into the returned mask. */
  maskReturnedCount?: number;
  /**
   * Per-selection confidence and bounds, highest confidence first. Use it to
   * tell a confident selection from a marginal one, and to discover that a
   * concept matched more instances than the single returned mask suggests.
   */
  maskSelections?: Sam3Selection[];
  /** Immutable operator-provisioned SAM runtime/checkpoint version. */
  samVersion?: string;
  /** World selection receipt bound to an image-edit job. */
  selectionHash?: string;
  /** Exact first and last still hashes bound to a frame-interpolation job. */
  firstFrameSha256?: string;
  lastFrameSha256?: string;
}
