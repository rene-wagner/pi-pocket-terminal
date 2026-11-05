import { encodeKey } from './input-encoder.mjs';
import { createModifiers, toggleModifier, consumeModifiers, modifierFlags } from './modifiers.mjs';

/** Merge touch modifiers before xterm encodes a key, never after onData emits it. */
export function createInputController(term, { isConnected, onModifiers = () => {}, onActivity = () => {}, settings = {} }) {
  let state = createModifiers(), options = settings, disposed = false;
  let composing = false, protectedInput = false, deadKey = false, suppressedKey = null;
  let owns229 = false, passed229 = false, consumedBeforeInput = false, lastModifierTap = null;
  let protectionTimer, consumedTimer;
  const textarea = term.textarea;
  // xterm registers its own capture listener on the textarea during open(). An ancestor
  // capture listener must run first, including for non-cancelable mobile input events.
  const inputRoot = textarea?.parentElement || textarea;
  const listeners = [];
  const notify = () => onModifiers({ ...state });
  const active = () => Object.values(modifierFlags(state)).some(Boolean);
  const canInput = () => !disposed && isConnected();
  const cancel = event => { if (event.cancelable) event.preventDefault(); event.stopImmediatePropagation(); };
  const flags = event => {
    const virtual = modifierFlags(state);
    return { ctrl: virtual.ctrl || Boolean(event?.ctrlKey), alt: virtual.alt || Boolean(event?.altKey), shift: virtual.shift || Boolean(event?.shiftKey) };
  };
  function emit(key, event) {
    if (!canInput()) return false;
    const data = encodeKey(key, flags(event), term.modes);
    if (data === null) return false;
    term.input(data, true);
    lastModifierTap = null;
    state = consumeModifiers(state);
    notify();
    onActivity();
    return true;
  }
  function protectCurrentTask() {
    protectedInput = true;
    clearTimeout(protectionTimer);
    protectionTimer = setTimeout(() => {
      // Let xterm's compositionend timer finish before a new input-only transaction.
      protectionTimer = setTimeout(() => { protectedInput = false; if (!composing) passed229 = false; }, 0);
    }, 0);
  }
  function handleKey(event) {
    if (event.type === 'keyup') { suppressedKey = null; return true; }
    if (event.type === 'keypress' && suppressedKey) { cancel(event); return false; }
    if (event.type === 'keypress' && owns229) return false;
    if (event.type !== 'keydown') return true;
    suppressedKey = null;
    if (!['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(event.key)) lastModifierTap = null;
    consumedBeforeInput = false;
    owns229 = false;
    passed229 = event.keyCode === 229;
    if (event.key === 'Dead') deadKey = true;
    else if (['Escape', 'Backspace', 'Enter'].includes(event.key)) deadKey = false;
    // Do not interfere with IMEs, Option/AltGraph text entry, or OS/browser Meta shortcuts.
    if (event.isComposing || composing || protectedInput || deadKey || event.metaKey || event.getModifierState?.('AltGraph')) return true;
    if (!active() || !canInput()) return true;
    if (event.keyCode === 229) {
      // Keep native text insertion, but prevent CompositionHelper's deferred textarea-diff send.
      // We own only this non-composing transaction; compositionstart hands control back to xterm.
      owns229 = true;
      passed229 = false;
      return false;
    }
    if (emit(event.key, event)) {
      suppressedKey = event.code || event.key;
      cancel(event);
      return false;
    }
    return true;
  }
  function textKey(event) {
    if (event.isComposing || composing || protectedInput || deadKey || passed229) return null;
    if (owns229 && event.inputType === 'deleteContentBackward') return 'Backspace';
    if (owns229 && event.inputType === 'deleteContentForward') return 'Delete';
    if (owns229 && event.inputType === 'insertLineBreak') return 'Enter';
    if (event.inputType === 'insertText' && typeof event.data === 'string' && /^[\x20-\x7e]$/.test(event.data)) return event.data;
    return null;
  }
  function beforeInput(event) {
    lastModifierTap = null;
    consumedBeforeInput = false;
    if (suppressedKey) { cancel(event); return; }
    const key = textKey(event);
    // Non-cancelable beforeinput must wait for input. Otherwise xterm would emit the original too.
    if (key !== null && event.cancelable && active() && emit(key)) {
      cancel(event);
      owns229 = false;
      consumedBeforeInput = true;
      clearTimeout(consumedTimer);
      consumedTimer = setTimeout(() => { consumedBeforeInput = false; }, 0);
    }
  }
  function input(event) {
    lastModifierTap = null;
    if (suppressedKey || consumedBeforeInput) { consumedBeforeInput = false; cancel(event); return; }
    const key = textKey(event);
    if (key !== null && active() && emit(key)) cancel(event);
    else if (owns229 && !event.isComposing && !composing && !protectedInput && event.inputType === 'insertText' && typeof event.data === 'string') {
      // xterm's input listener can ignore composed input after keydown 229. Forward unchanged
      // text ourselves only when we suppressed that keydown, not for a composition or paste.
      if (canInput()) term.input(event.data, true);
      cancel(event);
    }
    // Never clear or rewrite xterm's textarea. CompositionHelper owns its contents.
    owns229 = false;
    passed229 = false;
    deadKey = false;
  }
  function listen(type, handler) {
    const scoped = event => { if (event.target === textarea) handler(event); };
    inputRoot?.addEventListener(type, scoped, true);
    listeners.push(() => inputRoot?.removeEventListener(type, scoped, true));
  }
  listen('beforeinput', beforeInput);
  listen('input', input);
  listen('compositionstart', () => { composing = true; suppressedKey = null; owns229 = false; passed229 = true; });
  listen('compositionend', () => { composing = false; deadKey = false; passed229 = true; protectCurrentTask(); });
  listen('paste', protectCurrentTask);
  term.attachCustomKeyEventHandler(handleKey);
  notify();

  return {
    press(key) { return !composing && !protectedInput && !deadKey && emit(key); },
    toggle(key, doubleTap) {
      if (!canInput() || composing) return;
      const now = Date.now();
      const repeated = doubleTap ?? (lastModifierTap?.key === key && now - lastModifierTap.time < 350);
      lastModifierTap = repeated ? null : { key, time: now };
      state = toggleModifier(state, key, { lockEnabled: options.lockModifiers === true, doubleTap: repeated });
      notify();
      onActivity();
    },
    reset() { state = createModifiers(); suppressedKey = null; deadKey = false; owns229 = false; passed229 = false; consumedBeforeInput = false; lastModifierTap = null; notify(); },
    configure(next) {
      options = next;
      if (!options.lockModifiers && Object.values(state).includes('locked')) { state = createModifiers(); notify(); }
    },
    focus() { if (canInput()) term.focus(); },
    dispose() {
      disposed = true;
      clearTimeout(protectionTimer);
      clearTimeout(consumedTimer);
      owns229 = false; passed229 = false; consumedBeforeInput = false;
      for (const remove of listeners) remove();
      term.attachCustomKeyEventHandler(() => true);
    },
  };
}
