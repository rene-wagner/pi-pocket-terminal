// Immutable, browser-safe state for toolbar modifiers.
const KEYS = Object.freeze(['ctrl', 'alt', 'shift']);

export function createModifiers() {
  return { ctrl: 'off', alt: 'off', shift: 'off' };
}

function copyState(state) {
  const result = createModifiers();
  for (const key of KEYS) {
    if (state?.[key] === 'once' || state?.[key] === 'locked') result[key] = state[key];
  }
  return result;
}

/**
 * A normal tap changes off to once, or clears an active modifier.
 * An enabled double tap sets locked. Invalid names have no effect.
 * Return a new state; never mutate the supplied state.
 */
export function toggleModifier(state, key, { lockEnabled = false, doubleTap = false } = {}) {
  const result = copyState(state);
  if (!KEYS.includes(key)) return result;
  result[key] = lockEnabled && doubleTap ? 'locked' : result[key] === 'off' ? 'once' : 'off';
  return result;
}

export function consumeModifiers(state) {
  const result = copyState(state);
  for (const key of KEYS) {
    if (result[key] === 'once') result[key] = 'off';
  }
  return result;
}

export function modifierFlags(state) {
  const normalized = copyState(state);
  return Object.fromEntries(KEYS.map(key => [key, normalized[key] !== 'off']));
}
