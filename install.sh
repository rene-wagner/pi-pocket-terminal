#!/usr/bin/env bash
set -euo pipefail
ROOT="${PI_POCKET_DIR:-$HOME/.pi-pocket}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$ROOT/extensions/terminal" "$ROOT/terminal-deps"
cd "$ROOT/terminal-deps"
[ -f package.json ] || printf '{"private":true,"type":"commonjs"}\n' > package.json
npm install --no-audit --no-fund node-pty @xterm/xterm @xterm/addon-fit
cp "$HERE/terminal.ts" "$ROOT/extensions/terminal.ts"
cp "$HERE/terminal/index.js" "$HERE/terminal/terminal.css" "$ROOT/extensions/terminal/"
cp node_modules/@xterm/xterm/css/xterm.css "$ROOT/extensions/terminal/xterm.css"
# Bundle ESM modules so Pi Pocket's same-origin CSP permits them without a CDN.
npm install --no-audit --no-fund esbuild
cp "$HERE/terminal/xterm-entry.js" "$HERE/terminal/fit-entry.js" "$ROOT/terminal-deps/"
./node_modules/.bin/esbuild "$ROOT/terminal-deps/xterm-entry.js" --bundle --format=esm --platform=browser --outfile="$ROOT/extensions/terminal/xterm.mjs"
./node_modules/.bin/esbuild "$ROOT/terminal-deps/fit-entry.js" --bundle --format=esm --platform=browser --outfile="$ROOT/extensions/terminal/fit.mjs"
sed -i "1i @import './xterm.css';" "$ROOT/extensions/terminal/terminal.css"
printf 'Installiert unter %s/extensions/terminal.ts\nPi Pocket: Menü → Extensions → terminal aktivieren.\n' "$ROOT"
