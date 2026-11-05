import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInputController } from '../terminal/input-controller.mjs';

function event(type, properties = {}, cancelable = true) {
  return Object.assign(new Event(type, { cancelable }), properties);
}
function fixture(settings = {}) {
  const output = [], original = [];
  let connected = true, modifiers;
  const term = {
    textarea: new EventTarget(), modes: {}, input: data => output.push(data), focus() {},
    attachCustomKeyEventHandler(handler) { this.key = handler; },
  };
  const controller = createInputController(term, { settings, isConnected: () => connected, onModifiers: state => { modifiers = state; } });
  term.textarea.addEventListener('input', e => { original.push(e.data); });
  return { term, controller, output, original, get modifiers() { return modifiers; }, disconnect() { connected = false; } };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('touch input uses xterm input and consumes independent one-shot modifiers', () => {
  const f = fixture();
  f.controller.toggle('ctrl'); f.controller.toggle('alt');
  assert.equal(f.controller.press('c'), true);
  assert.deepEqual(f.output, ['\x1b\x03']);
  assert.equal(f.modifiers.ctrl, 'off'); assert.equal(f.modifiers.alt, 'off');
  f.controller.dispose();
});
test('physical keydown and keypress do not duplicate a one-shot Ctrl+C', () => {
  const f = fixture(); f.controller.toggle('ctrl');
  const down = event('keydown', { key: 'c', code: 'KeyC' });
  assert.equal(f.term.key(down), false); assert.equal(down.defaultPrevented, true);
  assert.equal(f.term.key(event('keypress', { key: 'c' })), false);
  f.term.textarea.dispatchEvent(event('input', { data: 'c', inputType: 'insertText' }));
  assert.deepEqual(f.original, []); assert.deepEqual(f.output, ['\x03']);
  f.term.key(event('keyup', { key: 'c' }));
  assert.equal(f.term.key(event('keydown', { key: 'd' })), true);
  f.controller.dispose();
});
test('cancelable beforeinput transforms input-only keyboards before text insertion', () => {
  const f = fixture(); f.controller.toggle('ctrl');
  const before = event('beforeinput', { data: 'c', inputType: 'insertText' });
  f.term.textarea.dispatchEvent(before);
  assert.equal(before.defaultPrevented, true); assert.deepEqual(f.output, ['\x03']);
  assert.equal(f.modifiers.ctrl, 'off'); f.controller.dispose();
});
test('non-cancelable beforeinput waits for capture-phase input and blocks xterm original', () => {
  const f = fixture(); f.controller.toggle('ctrl');
  f.term.textarea.dispatchEvent(event('beforeinput', { data: 'd', inputType: 'insertText' }, false));
  assert.deepEqual(f.output, []);
  f.term.textarea.dispatchEvent(event('input', { data: 'd', inputType: 'insertText' }, false));
  assert.deepEqual(f.output, ['\x04']); assert.deepEqual(f.original, []); f.controller.dispose();
});
test('input-only Shift converts ASCII, not Unicode or multi-character commits', () => {
  const f = fixture(); f.controller.toggle('shift');
  for (const text of ['é', 'e\u0301', 'hello', '😀']) f.term.textarea.dispatchEvent(event('input', { data: text, inputType: 'insertText' }));
  assert.deepEqual(f.output, []); assert.equal(f.modifiers.shift, 'once');
  f.term.textarea.dispatchEvent(event('input', { data: 'a', inputType: 'insertText' }));
  assert.deepEqual(f.output, ['A']); assert.equal(f.modifiers.shift, 'off'); f.controller.dispose();
});
test('composition and final ASCII commit remain untouched; modifier stays pending', async () => {
  const f = fixture(); f.controller.toggle('ctrl');
  f.term.textarea.dispatchEvent(event('compositionstart'));
  assert.equal(f.term.key(event('keydown', { key: 'c', keyCode: 229 })), true);
  f.term.textarea.dispatchEvent(event('input', { data: 'c', inputType: 'insertText', isComposing: true }));
  assert.equal(f.controller.press('Escape'), false);
  f.term.textarea.dispatchEvent(event('compositionend'));
  f.term.textarea.dispatchEvent(event('input', { data: 'c', inputType: 'insertText' }));
  assert.deepEqual(f.output, []); assert.deepEqual(f.original, ['c', 'c']);
  assert.equal(f.modifiers.ctrl, 'once');
  await tick(); f.controller.press('c'); assert.deepEqual(f.output, ['\x03']); f.controller.dispose();
});
test('paste, dead keys, Meta and AltGraph do not consume virtual modifiers', async () => {
  const f = fixture(); f.controller.toggle('alt');
  assert.equal(f.term.key(event('keydown', { key: 'q', metaKey: true })), true);
  assert.equal(f.term.key(event('keydown', { key: '@', getModifierState: key => key === 'AltGraph' })), true);
  f.term.textarea.dispatchEvent(event('paste'));
  f.term.textarea.dispatchEvent(event('input', { data: 'c', inputType: 'insertFromPaste' }));
  await tick();
  f.term.key(event('keydown', { key: 'Dead' }));
  f.term.textarea.dispatchEvent(event('input', { data: 'é', inputType: 'insertText' }));
  assert.deepEqual(f.output, []); assert.equal(f.modifiers.alt, 'once'); f.controller.dispose();
});
test('unsupported Ctrl input passes unchanged and keeps its modifier', () => {
  const f = fixture(); f.controller.toggle('ctrl');
  const before = event('beforeinput', { data: '1', inputType: 'insertText' });
  f.term.textarea.dispatchEvent(before);
  assert.equal(before.defaultPrevented, false); assert.deepEqual(f.output, []); assert.equal(f.modifiers.ctrl, 'once');
  f.controller.dispose();
});
test('keycode 229 ownership prevents xterm diff timers but keeps native insertion', () => {
  const f = fixture(); f.controller.toggle('ctrl');
  const down = event('keydown', { key: 'Unidentified', keyCode: 229 });
  assert.equal(f.term.key(down), false); assert.equal(down.defaultPrevented, false);
  f.term.textarea.dispatchEvent(event('beforeinput', { data: 'c', inputType: 'insertText' }, false));
  f.term.textarea.dispatchEvent(event('input', { data: 'c', inputType: 'insertText' }, false));
  assert.deepEqual(f.output, ['\x03']); assert.deepEqual(f.original, []); f.controller.dispose();
});
test('owned keycode 229 forwards unsupported Unicode once without consuming modifiers', () => {
  const f = fixture(); f.controller.toggle('ctrl');
  f.term.key(event('keydown', { key: 'Unidentified', keyCode: 229 }));
  f.term.textarea.dispatchEvent(event('input', { data: '😀', inputType: 'insertText' }));
  assert.deepEqual(f.output, ['😀']); assert.deepEqual(f.original, []); assert.equal(f.modifiers.ctrl, 'once'); f.controller.dispose();
});
test('no-modifier keycode 229 and composing keycode 229 stay with xterm', () => {
  const f = fixture();
  assert.equal(f.term.key(event('keydown', { key: 'Unidentified', keyCode: 229 })), true);
  f.term.textarea.dispatchEvent(event('input', { data: 'c', inputType: 'insertText' }));
  assert.deepEqual(f.output, []); assert.deepEqual(f.original, ['c']);
  f.controller.toggle('ctrl');
  assert.equal(f.term.key(event('keydown', { key: 'Process', keyCode: 229, isComposing: true })), true);
  f.term.textarea.dispatchEvent(event('input', { data: 'c', inputType: 'insertText' }));
  assert.deepEqual(f.output, []); assert.equal(f.modifiers.ctrl, 'once'); f.controller.dispose();
});
test('a consumed beforeinput suppresses an unexpected same-task input event', () => {
  const f = fixture(); f.controller.toggle('ctrl');
  f.term.textarea.dispatchEvent(event('beforeinput', { data: 'c', inputType: 'insertText' }));
  f.term.textarea.dispatchEvent(event('input', { data: 'c', inputType: 'insertText' }));
  assert.deepEqual(f.output, ['\x03']); assert.deepEqual(f.original, []); f.controller.dispose();
});
test('owned keycode 229 can encode Ctrl+Backspace without a text payload', () => {
  const f = fixture(); f.controller.toggle('ctrl');
  f.term.key(event('keydown', { key: 'Unidentified', keyCode: 229 }));
  f.term.textarea.dispatchEvent(event('beforeinput', { data: null, inputType: 'deleteContentBackward' }));
  assert.deepEqual(f.output, ['\b']); assert.equal(f.modifiers.ctrl, 'off'); f.controller.dispose();
});
test('reset and Escape recover from a canceled dead key', () => {
  const f = fixture(); f.term.key(event('keydown', { key: 'Dead' }));
  assert.equal(f.controller.press('Escape'), false);
  f.controller.reset(); assert.equal(f.controller.press('Escape'), true); f.controller.dispose();
});

test('navigation reads current application mode and merges physical modifiers', () => {
  const f = fixture(); f.controller.press('ArrowUp');
  f.term.modes.applicationCursorKeysMode = true; f.controller.press('ArrowUp');
  f.controller.toggle('ctrl');
  f.term.key(event('keydown', { key: 'ArrowRight', shiftKey: true }));
  assert.deepEqual(f.output, ['\x1b[A', '\x1bOA', '\x1b[1;6C']); f.controller.dispose();
});
test('an intervening keyboard input prevents an accidental double-tap lock', () => {
  const f = fixture({ lockModifiers: true });
  f.controller.toggle('ctrl'); f.controller.press('c'); f.controller.toggle('ctrl');
  assert.equal(f.modifiers.ctrl, 'once'); f.controller.press('d');
  f.controller.toggle('ctrl'); f.controller.toggle('ctrl'); assert.equal(f.modifiers.ctrl, 'locked');
  assert.deepEqual(f.output, ['\x03', '\x04']); f.controller.dispose();
});

test('locks persist, reset clears them, and disconnected/disposed controls send nothing', () => {
  const f = fixture({ lockModifiers: true });
  f.controller.toggle('ctrl'); f.controller.toggle('ctrl', true);
  f.controller.press('c'); f.controller.press('d'); assert.equal(f.modifiers.ctrl, 'locked');
  f.controller.configure({ lockModifiers: false }); assert.equal(f.modifiers.ctrl, 'off');
  f.controller.toggle('alt'); f.controller.reset(); assert.equal(f.modifiers.alt, 'off');
  f.disconnect(); assert.equal(f.controller.press('Enter'), false);
  f.controller.dispose(); assert.equal(f.controller.press('Enter'), false);
  assert.deepEqual(f.output, ['\x03', '\x04']);
});
