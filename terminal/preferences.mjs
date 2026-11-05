export const DEFAULT_SETTINGS = Object.freeze({
  keybarVisibility: 'auto', extendedKeys: false, highlightModifiers: true,
  hapticFeedback: false, lockModifiers: false,
});

export function normalizeSettings(values = {}) {
  const result = { ...DEFAULT_SETTINGS };
  if (['auto', 'always', 'never'].includes(values.keybarVisibility)) result.keybarVisibility = values.keybarVisibility;
  for (const key of ['extendedKeys', 'highlightModifiers', 'hapticFeedback', 'lockModifiers']) {
    if (typeof values[key] === 'boolean') result[key] = values[key];
  }
  return result;
}
