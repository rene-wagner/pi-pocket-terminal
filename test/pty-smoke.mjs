import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { accessSync, constants, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encodeKey } from '../terminal/input-encoder.mjs';

// These checks exercise disposable Linux PTYs, not Pocket sessions or a browser.
// PI_POCKET_TERMINAL_DEPS names the terminal-deps directory (not node_modules).
const deps = resolve(process.env.PI_POCKET_TERMINAL_DEPS || join(homedir(), '.pi-pocket', 'terminal-deps'));
const modulePath = join(deps, 'node_modules', 'node-pty');
const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
const report = (kind, name, detail = '') => {
  counts[kind]++;
  console.log(`${kind} ${name}${detail ? `: ${detail}` : ''}`);
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const plain = text => text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b[()][0-2A-Z]/g, '').replace(/\x1b[=>]/g, '');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const key = (name, modifiers, modes) => {
  const bytes = encodeKey(name, modifiers, modes);
  assert.notEqual(bytes, null, `encoder must support ${name}`);
  return bytes;
};

let pty;
let root;
const active = new Set();
const envFor = directory => ({
  PATH: process.env.PATH || '/usr/bin:/bin',
  HOME: directory,
  XDG_CONFIG_HOME: join(directory, 'config'),
  XDG_CACHE_HOME: join(directory, 'cache'),
  XDG_DATA_HOME: join(directory, 'data'),
  XDG_STATE_HOME: join(directory, 'state'),
  TMPDIR: directory,
  HTOPRC: join(directory, 'htoprc'),
  INPUTRC: '/dev/null', HISTFILE: '/dev/null',
  LANG: 'C', LC_ALL: 'C', TERM: 'xterm-256color',
  PS1: '__PTY_PROMPT__ ', PS2: '__PTY_CONTINUE__ '
});

// command -v receives a positional argument, never interpolated shell source.
function executable(name) {
  const result = spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'pty-smoke', name], {
    env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C' },
    encoding: 'utf8', timeout: 2000, maxBuffer: 65536
  });
  if (result.error) throw result.error;
  if (result.status !== 0) return null;
  const path = result.stdout.trim();
  try { accessSync(path, constants.X_OK); return path; } catch { return null; }
}

// Record only descendants of a PTY that this script created. This also finds
// Bash job-control children, whose process groups differ from the shell group.
function descendants(pid, result = new Set()) {
  try {
    const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean);
    for (const child of children) {
      const id = Number(child);
      if (!result.has(id)) { result.add(id); descendants(id, result); }
    }
  } catch { /* The process can exit between reading /proc entries. */ }
  return result;
}

function terminal(file, args, directory) {
  const child = pty.spawn(file, args, { name: 'xterm-256color', cols: 120, rows: 36, cwd: directory, env: envFor(directory) });
  let output = '';
  let exit;
  const owned = new Set();
  const collect = () => { for (const pid of descendants(child.pid)) owned.add(pid); };
  const timer = setInterval(collect, 50);
  const dataSubscription = child.onData(data => { output += data; collect(); });
  const exitSubscription = child.onExit(event => { exit = event; });
  const session = {
    get output() { return output; },
    get exit() { return exit; },
    send(data) { assert.equal(exit, undefined, 'PTY exited before input'); child.write(data); },
    async wait(pattern, from = 0, timeout = 6000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const text = plain(output.slice(from));
        if (typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)) return text;
        if (exit) throw new Error(`PTY exited (${exit.exitCode}/${exit.signal}) before ${pattern}; tail=${JSON.stringify(text.slice(-700))}`);
        await pause(20);
      }
      throw new Error(`timeout waiting for ${pattern}; tail=${JSON.stringify(plain(output.slice(from)).slice(-700))}`);
    },
    async exited(timeout = 6000) {
      const end = Date.now() + timeout;
      while (!exit && Date.now() < end) await pause(20);
      assert.ok(exit, `PTY did not exit; tail=${JSON.stringify(plain(output).slice(-700))}`);
      return exit;
    },
    async close() {
      collect();
      clearInterval(timer);
      for (const pid of [...owned].reverse()) {
        try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      if (!exit) {
        try { child.kill('SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        const end = Date.now() + 1000;
        while (!exit && Date.now() < end) await pause(20);
        assert.ok(exit, 'PTY cleanup did not observe process exit');
      }
      dataSubscription.dispose();
      exitSubscription.dispose();
      active.delete(session);
    }
  };
  active.add(session);
  return session;
}

async function withTerminal(file, args, directory, task) {
  const session = terminal(file, args, directory);
  try { await task(session); } finally { await session.close(); }
}

const tools = {};
async function check(name, required, task) {
  const missing = required.filter(name => !tools[name]);
  if (missing.length) { report('SKIP', name, `missing executable: ${missing.join(', ')}`); return; }
  const directory = mkdtempSync(join(root, 'case-'));
  for (const name of ['config', 'cache', 'data', 'state']) mkdirSync(join(directory, name));
  try { await task(directory); report('PASS', name); }
  catch (error) { report('FAIL', name, error.stack || error.message); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

const prompt = '__PTY_PROMPT__ ';
async function bash(directory, task) {
  await withTerminal(tools.bash, ['--noprofile', '--norc', '-i'], directory, async session => {
    await session.wait(prompt);
    const start = session.output.length;
    session.send("set +o history; bind 'set enable-bracketed-paste off'; bind 'set editing-mode emacs'" + key('Enter'));
    await session.wait(prompt, start);
    await task(session);
  });
}

async function main() {
  if (!existsSync(modulePath)) {
    report('SKIP', 'PTY smoke suite', `node-pty not installed at ${modulePath}`);
    return;
  }
  pty = createRequire(import.meta.url)(modulePath);
  root = mkdtempSync(join(tmpdir(), 'pocket-pty-smoke-'));
  for (const name of ['bash', 'vim', 'nano', 'htop', 'tmux']) tools[name] = executable(name);

  await check('Bash Tab completion', ['bash'], async directory => {
    writeFileSync(join(directory, 'smoke-completion-only.txt'), 'temporary fixture\n');
    await bash(directory, async session => {
      const start = session.output.length;
      session.send("printf '<COMPLETE:%s>\\n' smoke-comple" + key('Tab') + key('Enter'));
      await session.wait(/(?:^|\n)<COMPLETE:smoke-completion-only\.txt>\r?\n/, start);
    });
  });

  await check('Bash Ctrl+C interrupts a blocking read', ['bash'], async directory => {
    await bash(directory, async session => {
      let start = session.output.length;
      session.send("printf '\\n__BLOCKED__\\n'; read -r value" + key('Enter'));
      await session.wait(/\n__BLOCKED__\r?\n/, start);
      start = session.output.length;
      session.send(key('c', { ctrl: true }));
      await session.wait(prompt, start);
      start = session.output.length;
      session.send("printf '\\n__INTERRUPTED:%s__\\n' \"$?\"" + key('Enter'));
      await session.wait(/\n__INTERRUPTED:130__\r?\n/, start);
    });
  });

  await check('Bash Ctrl+D exits at an empty prompt', ['bash'], async directory => {
    await bash(directory, async session => {
      session.send(key('d', { ctrl: true }));
      assert.equal((await session.exited()).exitCode, 0);
    });
  });

  await check('Bash Ctrl+Z suspends a foreground job', ['bash'], async directory => {
    await bash(directory, async session => {
      let start = session.output.length;
      session.send(`${quote(tools.bash)} --noprofile --norc -c ${quote('printf "\\n__JOB_READY__\\n"; read -r value')}` + key('Enter'));
      await session.wait(/\n__JOB_READY__\r?\n/, start);
      start = session.output.length;
      session.send(key('z', { ctrl: true }));
      await session.wait(/Stopped/, start);
      await session.wait(prompt, start);
      start = session.output.length;
      session.send("jobs -l; kill -KILL %1; wait %1 2>/dev/null; printf '\\n__JOB_CLEANED__\\n'" + key('Enter'));
      await session.wait(/\n__JOB_CLEANED__\r?\n/, start);
    });
  });

  await check('Bash cursor, Home, and End edit the command line', ['bash'], async directory => {
    await bash(directory, async session => {
      const start = session.output.length;
      session.send("printf '<EDIT:%s>\\n' ac" + key('ArrowLeft') + 'b' + key('ArrowRight') + 'd' + key('Home') + ' ' + key('End') + 'e' + key('Enter'));
      await session.wait(/\n<EDIT:abcde>\r?\n/, start);
    });
  });

  await check('raw PTY bytes: Delete, Backspace, F1-F12, and modifiers', [], async directory => {
    const samples = [
      ['Delete', {}, '\x1b[3~'], ['Backspace', {}, '\x7f'],
      ['Backspace', { ctrl: true }, '\x08'], ['Backspace', { alt: true }, '\x1b\x7f'],
      ['Delete', { ctrl: true, alt: true, shift: true }, '\x1b[3;8~']
    ];
    for (const [i, final] of ['P', 'Q', 'R', 'S'].entries()) {
      samples.push([`F${i + 1}`, {}, `\x1bO${final}`], [`F${i + 1}`, { ctrl: true, alt: true, shift: true }, `\x1b[1;8${final}`]);
    }
    for (const [i, value] of [15, 17, 18, 19, 20, 21, 23, 24].entries()) {
      samples.push([`F${i + 5}`, {}, `\x1b[${value}~`], [`F${i + 5}`, { ctrl: true, alt: true, shift: true }, `\x1b[${value};8~`]);
    }
    const expected = Buffer.from(samples.map(sample => sample[2]).join(''), 'ascii');
    const reader = join(directory, 'read-raw.cjs');
    writeFileSync(reader, `process.stdin.setRawMode(true); process.stdin.resume(); let chunks=[]; let size=0; console.log('__RAW_READY__'); process.stdin.on('data', chunk => { chunks.push(chunk); size+=chunk.length; if(size>=${expected.length}) { console.log('__HEX:'+Buffer.concat(chunks).toString('hex')+'__'); process.exit(0); } });`);
    await withTerminal(process.execPath, [reader], directory, async session => {
      await session.wait('__RAW_READY__');
      const start = session.output.length;
      session.send(samples.map(([name, modifiers]) => key(name, modifiers)).join(''));
      const result = await session.wait(/__HEX:([0-9a-f]+)__/, start);
      assert.equal(result.match(/__HEX:([0-9a-f]+)__/)[1], expected.toString('hex'));
      assert.equal((await session.exited()).exitCode, 0);
    });
  });

  await check('Vim Escape and all four arrows: saved-content smoke', ['vim'], async directory => {
    const file = join(directory, 'fixture.txt');
    writeFileSync(file, 'ac\nzz\n');
    await withTerminal(tools.vim, ['-Nu', 'NONE', '-U', 'NONE', '-i', 'NONE', '-n', '--noplugin', '-N', '-c', 'set ttimeoutlen=50', 'fixture.txt'], directory, async session => {
      await session.wait('fixture.txt');
      session.send('iX' + key('Escape'));
      await pause(100);
      const modes = { applicationCursorKeysMode: true };
      session.send(key('ArrowRight', {}, modes) + 'rB' + key('ArrowDown', {}, modes) + key('ArrowLeft', {}, modes) + 'rY' + key('ArrowUp', {}, modes) + 'rQ:wq' + key('Enter'));
      assert.equal((await session.exited()).exitCode, 0);
      assert.equal(readFileSync(file, 'utf8'), 'QBc\nYz\n');
    });
  });

  await check('Nano insert/save smoke', ['nano'], async directory => {
    const file = join(directory, 'fixture.txt');
    writeFileSync(file, 'seed\n');
    await withTerminal(tools.nano, ['--ignorercfiles', 'fixture.txt'], directory, async session => {
      await session.wait('GNU nano');
      let start = session.output.length;
      session.send('NANO_SMOKE' + key('o', { ctrl: true }));
      await session.wait('File Name to Write', start);
      start = session.output.length;
      session.send(key('Enter'));
      await session.wait(/Wrote .*line/, start);
      session.send(key('x', { ctrl: true }));
      assert.equal((await session.exited()).exitCode, 0);
      assert.equal(readFileSync(file, 'utf8'), 'NANO_SMOKEseed\n');
    });
  });

  await check('htop startup/input smoke (arrows and F10 exit)', ['htop'], async directory => {
    await withTerminal(tools.htop, ['-C'], directory, async session => {
      await session.wait(/Tasks|Load average|Mem/);
      session.send(key('ArrowDown', {}, { applicationCursorKeysMode: true }) + key('ArrowUp', {}, { applicationCursorKeysMode: true }) + key('F10'));
      assert.equal((await session.exited()).exitCode, 0);
    });
  });

  await check('tmux isolated-server shell/input and detach smoke', ['tmux', 'bash'], async directory => {
    const socket = join(directory, 'tmux.sock');
    // tmux starts a command through a non-interactive shell, which can remove
    // PS1 from the environment. An explicit temporary rcfile sets the prompt.
    const rcfile = join(directory, 'bashrc');
    writeFileSync(rcfile, "PS1='__PTY_PROMPT__ '; HISTFILE=/dev/null; set +o history\n");
    try {
      await withTerminal(tools.tmux, ['-S', socket, '-f', '/dev/null', 'new-session', '-s', 'smoke', `exec ${quote(tools.bash)} --noprofile --rcfile ${quote(rcfile)} -i`], directory, async session => {
        await session.wait(prompt);
        const start = session.output.length;
        session.send("printf '\\n__TMUX_INPUT__\\n'" + key('Enter'));
        await session.wait(/\n__TMUX_INPUT__\r?\n/, start);
        session.send(key('b', { ctrl: true }) + 'd');
        assert.equal((await session.exited()).exitCode, 0);
      });
    } finally {
      // This exact private socket belongs to this test, never the default server.
      const result = spawnSync(tools.tmux, ['-S', socket, 'kill-server'], {
        env: envFor(directory), encoding: 'utf8', timeout: 2000, maxBuffer: 65536
      });
      if (result.error) throw result.error;
      if (result.status !== 0 && existsSync(socket)) throw new Error(`private tmux cleanup failed: ${result.stderr}`);
    }
  });
}

try { await main(); }
catch (error) { report('FAIL', 'PTY smoke harness', error.stack || error.message); }
finally {
  for (const session of [...active]) {
    try { await session.close(); } catch (error) { report('FAIL', 'PTY cleanup', error.message); }
  }
  if (root) rmSync(root, { recursive: true, force: true });
  console.log(`SUMMARY PASS=${counts.PASS} FAIL=${counts.FAIL} SKIP=${counts.SKIP}`);
  if (counts.FAIL) process.exitCode = 1;
}
