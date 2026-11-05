// Pure toolbar key encoding. This module does not read browser or xterm internals.
const ESC = '\x1b';
const CSI = `${ESC}[`;
const SS3 = `${ESC}O`;
const SHIFT_FROM = "`1234567890-=[]\\;',./";
const SHIFT_TO = '~!@#$%^&*()_+{}|:"<>?';
const CURSOR_KEYS = Object.freeze({
  ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D',
  Up: 'A', Down: 'B', Right: 'C', Left: 'D', Home: 'H', End: 'F'
});
const TILDE_KEYS = Object.freeze({
  Insert: 2, Delete: 3, PageUp: 5, PageDown: 6,
  F5: 15, F6: 17, F7: 18, F8: 19,
  F9: 20, F10: 21, F11: 23, F12: 24
});
const FUNCTION_KEYS = Object.freeze({ F1: 'P', F2: 'Q', F3: 'R', F4: 'S' });
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function shiftedAscii(key) {
  if (key >= 'a' && key <= 'z') return key.toUpperCase();
  const index = SHIFT_FROM.indexOf(key);
  return index < 0 ? key : SHIFT_TO[index];
}

function controlAscii(key) {
  if (/^[a-z]$/i.test(key)) return String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);
  if (key === ' ' || key === '@' || key === '2') return '\x00';
  if (key === '[' || key === '3') return ESC;
  if (key === '\\' || key === '4') return '\x1c';
  if (key === ']' || key === '5') return '\x1d';
  if (key === '^' || key === '6') return '\x1e';
  if (key === '_' || key === '7' || key === '/') return '\x1f';
  if (key === '?' || key === '8') return '\x7f';
  return null;
}

/**
 * Return terminal input bytes, or null for an unsupported key.
 * Shift uses the US ASCII layout before Ctrl conversion. Already shifted
 * glyphs stay unchanged. Ctrl mappings outside controlAscii are unsupported.
 * Tab follows the traditional HT/CSI Z convention, not CSI-u encoding.
 */
export function encodeKey(key, modifiers = {}, modes = {}) {
  if (typeof key !== 'string') return null;
  const ctrl = modifiers?.ctrl === true;
  const alt = modifiers?.alt === true;
  const shift = modifiers?.shift === true;
  const parameter = 1 + Number(shift) + 2 * Number(alt) + 4 * Number(ctrl);
  const modified = parameter !== 1;

  if (own(CURSOR_KEYS, key)) {
    const final = CURSOR_KEYS[key];
    if (modified) return `${CSI}1;${parameter}${final}`;
    return `${modes?.applicationCursorKeysMode ? SS3 : CSI}${final}`;
  }
  if (own(TILDE_KEYS, key)) {
    return `${CSI}${TILDE_KEYS[key]}${modified ? `;${parameter}` : ''}~`;
  }
  if (own(FUNCTION_KEYS, key)) {
    return modified ? `${CSI}1;${parameter}${FUNCTION_KEYS[key]}` : `${SS3}${FUNCTION_KEYS[key]}`;
  }

  let data;
  switch (key) {
    case 'Esc':
    case 'Escape': data = ESC; break;
    case 'Tab':
      if (shift) return `${CSI}Z`;
      data = '\t';
      break;
    case 'Enter': data = '\r'; break;
    case 'Backspace': data = ctrl ? '\b' : '\x7f'; break;
    default:
      if (key.length !== 1 || key.charCodeAt(0) < 0x20 || key.charCodeAt(0) > 0x7e) return null;
      data = shift ? shiftedAscii(key) : key;
      if (ctrl) data = controlAscii(data);
      if (data === null) return null;
  }
  return alt ? ESC + data : data;
}
