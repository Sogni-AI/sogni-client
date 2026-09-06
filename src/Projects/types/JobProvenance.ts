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
  /** Immutable operator-provisioned SAM runtime/checkpoint version. */
  samVersion?: string;
  /** World selection receipt bound to an image-edit job. */
  selectionHash?: string;
  /** Exact first and last still hashes bound to a frame-interpolation job. */
  firstFrameSha256?: string;
  lastFrameSha256?: string;
}
