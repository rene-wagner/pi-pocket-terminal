import test from 'node:test';
import assert from 'node:assert/strict';
import { createModifiers, toggleModifier, consumeModifiers, modifierFlags } from '../terminal/modifiers.mjs';

const keys = ['ctrl', 'alt', 'shift'];

test('createModifiers returns independent off states', () => {
  const first = createModifiers();
  const second = createModifiers();
  assert.deepEqual(first, { ctrl: 'off', alt: 'off', shift: 'off' });
  assert.notEqual(first, second);
  first.ctrl = 'once';
  assert.equal(second.ctrl, 'off');
});

test('normal taps enable one-shot, then clear it, for each modifier', () => {
  for (const key of keys) {
    const initial = Object.freeze(createModifiers());
    const once = toggleModifier(initial, key);
    assert.equal(once[key], 'once');
    assert.deepEqual(toggleModifier(Object.freeze(once), key), initial);
    for (const other of keys.filter(other => other !== key)) assert.equal(once[other], 'off');
  }
});

test('double tap locks only when enabled, and a normal tap clears a lock', () => {
  for (const key of keys) {
    for (const current of ['off', 'once', 'locked']) {
      const state = Object.freeze({ ...createModifiers(), [key]: current });
      const locked = toggleModifier(state, key, { lockEnabled: true, doubleTap: true });
      assert.equal(locked[key], 'locked');
      assert.equal(toggleModifier(locked, key)[key], 'off');
      const expected = current === 'off' ? 'once' : 'off';
      assert.equal(toggleModifier(state, key, { doubleTap: true })[key], expected);
      assert.equal(toggleModifier(state, key, { lockEnabled: true })[key], expected);
    }
  }
});

test('consumeModifiers clears every one-shot and retains every lock', () => {
  for (const ctrl of ['off', 'once', 'locked']) {
    for (const alt of ['off', 'once', 'locked']) {
      for (const shift of ['off', 'once', 'locked']) {
        const state = Object.freeze({ ctrl, alt, shift });
        const consumed = consumeModifiers(state);
        assert.notEqual(consumed, state);
        for (const key of keys) assert.equal(consumed[key], state[key] === 'locked' ? 'locked' : 'off');
        assert.deepEqual(consumeModifiers(consumed), consumed);
      }
    }
  }
});

test('modifierFlags maps once and locked to true without changing state', () => {
  for (const key of keys) {
    for (const value of ['off', 'once', 'locked']) {
      const state = Object.freeze({ ...createModifiers(), [key]: value });
      assert.deepEqual(modifierFlags(state), { ctrl: false, alt: false, shift: false, [key]: value !== 'off' });
    }
  }
});

test('invalid modifier names have no effect, including prototype names', () => {
  const state = Object.freeze({ ctrl: 'once', alt: 'locked', shift: 'off' });
  for (const key of ['meta', 'Ctrl', '', '__proto__', 'constructor', 'toString', null, undefined, 2, {}, Symbol('ctrl')]) {
    const result = toggleModifier(state, key, { lockEnabled: true, doubleTap: true });
    assert.deepEqual(result, state);
    assert.notEqual(result, state);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
  }
});

test('missing and invalid state values normalize to off', () => {
  for (const state of [undefined, null, {}, { ctrl: 'invalid', alt: true, shift: 1 }]) {
    assert.deepEqual(consumeModifiers(state), createModifiers());
    assert.deepEqual(modifierFlags(state), { ctrl: false, alt: false, shift: false });
    assert.deepEqual(toggleModifier(state, 'ctrl'), { ctrl: 'once', alt: 'off', shift: 'off' });
  }
});

test('multiple modifiers combine independently and consume only one-shots', () => {
  let state = toggleModifier(createModifiers(), 'ctrl');
  state = toggleModifier(state, 'alt', { lockEnabled: true, doubleTap: true });
  state = toggleModifier(state, 'shift');
  assert.deepEqual(modifierFlags(state), { ctrl: true, alt: true, shift: true });
  const next = consumeModifiers(state);
  assert.deepEqual(next, { ctrl: 'off', alt: 'locked', shift: 'off' });
  assert.deepEqual(state, { ctrl: 'once', alt: 'locked', shift: 'once' });
});
