import { Terminal } from './xterm.mjs';
import { FitAddon } from './fit.mjs';
import { createInputController } from './input-controller.mjs';
import { createInputQueue } from './input-queue.mjs';
import { createModifiers } from './modifiers.mjs';
import { DEFAULT_SETTINGS, normalizeSettings } from './preferences.mjs';

export const pocketApi = 1;
export default function setup(pocket) {
  pocket.style('terminal.css');
  const { html, useState, useEffect, useLayoutEffect, useRef } = pocket;
  const call = (path, method = 'GET', body, signal) => pocket.api(path, body, { method, signal });
  const statusLabels = { connecting: 'Connecting …', online: 'Connected', disconnected: 'Disconnected', closed: 'Terminal closed' };

  function useSettings() {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [failure, setFailure] = useState('');
    useEffect(() => {
      let alive = true, generation = 0;
      const load = async () => {
        const current = ++generation;
        try {
          const result = await pocket.settings();
          if (alive && current === generation) { setSettings(normalizeSettings(result.values)); setFailure(''); }
        } catch {
          if (alive && current === generation) setFailure('Could not load settings. Using defaults.');
        }
      };
      const stop = typeof pocket.onSettings === 'function' ? pocket.onSettings(load) : () => {};
      if (typeof pocket.settings === 'function') void load();
      return () => { alive = false; stop(); };
    }, []);
    return [settings, failure];
  }

  function TerminalView({ id, target, selected, settings, onState, onError }) {
    const element = useRef(null), settingsRef = useRef(settings);
    settingsRef.current = settings;
    useLayoutEffect(() => {
      if (!element.current) return;
      const term = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 5000, disableStdin: true,
        theme: { background: '#11151b', foreground: '#e5e7eb' } });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element.current);
      let alive = true, accepting = true, cursor = 0, status = 'connecting', inputFailed = false, resizeFrame = 0;
      let retryTimer, wakeRetry, wakeWrite;
      const ctrl = new AbortController();
      const current = () => alive && accepting && selected.current === id;
      const publish = (modifiers) => {
        if (current()) onState(previous => ({ id, status, modifiers: modifiers || (previous.id === id ? previous.modifiers : createModifiers()) }));
      };
      const connection = next => {
        if (!alive) return;
        const changed = status !== next;
        status = next;
        queue.setConnected(current() && next === 'online');
        term.options.disableStdin = !current() || next !== 'online';
        if (changed && next !== 'online') input.reset();
        if (changed && next === 'online') requestResize();
        if (changed) publish();
      };
      const queue = createInputQueue({
        send: data => call(`sessions/${id}/input`, 'POST', { data }, ctrl.signal),
        onError: error => {
          if (!current()) return;
          inputFailed = true;
          connection('disconnected');
          onError(`${error.message} The last input may already have been sent. Unsent input was discarded; please reconnect.`);
        },
      });
      const vibrate = () => {
        if (settingsRef.current.hapticFeedback) { try { navigator.vibrate?.(10); } catch { /* optional browser capability */ } }
      };
      const input = createInputController(term, {
        isConnected: () => current() && status === 'online', settings: settingsRef.current,
        onModifiers: publish, onActivity: vibrate,
      });
      const handle = {
        id, press: input.press, toggle: input.toggle, focus: input.focus, reset: input.reset, configure: input.configure,
        deactivate() { connection('disconnected'); accepting = false; queue.setConnected(false); term.options.disableStdin = true; input.reset(); },
      };
      target.current = handle;
      const dataSubscription = term.onData(data => { if (current()) queue.enqueue(data); });
      let lastCols = 0, lastRows = 0, resizing = false, resizeAgain = false;
      const resize = async () => {
        if (!alive || !element.current?.clientHeight || !element.current?.clientWidth) return;
        try {
          fit.fit();
          if (resizing) { resizeAgain = true; return; }
          if (term.cols === lastCols && term.rows === lastRows) return;
          const cols = term.cols, rows = term.rows;
          resizing = true;
          try {
            await call(`sessions/${id}/resize`, 'POST', { cols, rows }, ctrl.signal);
            lastCols = cols; lastRows = rows;
          } finally {
            resizing = false;
            if (alive && resizeAgain) { resizeAgain = false; requestResize(); }
          }
        } catch { /* Refit on the next size event or successful reconnection; do not cache failures. */ }
      };
      const requestResize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(resize); };
      const observer = new ResizeObserver(requestResize);
      observer.observe(element.current);
      window.visualViewport?.addEventListener('resize', requestResize);
      requestResize();
      publish();
      (async () => {
        while (alive) {
          try {
            const out = await call(`sessions/${id}/output?cursor=${cursor}`, 'GET', undefined, ctrl.signal);
            if (!alive) break;
            // A successful poll confirms the channel before parsing: xterm can emit terminal
            // query replies while it writes output, and disableStdin would discard those replies.
            if (out.closed) connection('closed');
            else if (!inputFailed) connection('online');
            if (out.truncated) term.write('\r\n[Older output discarded]\r\n');
            if (out.data) await new Promise(resolve => {
              wakeWrite = resolve;
              term.write(out.data, () => { wakeWrite = undefined; resolve(); });
            });
            if (!alive) break;
            cursor = out.cursor;
            if (out.closed) { term.write('\r\n[Terminal closed]\r\n'); connection('closed'); break; }
          } catch (error) {
            if (!alive) break;
            // pocket.api exposes HTTP status as `status` (not a response object).
            if (error.status === 404) { connection('closed'); onError(error.message); break; }
            connection('disconnected');
            onError(error.message);
            await new Promise(resolve => { wakeRetry = resolve; retryTimer = setTimeout(resolve, 1500); });
            wakeRetry = undefined;
          }
        }
      })();
      return () => {
        alive = false;
        accepting = false;
        if (target.current === handle) target.current = null;
        queue.dispose();
        ctrl.abort();
        clearTimeout(retryTimer);
        wakeRetry?.();
        wakeWrite?.();
        cancelAnimationFrame(resizeFrame);
        observer.disconnect();
        window.visualViewport?.removeEventListener('resize', requestResize);
        dataSubscription.dispose();
        input.dispose();
        term.dispose();
      };
    }, [id]);
    useEffect(() => { if (target.current?.id === id) target.current.configure(settings); }, [id, settings]);
    return html`<div class="pt-terminal" ref=${element} data-no-swipe></div>`;
  }

  function Page() {
    const [tabs, setTabs] = useState([]), [active, setActive] = useState(null), [error, setError] = useState('');
    const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
    const [settings, settingsError] = useSettings();
    const [extended, setExtended] = useState(false), [help, setHelp] = useState(false), [touch, setTouch] = useState(false);
    const [view, setView] = useState({ id: null, status: 'connecting', modifiers: createModifiers() });
    const target = useRef(null), selected = useRef(null), root = useRef(null);
    const choose = id => {
      if (selected.current !== id) target.current?.deactivate();
      selected.current = id;
      setActive(id);
    };
    const refresh = async () => {
      try {
        const result = await call('sessions');
        setTabs(result.sessions);
        choose(result.sessions.some(s => s.id === selected.current) ? selected.current : (result.sessions[0]?.id || null));
      } catch (failure) { setError(failure.message); throw failure; }
    };
    useEffect(() => { void refresh().catch(() => {}); }, []);
    useEffect(() => { setExtended(settings.extendedKeys); }, [settings.extendedKeys]);
    useEffect(() => {
      const query = window.matchMedia('(any-pointer: coarse)');
      const update = () => setTouch(query.matches);
      update();
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }, []);
    useLayoutEffect(() => {
      const viewport = window.visualViewport;
      if (!viewport || !root.current) return;
      let frame = 0;
      const update = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const node = root.current;
          if (!node) return;
          // Only constrain this page, never the host app. Do not fight pinch zoom.
          if (viewport.scale !== 1) { node.style.removeProperty('max-height'); return; }
          const available = viewport.offsetTop + viewport.height - node.getBoundingClientRect().top;
          node.style.maxHeight = `${Math.max(0, available)}px`;
        });
      };
      const observer = new ResizeObserver(update);
      observer.observe(root.current.parentElement);
      viewport.addEventListener('resize', update);
      viewport.addEventListener('scroll', update);
      window.addEventListener('resize', update);
      update();
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        viewport.removeEventListener('resize', update);
        viewport.removeEventListener('scroll', update);
        window.removeEventListener('resize', update);
      };
    }, []);
    const visible = settings.keybarVisibility === 'always' || (settings.keybarVisibility === 'auto' && touch);
    useLayoutEffect(() => { if (!visible) target.current?.reset(); }, [visible]);
    const create = async () => {
      setBusy(true); setError('');
      try { const session = await call('sessions', 'POST', {}); await refresh(); choose(session.id); }
      catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const remove = async id => {
      if (!confirm('Close this terminal and stop its running processes?')) return;
      // Stop local input before the close request, including clicks before the next redraw.
      if (selected.current === id) target.current?.deactivate();
      try { await call(`sessions/${id}`, 'DELETE'); await refresh(); }
      catch (failure) { setError(failure.message); /* Only an explicit reconnect can reactivate uncertain input. */ }
    };
    const rename = async session => {
      const name = prompt('Terminal name', session.name);
      if (name === null) return;
      try { await call(`sessions/${session.id}`, 'PATCH', { name }); await refresh(); }
      catch (failure) { setError(failure.message); }
    };
    const current = () => target.current?.id === selected.current ? target.current : null;
    const online = active && view.id === active && view.status === 'online';
    const press = key => { const input = current(); input?.press(key); input?.focus(); };
    const modifier = key => { current()?.toggle(key); current()?.focus(); };
    const keepFocus = event => event.preventDefault();
    const keyButton = (label, key = label, title = label) => html`<button type="button" class="pt-key" disabled=${!online}
      aria-label=${title} title=${title} onMouseDown=${keepFocus} onClick=${() => press(key)}>${label}</button>`;
    const modifierButton = (label, key) => {
      const state = view.id === active ? view.modifiers[key] : 'off';
      return html`<button type="button" disabled=${!online} class=${'pt-key pt-modifier ' + (settings.highlightModifiers && state !== 'off' ? 'is-active ' : '') + (state === 'locked' ? 'is-locked' : '')}
        aria-label=${`${label}: ${state === 'locked' ? 'locked' : state === 'once' ? 'next input' : 'off'}`}
        aria-pressed=${state !== 'off'} onMouseDown=${keepFocus} onClick=${() => modifier(key)}>${label}${state === 'locked' ? ' ▣' : state === 'once' ? ' •' : ''}</button>`;
    };
    const reconnect = async () => {
      current()?.deactivate(); setError('');
      try { await refresh(); setRevision(n => n + 1); } catch { /* refresh shows the error; no stale session is reactivated */ }
    };
    return html`<div class="pt-root" ref=${root}>
      <div class="pt-toolbar" key="toolbar"><div class="pt-tabs" aria-label="Terminal sessions">${tabs.map(session => html`<div class=${'pt-tab ' + (active === session.id ? 'selected' : '')} key=${session.id}>
        <button type="button" class="pt-select" aria-pressed=${active === session.id} onClick=${() => choose(session.id)}>${session.name}</button>
        <button type="button" title="Rename" aria-label=${`Rename ${session.name}`} onClick=${() => rename(session)}>✎</button>
        <button type="button" title="Close" aria-label=${`Close ${session.name}`} onClick=${() => remove(session.id)}>×</button>
      </div>`)}</div><button type="button" class="button" disabled=${busy} onClick=${create}>+ Terminal</button></div>
      ${(error || settingsError) && html`<div class="error-box pt-error" key="error" role="alert"><span>${error || settingsError}</span>${error && html`<button type="button" aria-label="Dismiss error" onClick=${() => setError('')}>×</button>`}</div>`}
      <div class="pt-body" key="body">${active ? html`<${TerminalView} key=${`${active}:${revision}`} id=${active} target=${target} selected=${selected} settings=${settings} onState=${setView} onError=${setError}/>` : html`<div class="pt-empty">No terminal open yet. Tap “+ Terminal” to get started.</div>`}</div>
      ${visible && html`<div class="pt-keybar" key="keybar" aria-label="Terminal extra keys" data-no-swipe>
        <div class="pt-key-row" role="group" aria-label="Standard keys">
          ${keyButton('Esc', 'Escape', 'Escape')}${keyButton('Tab')}${modifierButton('Ctrl', 'ctrl')}${modifierButton('Alt', 'alt')}
          ${!extended && view.id === active && view.modifiers.shift !== 'off' && modifierButton('Shift', 'shift')}
          ${keyButton('↑', 'ArrowUp', 'Arrow up')}${keyButton('↓', 'ArrowDown', 'Arrow down')}${keyButton('←', 'ArrowLeft', 'Arrow left')}${keyButton('→', 'ArrowRight', 'Arrow right')}${keyButton('Enter')}
          <button type="button" class="pt-key pt-more" aria-expanded=${extended} aria-label="Extended keys" onMouseDown=${keepFocus} onClick=${() => { setExtended(value => !value); current()?.focus(); }}>${extended ? 'Less' : 'More'}</button>
        </div>
        ${extended && html`<div class="pt-key-row" role="group" aria-label="Extended keys">
          ${modifierButton('Shift', 'shift')}${['Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Backspace'].map((key, n) => keyButton(['Home', 'End', 'PgUp', 'PgDn', 'Ins', 'Del', '⌫'][n], key))}
          ${Array.from({ length: 12 }, (_, n) => keyButton(`F${n + 1}`))}
          <span class="pt-key-divider" aria-hidden="true"></span>
          ${['/', '-', '|', '~', '\\', '[', ']', '{', '}'].map(character => keyButton(character))}
        </div>`}
      </div>`}
      <div class="pt-footer" key="footer"><button type="button" disabled=${!online} onMouseDown=${keepFocus} onClick=${() => current()?.focus()}>Keyboard</button>
        <span class="pt-connection" role="status">${active ? statusLabels[view.id === active ? view.status : 'connecting'] : 'No session'}</span>
        ${active && html`<button type="button" onClick=${reconnect}>Reconnect</button>`}
        <button type="button" aria-expanded=${help} onClick=${() => setHelp(value => !value)}>Settings</button>
      </div>
      ${help && html`<div class="pt-help" key="help">Menu → Extensions → terminal: visibility (Auto / Always / Never), extended keys on opening, modifier highlighting, haptic feedback, and modifier locking. Double-tap locks modifiers only when enabled in settings. IME compositions and pasted text remain unchanged.</div>`}
    </div>`;
  }
  pocket.page({ id: 'terminal', title: 'Terminal', component: Page, escape: false, swipe: false });
  pocket.rail({ id: 'terminal', title: 'Terminal', icon: 'terminal', page: 'terminal' });
  pocket.menu({ id: 'terminal', label: 'Terminal', page: 'terminal' });
}
