/** Current server-provided explanation for queued work. Absent on older servers. */
export interface WaitingReason {
  reason:
    | 'concurrency_limit'
    | 'model_concurrency_limit'
    | 'payment_pending'
    | 'no_workers'
    | 'queued';
  /** Display as plain text. A free slot does not guarantee immediate processing. */
  message: string;
  mediaType?: 'video' | 'media';
  paymentModel?: 'subscription' | 'paid_spark' | 'free_spark' | 'sogni';
  subscriptionTier?: 'unlimited' | 'unlimited_pro';
  modelFamily?: 'minimax_h3';
}

/** One queued result. Its zero-based index exists before a worker assigns an image ID. */
export interface JobWaitingReason {
  jobIndex: number;
  imgID?: string;
  waitingReason: WaitingReason;
}

const REASONS = new Set([
  'concurrency_limit',
  'model_concurrency_limit',
  'payment_pending',
  'no_workers',
  'queued'
]);

/** @internal */
export function normalizeWaitingReason(raw: unknown): WaitingReason | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.reason !== 'string' ||
    !REASONS.has(value.reason) ||
    typeof value.message !== 'string' ||
    !value.message.trim() ||
    value.message.length > 600
  )
    return null;
  const result: WaitingReason = {
    reason: value.reason as WaitingReason['reason'],
    message: value.message
  };
  if (value.mediaType === 'video' || value.mediaType === 'media')
    result.mediaType = value.mediaType;
  if (
    typeof value.paymentModel === 'string' &&
    ['subscription', 'paid_spark', 'free_spark', 'sogni'].includes(value.paymentModel)
  )
    result.paymentModel = value.paymentModel as WaitingReason['paymentModel'];
  if (value.subscriptionTier === 'unlimited' || value.subscriptionTier === 'unlimited_pro')
    result.subscriptionTier = value.subscriptionTier;
  if (value.modelFamily === 'minimax_h3') result.modelFamily = value.modelFamily;
  return result;
}

/** @internal */
export function normalizeJobWaitingReasons(
  raw: unknown,
  numberOfMedia: number
): JobWaitingReason[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const result: JobWaitingReason[] = [];
  for (const entry of raw.slice(0, numberOfMedia)) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !Number.isSafeInteger(entry.jobIndex) ||
      entry.jobIndex < 0 ||
      entry.jobIndex >= numberOfMedia ||
      seen.has(entry.jobIndex)
    )
      continue;
    const waitingReason = normalizeWaitingReason(entry.waitingReason);
    if (!waitingReason) continue;
    seen.add(entry.jobIndex);
    result.push({
      jobIndex: entry.jobIndex,
      ...(typeof entry.imgID === 'string' && entry.imgID.length > 0 && entry.imgID.length <= 128
        ? { imgID: entry.imgID }
        : {}),
      waitingReason
    });
  }
  return result;
}
