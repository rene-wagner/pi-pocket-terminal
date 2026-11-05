import { h, render } from '/vendor/preact.mjs';
import { useState, useEffect, useLayoutEffect, useRef } from '/vendor/hooks.mjs';
import htm from '/vendor/htm.mjs';
import setup from '/terminal/index.js';

const settingsListeners = new Set();
const sessions = new Map([
  ['one', { id: 'one', name: 'Terminal 1', output: '\x1b[?1lIsolated terminal fixture (no shell)\r\n$ \x1b[6n' }],
  ['two', { id: 'two', name: 'Terminal 2', output: '\x1b[?1lSecond session\r\n$ ' }],
]);
const inputs = [], resizes = [];
let number = 2;
const mock = window.terminalTest = {
  inputs, resizes, sessions, failure: null,
  values: { keybarVisibility: 'always', extendedKeys: false, highlightModifiers: true, hapticFeedback: false, lockModifiers: false },
  settings(values) { Object.assign(this.values, values); for (const run of settingsListeners) run(); },
  output(id, text) { sessions.get(id).output += text; },
};
let Page;
setup({
  html: htm.bind(h), useState, useEffect, useLayoutEffect, useRef,
  style() {}, page(spec) { Page = spec.component; }, rail() {}, menu() {},
  settings: async () => ({ values: mock.values }),
  onSettings(run) { settingsListeners.add(run); return () => settingsListeners.delete(run); },
  async api(path, body, { method = 'GET', signal } = {}) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (mock.failure === 'all' || mock.failure === path || (mock.failure === 'input' && path.endsWith('/input'))) throw new Error('Simulated connection failure');
    if (path === 'sessions') {
      if (method === 'GET') return { sessions: [...sessions.values()].map(({ id, name }) => ({ id, name })) };
      const id = `fixture-${++number}`; sessions.set(id, { id, name: `Terminal ${number}`, output: '$ ' }); return sessions.get(id);
    }
    const [_, id, operation] = path.match(/^sessions\/([^/]+)(?:\/(.*))?$/) || [];
    const session = sessions.get(id);
    if (!session) throw Object.assign(new Error('Terminal not found'), { status: 404 });
    if (operation === 'input') { inputs.push({ id, data: body.data }); return { ok: true }; }
    if (operation === 'resize') { if (mock.resizeDelay) await new Promise(resolve => setTimeout(resolve, mock.resizeDelay)); resizes.push({ id, ...body }); return { ok: true }; }
    if (operation?.startsWith('output')) {
      const cursor = Number(new URLSearchParams(operation.split('?')[1]).get('cursor')) || 0;
      if (cursor >= session.output.length) await new Promise((done, reject) => {
        const finish = () => { signal?.removeEventListener('abort', abort); done(); };
        const timer = setTimeout(finish, 100);
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Aborted', 'AbortError')); };
        signal?.addEventListener('abort', abort, { once: true });
      });
      return { data: session.output.slice(cursor), cursor: session.output.length, closed: !sessions.has(id) };
    }
    if (method === 'PATCH') session.name = body.name;
    if (method === 'DELETE') sessions.delete(id);
    return { ok: true };
  },
});
document.getElementById('app').replaceChildren();
render(h(Page), document.getElementById('app'));
