/**
 * Copy of a value that is safe to log: every `mediaEncryption.key` in it is
 * replaced. Values without one are returned as they are.
 */
export function redactMediaKey<T>(value: T, depth = 0): T {
  if (!value || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const redacted = redactMediaKey(item, depth + 1);
      if (redacted !== item) changed = true;
      return redacted;
    });
    return (changed ? items : value) as T;
  }
  const record = value as Record<string, unknown>;
  let copy: Record<string, unknown> | null = null;
  for (const [field, item] of Object.entries(record)) {
    const holdsKey =
      field === 'mediaEncryption' && !!item && typeof item === 'object' && 'key' in item;
    const redacted = holdsKey
      ? { ...(item as Record<string, unknown>), key: '[redacted]' }
      : redactMediaKey(item, depth + 1);
    if (redacted !== item) {
      copy ??= { ...record };
      copy[field] = redacted;
    }
  }
  return (copy ?? value) as T;
}
