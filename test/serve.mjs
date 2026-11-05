// Isolated static UI fixture. No real shell, production data, API endpoints, or external listener.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const deps = process.env.PI_POCKET_TERMINAL_DEPS || join(homedir(), '.pi-pocket/terminal-deps');
let pocket = process.env.POCKET_PACKAGE_DIR;
if (!pocket) {
  const require = createRequire(import.meta.url);
  try { pocket = dirname(require.resolve('pi-pocket/package.json')); }
  catch { throw new Error('Set POCKET_PACKAGE_DIR to the installed pi-pocket package. See README.md.'); }
}
const routes = new Map([
  ['/', join(root, 'test/browser.html')], ['/browser.mjs', join(root, 'test/browser.mjs')], ['/checks.mjs', join(root, 'test/browser-checks.mjs')],
  ['/vendor/preact.mjs', join(pocket, 'node_modules/preact/dist/preact.mjs')],
  ['/vendor/hooks.mjs', join(pocket, 'node_modules/preact/hooks/dist/hooks.mjs')],
  ['/vendor/htm.mjs', join(pocket, 'node_modules/htm/dist/htm.module.js')],
  ['/terminal/xterm.mjs', join(deps, 'node_modules/@xterm/xterm/lib/xterm.mjs')],
  ['/terminal/fit.mjs', join(deps, 'node_modules/@xterm/addon-fit/lib/addon-fit.mjs')],
  ['/terminal/xterm.css', join(deps, 'node_modules/@xterm/xterm/css/xterm.css')],
]);
for (const file of ['index.js', 'terminal.css', 'input-controller.mjs', 'input-queue.mjs', 'input-encoder.mjs', 'modifiers.mjs', 'preferences.mjs']) routes.set(`/terminal/${file}`, join(root, 'terminal', file));
const server = createServer(async (request, response) => {
  const file = routes.get(new URL(request.url, 'http://localhost').pathname);
  if (request.method !== 'GET' || !file) { response.writeHead(404).end(); return; }
  try {
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'text/javascript', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch (error) { console.error(error.message); response.writeHead(500).end('Fixture asset unavailable'); }
});
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => console.log(`Isolated terminal fixture: http://127.0.0.1:${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit()));
