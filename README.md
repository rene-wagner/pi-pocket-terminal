# Pi Pocket Multi-Terminal

Owner-only multi-tab local shell terminal for Pi Pocket 0.27.0.

## Install

```bash
bash install.sh
```

Requires Linux, Node.js >=22.19, npm, native build tools (`python3`, `make`, `g++`) for node-pty. In Pi Pocket open Menu → Extensions and enable `terminal`.

## Behavior

- Up to eight separate PTYs; switching tabs or closing browser does not stop them.
- Restarting the Pi Pocket server or disabling/reloading the extension terminates PTYs.
- Owner-only API; uses Pi Pocket authentication and X-Pocket protection.
- Commands run as the OS user running Pi Pocket, with that user's filesystem and credentials.
- Do not enable on an untrusted Pi Pocket instance.

## Notes

Pi Pocket extension server API does not expose a documented raw WebSocket upgrade. This module uses long polling. Browser files are served by Pi Pocket, no CDN or extra listener.
