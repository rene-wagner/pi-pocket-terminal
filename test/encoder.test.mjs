import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeKey } from '../terminal/input-encoder.mjs';

const ESC = '\x1b';
const combinations = Array.from({ length: 8 }, (_, mask) => ({
  shift: Boolean(mask & 1), alt: Boolean(mask & 2), ctrl: Boolean(mask & 4)
}));

test('cursor keys respect application mode and every modifier combination', () => {
  const keys = { ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F' };
  for (const applicationCursorKeysMode of [false, true]) {
    for (const [key, final] of Object.entries(keys)) {
      for (const [mask, modifiers] of combinations.entries()) {
        const expected = mask ? `${ESC}[1;${mask + 1}${final}` : `${ESC}${applicationCursorKeysMode ? 'O' : '['}${final}`;
        assert.equal(encodeKey(key, modifiers, { applicationCursorKeysMode }), expected, `${key}/${mask}/${applicationCursorKeysMode}`);
      }
    }
  }
  for (const direction of ['Up', 'Down', 'Left', 'Right']) {
    assert.equal(encodeKey(direction), encodeKey(`Arrow${direction}`));
  }
});

test('navigation keys use CSI modifiers, not physical keyboard shortcuts', () => {
  for (const [key, number] of Object.entries({ Insert: 2, Delete: 3, PageUp: 5, PageDown: 6 })) {
    for (const [mask, modifiers] of combinations.entries()) {
      assert.equal(encodeKey(key, modifiers), `${ESC}[${number}${mask ? `;${mask + 1}` : ''}~`, `${key}/${mask}`);
    }
  }
});

test('F1-F12 support all modifier combinations', () => {
  for (const [index, final] of ['P', 'Q', 'R', 'S'].entries()) {
    for (const [mask, modifiers] of combinations.entries()) {
      assert.equal(encodeKey(`F${index + 1}`, modifiers), mask ? `${ESC}[1;${mask + 1}${final}` : `${ESC}O${final}`);
    }
  }
  for (const [index, number] of [15, 17, 18, 19, 20, 21, 23, 24].entries()) {
    for (const [mask, modifiers] of combinations.entries()) {
      assert.equal(encodeKey(`F${index + 5}`, modifiers), `${ESC}[${number}${mask ? `;${mask + 1}` : ''}~`);
    }
  }
});

test('Esc, Tab, Enter, and Backspace use traditional control bytes', () => {
  for (const modifiers of combinations) {
    const prefix = modifiers.alt ? ESC : '';
    for (const key of ['Esc', 'Escape']) assert.equal(encodeKey(key, modifiers), prefix + ESC);
    assert.equal(encodeKey('Tab', modifiers), modifiers.shift ? `${ESC}[Z` : prefix + '\t');
    assert.equal(encodeKey('Enter', modifiers), prefix + '\r');
    assert.equal(encodeKey('Backspace', modifiers), prefix + (modifiers.ctrl ? '\b' : '\x7f'));
  }
});

test('all printable ASCII passes through; Alt prefixes it once', () => {
  for (let code = 32; code <= 126; code++) {
    const key = String.fromCharCode(code);
    assert.equal(encodeKey(key), key);
    assert.equal(encodeKey(key, { alt: true }), ESC + key);
  }
});

test('Shift maps the US ASCII layout and preserves shifted glyphs', () => {
  const from = "abcdefghijklmnopqrstuvwxyz`1234567890-=[]\\;',./";
  const to = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ~!@#$%^&*()_+{}|:"<>?';
  assert.equal(from.length, to.length);
  for (let i = 0; i < from.length; i++) {
    assert.equal(encodeKey(from[i], { shift: true }), to[i], from[i]);
    assert.equal(encodeKey(from[i], { shift: true, alt: true }), ESC + to[i]);
    assert.equal(encodeKey(to[i], { shift: true }), to[i], `preserve ${to[i]}`);
  }
  assert.equal(encodeKey(' ', { shift: true }), ' ');
});

test('Ctrl covers letters and specified control aliases, with optional Alt', () => {
  const mappings = new Map();
  for (let i = 0; i < 26; i++) {
    mappings.set(String.fromCharCode(65 + i), String.fromCharCode(i + 1));
    mappings.set(String.fromCharCode(97 + i), String.fromCharCode(i + 1));
  }
  for (const [aliases, code] of [[' @2', 0], ['[3', 27], ['\\4', 28], [']5', 29], ['^6', 30], ['_7/', 31], ['?8', 127]]) {
    for (const key of aliases) mappings.set(key, String.fromCharCode(code));
  }
  for (let code = 32; code <= 126; code++) {
    const key = String.fromCharCode(code);
    const expected = mappings.get(key) ?? null;
    assert.equal(encodeKey(key, { ctrl: true }), expected, key);
    assert.equal(encodeKey(key, { ctrl: true, alt: true }), expected === null ? null : ESC + expected, `Alt ${key}`);
  }
});

test('Shift is applied before Ctrl conversion', () => {
  const supported = { a: '\x01', z: '\x1a', ' ': '\x00', '2': '\x00', '6': '\x1e', '-': '\x1f', '/': '\x7f', '@': '\x00', '?': '\x7f' };
  for (const [key, expected] of Object.entries(supported)) {
    assert.equal(encodeKey(key, { ctrl: true, shift: true }), expected);
    assert.equal(encodeKey(key, { ctrl: true, shift: true, alt: true }), ESC + expected);
  }
  for (const key of ['1', '3', '4', '5', '7', '8', '9', '0', '[', ']', '\\']) {
    assert.equal(encodeKey(key, { ctrl: true, shift: true }), null, key);
  }
});

test('unsupported keys and Unicode remain unsupported for every modifier combination', () => {
  for (const key of ['', 'é', '中', '🙂', 'e\u0301', '\t', '\x1b', '\x7f', 'F0', 'F13', 'Dead', 'AltGraph', 'constructor', '__proto__', null, undefined, 2, {}]) {
    for (const modifiers of combinations) assert.equal(encodeKey(key, modifiers), null);
  }
});

test('encoding does not mutate inputs and accepts absent optional objects', () => {
  const modifiers = Object.freeze({ ctrl: true, alt: true, shift: true });
  const modes = Object.freeze({ applicationCursorKeysMode: true });
  assert.equal(encodeKey('ArrowUp', modifiers, modes), `${ESC}[1;8A`);
  assert.equal(encodeKey('ArrowUp', null, null), `${ESC}[A`);
  assert.equal(encodeKey('a', { ctrl: 'false' }), 'a');
});
