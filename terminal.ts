/** Owner-only multi-tab terminal for Pi Pocket. Runs local shells as the server user. */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
type Session = { id: string; name: string; pty: any; output: string; offset: number; waiters: Set<() => void>; created: number };
const sessions = new Map<string, Session>();
const MAX_SESSIONS = 8;
const MAX_BUFFER = 256 * 1024;
const MAX_INPUT = 8192;
let ptyModule: any;

function getPty() {
  if (ptyModule) return ptyModule;
  const candidates = [resolve(homedir(), '.pi-pocket/terminal-deps/node_modules/node-pty'), 'node-pty'];
  for (const candidate of candidates) {
    try { ptyModule = require(candidate); return ptyModule; } catch { /* try next */ }
  }
  throw new Error('node-pty is missing. Please run the installation script.');
}
function wake(s: Session) { for (const w of s.waiters) w(); s.waiters.clear(); }
function append(s: Session, text: string) {
  s.output += text;
  if (s.output.length > MAX_BUFFER) {
    const cut = s.output.length - MAX_BUFFER;
    s.output = s.output.slice(cut);
    s.offset += cut;
  }
  wake(s);
}
function getSession(id: string, web: any): Session {
  const s = sessions.get(id);
  if (!s) throw web.error(404, 'Terminal not found');
  return s;
}
function dimension(n: unknown, fallback: number, max: number) {
  const v = Number(n);
  return Number.isInteger(v) && v >= 2 && v <= max ? v : fallback;
}
function getBody(body: any) { return body && typeof body === 'object' ? body : {}; }

export default function createTerminal(_host: any, web: any) {
  if (typeof web.settings === 'function') web.settings([
    { name: 'keybarVisibility', label: 'Show extra key toolbar', type: 'choice', default: 'auto', choices: [
      { value: 'auto', label: 'Auto (touch devices)' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }
    ] },
    { name: 'extendedKeys', label: 'Show extended keys on opening', type: 'boolean', default: false },
    { name: 'highlightModifiers', label: 'Highlight active modifiers', type: 'boolean', default: true },
    { name: 'hapticFeedback', label: 'Haptic feedback', description: 'Only in browsers that support vibration.', type: 'boolean', default: false },
    { name: 'lockModifiers', label: 'Lock modifiers on double-tap', type: 'boolean', default: false },
  ]);
  web.route('GET', 'sessions', () => ({ sessions: [...sessions.values()].map(s => ({ id:s.id, name:s.name, created:s.created })) }), {access:'owner'});
  web.route('POST', 'sessions', ({body}: any) => {
    if (sessions.size >= MAX_SESSIONS) throw web.error(409, 'A maximum of eight terminals is allowed');
    const b = getBody(body);
    const id = randomUUID();
    const name = typeof b.name === 'string' ? b.name.trim().slice(0,48) : '';
    const shell = existsSync('/bin/bash') ? '/bin/bash' : (process.env.SHELL || '/bin/sh');
    const pty = getPty().spawn(shell, [], {
      name:'xterm-256color', cols:dimension(b.cols,80,500), rows:dimension(b.rows,24,200),
      cwd:process.env.HOME || homedir(), env:{...process.env, TERM:'xterm-256color'}
    });
    const s: Session = {id, name:name || `Terminal ${sessions.size + 1}`, pty, output:'', offset:0, waiters:new Set(), created:Date.now()};
    sessions.set(id,s);
    pty.onData((data:string) => append(s,data));
    pty.onExit(({exitCode}:any) => { append(s, `\r\n[Shell exited: ${exitCode}]\r\n`); sessions.delete(id); wake(s); });
    return {id:s.id,name:s.name,created:s.created};
  }, {access:'owner'});
  web.route('PATCH', 'sessions/:id', ({params,body}:any) => {
    const s = getSession(params.id,web); const name = getBody(body).name;
    if (typeof name !== 'string' || !name.trim() || name.length > 48) throw web.error(400,'Invalid name');
    s.name = name.trim(); return {ok:true};
  }, {access:'owner'});
  web.route('DELETE', 'sessions/:id', ({params}:any) => {
    const s = getSession(params.id,web); sessions.delete(s.id); wake(s); s.pty.kill(); return {ok:true};
  }, {access:'owner'});
  web.route('POST', 'sessions/:id/input', ({params,body}:any) => {
    const s = getSession(params.id,web); const data = getBody(body).data;
    if (typeof data !== 'string' || data.length > MAX_INPUT) throw web.error(400,'Invalid input');
    s.pty.write(data); return {ok:true};
  }, {access:'owner'});
  web.route('POST', 'sessions/:id/resize', ({params,body}:any) => {
    const s = getSession(params.id,web); const b = getBody(body);
    s.pty.resize(dimension(b.cols,80,500), dimension(b.rows,24,200)); return {ok:true};
  }, {access:'owner'});
  web.route('GET', 'sessions/:id/output', async ({params,query,signal}:any) => {
    const s = getSession(params.id,web);
    const n = Number(query.get('cursor'));
    const cursor = Number.isSafeInteger(n) && n >= 0 ? n : 0;
    const read = () => {
      const end = s.offset + s.output.length;
      const start = Math.max(cursor,s.offset);
      return {data:s.output.slice(start-s.offset), cursor:end, truncated:cursor<s.offset, closed:!sessions.has(s.id)};
    };
    if (cursor >= s.offset+s.output.length && sessions.has(s.id) && !signal.aborted) {
      await new Promise<void>(done => {
        const timer = setTimeout(finish, 20000);
        function finish() { clearTimeout(timer); s.waiters.delete(finish); signal.removeEventListener('abort',finish); done(); }
        s.waiters.add(finish); signal.addEventListener('abort',finish,{once:true});
        if (cursor < s.offset+s.output.length || !sessions.has(s.id)) finish();
      });
    }
    return read();
  }, {access:'owner'});
  web.client('terminal');
  web.onDispose(() => {
    for (const s of sessions.values()) { wake(s); try{s.pty.kill();}catch{} }
    sessions.clear();
  });
}
