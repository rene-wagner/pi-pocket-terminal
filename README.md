# Pi Pocket Multi-Terminal

Owner-only Linux terminals with multiple tabs and a mobile extra key toolbar for Pi Pocket 0.27.0 or later.

## Installation and updates

```bash
bash install.sh
```

Requirements: Linux, Node.js ≥22.19, npm, and `python3`, `make`, and `g++` for node-pty. In Pi Pocket, enable the `terminal` extension under **Menu → Extensions**.

The script installs the existing dependencies and bundles browser assets locally. The tested versions are **xterm.js 6.0.0** and **FitAddon 0.11.0**. Neither a CDN nor an additional terminal server is required. Set `PI_POCKET_DIR` to change the installation directory.

**Save work in running terminals before updating.** Replacing `terminal.ts` can reload the extension. Reloading/disabling the extension or restarting the Pi Pocket server terminates its PTYs, as before. Reloading the browser or switching tabs does not. The live installation was not replaced during this development.

## Usage

- Up to eight independent PTYs; sessions remain available after closing the browser.
- Extra keys control only the selected terminal tab.
- **Keyboard** focuses the active session's input element. Browsers may still restrict opening the on-screen keyboard.
- Standard toolbar: **Esc · Tab · Ctrl · Alt · ↑ · ↓ · ← · → · Enter**.
- The toolbar scrolls horizontally. On narrow displays, **Enter** and **More** may be off-screen to the right.
- **More** opens a second scrollable row: **Shift, Home, End, PgUp, PgDn, Insert, Delete, Backspace, F1–F12**, and `/ - | ~ \ [ ] { }`.
- Delete sends a different sequence from Backspace. Extra keys have touch targets of at least 44 × 44 CSS pixels.

### Modifiers

1. Tap **Ctrl**, **Alt**, or **Shift** once to activate it for the next suitable input (`•`).
2. Then tap an extra key or type a single ASCII letter on the on-screen keyboard. For example, **Ctrl → c** sends only `\x03`.
3. One-shot modifiers reset after the local input channel accepts the input. Tapping the modifier again also turns it off.

Modifiers can be combined independently. When modifier locking is enabled, double-tapping within 350 ms locks a modifier (`▣`). One more tap releases it. An active Shift modifier remains visible even after collapsing the extended row.

Switching tabs, losing the connection, or hiding the toolbar resets modifiers. The toolbar does not automatically repeat keys. Without active virtual modifiers, the physical keyboard stays on xterm's normal input path; no global keyboard handlers are installed.

## Settings

Under **Menu → Extensions → terminal**, Pi Pocket saves settings through its documented extension API. Values apply to the extension and are distributed to connected browsers; they are not device-specific browser preferences.

| Setting | Default | Behavior |
| --- | --- | --- |
| Show extra key toolbar | Auto | Uses `any-pointer: coarse`, for example on phones, tablets, or touch-enabled hybrid devices |
| Visibility: Always / Never | – | Manually show or hide the toolbar regardless of device detection |
| Show extended keys on opening | Off | Initial display preference; **More/Less** changes the current view |
| Highlight active modifiers | On | Adds a border; state symbols and `aria-pressed` remain available without highlighting |
| Haptic feedback | Off | Brief vibration if the browser supports `navigator.vibrate()` |
| Lock modifiers on double-tap | Off | Enables optional persistent modifier locking |

The **Settings** button below the terminal explains where to find this configuration. The extension needs neither its own configuration endpoints nor `localStorage`. If loading fails, it displays a message and uses defaults.

## Input path and security

```text
Touch key / suitable keyboard input
  → modifiers + mode-aware encoder
  → xterm.input()
  → existing onData
  → session-bound, serial input queue
  → pocket.api('sessions/:id/input')
  → existing owner check and node-pty
```

- All existing terminal routes remain owner-only and use Pi Pocket authentication and `X-Pocket` protection.
- The toolbar adds no production endpoints, ports, terminal processes, or backend dependencies.
- Shells still run as the Pi Pocket operating system user, with that user's file access and credentials. Do not enable the extension on an untrusted instance.
- Closed or disconnected sessions receive no new local input. Stale controllers are deactivated immediately when switching tabs and then disposed.
- Input requests are sent in order, in chunks of up to 4096 UTF-16 code units, without splitting surrogate pairs. The local queue is limited to 64 Ki code units.
- **Failed input is never retried automatically.** A request that has already started may have reached the PTY even if its response is missing. Pending local data is discarded. After an input failure, you must explicitly select **Reconnect**.
- Output polling may reconnect after connection failures; this does not repeat user input. **Reconnect** also refreshes the session list and does not start a new shell.
- Terminal replies and paste are not indiscriminately re-encoded as keystrokes.

Pi Pocket does not provide a documented raw WebSocket upgrade here. The existing long-polling channel remains in use. The server still retains up to 256 Ki code units of output per session for reconnection.

## Technical limitations

- The encoder uses public xterm APIs (`input`, `modes`, `textarea`, `focus`, `attachCustomKeyEventHandler`), not private `_core` fields. It respects application cursor mode; modified navigation uses traditional xterm CSI parameters.
- Shift for virtual ASCII characters uses the **US-ASCII layout**. Already shifted characters such as `{` are preserved. Without virtual modifiers, the physical keyboard continues to use its own layout unchanged.
- Ctrl supports A–Z, Space/@/2, [/3, Backslash/4, ]/5, ^/6, _/7/Slash, and ?/8. Ctrl+Backspace sends `\x08`; ordinary Backspace sends `\x7f`. Undefined Ctrl combinations are not invented: normal input is preserved and the modifier remains pending.
- Shift+Tab uses `CSI Z`; Ctrl+Tab is indistinguishable from Tab. CSI-u, the Kitty keyboard protocol, and additional Shift byte encoding are not implemented.
- **IME compositions, dead keys, compound Unicode characters, paste, and multi-character input are not transformed into Ctrl/Alt/Shift combinations.** Modifiers remain active for these inputs. During an active composition, the toolbar sends no extra keys: confirm the composition first or cancel it using the native keyboard. Simple, non-composing ASCII input is also handled through mobile keycode-229 and input-event-only paths.
- For owned non-IME keycode-229 input, the controller prevents xterm's deferred textarea-difference path. A capture listener on the parent element processes input before xterm's own textarea listener. The extension does not clear or modify the textarea content itself.
- The toolbar adjusts only its own layout using `visualViewport` and `ResizeObserver`. Native on-screen keyboards, pinch zoom, browser chrome, and focus rules remain platform-dependent. **Android Chrome and iOS Safari still need testing on real devices.** Chromium viewport tests are not a substitute.
- Safari/iOS typically does not support the vibration API. Haptic feedback is optional, not a functional requirement.

## Running tests

### Automated Node tests

No additional test dependencies are required:

```bash
npm test
bash -n install.sh
node --check terminal/index.js
```

Coverage includes the encoder, all modifier combinations, state transitions, mobile input transactions, Unicode/IME protection, tab/disconnect queues, and unchanged owner-only route registration.

### Isolated browser fixture

The fixture uses real xterm and Preact, but **simulated terminal data with no shell and no live Pi Pocket data**. Its static development server binds only to loopback on a random port:

```bash
POCKET_PACKAGE_DIR="$(npm root -g)/pi-pocket" npm run test:browser
```

For a different Pi Pocket installation, set `POCKET_PACKAGE_DIR` to its package directory. Terminal dependencies are read from `~/.pi-pocket/terminal-deps` by default; `PI_POCKET_TERMINAL_DEPS` can override this path.

Open the printed local URL in Chromium. In the browser console, run:

```javascript
await (await import('/checks.mjs')).runBrowserChecks()
```

Reload the fixture before each subsequent run. The report lists every checked case. Checks include initial terminal replies, virtual modifiers, keycode 229, capture order, paste, compositions, mode changes, overlapping resizes, tab switches, and uncertain input failures. Synthetic events do not validate the operating system's native touch/IME implementation. Press `Ctrl+C` in the server terminal to stop the fixture.

### Real, short-lived Linux PTYs

```bash
npm run test:pty
```

The script uses the existing node-pty installation, temporary files, isolated configuration, and a private tmux socket when applicable. It does not modify Pi Pocket sessions or install programs. Missing programs are reported as **SKIP**, not as passed.

## Test results

| Check | Result |
| --- | --- |
| Node tests | 42 passed, 0 failed |
| Chromium fixture, desktop 1280×800 | 16 passed, 0 failed |
| Chromium fixture, portrait 390×844 | 16 passed, 0 failed |
| Chromium fixture, landscape 844×390 | 16 passed, 0 failed |
| Small viewport 390×240 | No horizontal page overflow; terminal, both key rows, and footer visible |
| Chromium, real browser keyboard events | Ordinary `a`, physical Ctrl+C, and virtual Ctrl → c correct; terminal focus retained |
| Linux PTY suite | 7 passed, 0 failed, 3 skipped |
| Bash | Tab completion, Ctrl+C, Ctrl+D, Ctrl+Z, arrows, and Home/End checked |
| Raw data in a real PTY | Delete/Backspace, F1–F12, and selected modifiers checked |
| tmux | Isolated shell/input/detach smoke test passed; not a complete application test matrix |
| Vim, Nano, htop | Skipped: programs not installed on this machine |
| Native Android/iOS keyboard and real touch gestures | Not tested |
| Full Pi Pocket UI/authentication integration | Not re-tested end to end; existing routes and permissions unchanged |

Outstanding device acceptance: check Android Chrome and iOS Safari with the on-screen keyboard, Ctrl → c, Escape, horizontal scrolling, portrait/landscape rotation, and reconnection. Check Vim, Nano, and htop when available, using the configurations actually in use.

## Code layout

- `terminal.ts`: existing PTY/owner routes, plus the five settings fields.
- `terminal/index.js`: UI, active session controller, focus, status, and resizing.
- `terminal/input-encoder.mjs`: pure character and control-sequence encoding.
- `terminal/modifiers.mjs`: pure, immutable modifier states.
- `terminal/input-controller.mjs`: integration of virtual keys, keyboard/input events, and composition protection.
- `terminal/input-queue.mjs`: ordered, bounded delivery without retries.
- `terminal/preferences.mjs`: defaults and validation for settings read by the client.
- `terminal/terminal.css`: responsive, theme-aware touch toolbar.
- `install.sh`: installation of all client modules and pinning of tested xterm versions.
- `package.json`, `test/`: test commands, unit tests, browser fixture, and PTY smoke tests.
