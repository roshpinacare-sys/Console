#!/usr/bin/env bash
# Console harness init — the standard verification entrypoint (LHE adoption, Task 19)
cd "$(dirname "$0")"   # location-independent
set -e

echo "[console-init] structure"
test -f README.md || { echo "FAIL: README.md missing"; exit 1; }
test -d assets || { echo "FAIL: assets/ missing (mobile layer)"; exit 1; }
test -f assets/site.js || { echo "FAIL: assets/site.js missing (shared layer)"; exit 1; }
test -f assets/site.css || { echo "FAIL: assets/site.css missing (shared layer)"; exit 1; }

echo "[console-init] JS syntax gate"
for f in acid-engine.js gate-crypto.js saos-live.js assets/site.js; do
  if [ -f "$f" ]; then node --check "$f" >/dev/null; echo "  ok $f"; fi
done

echo "[console-init] book validity (public replay books must parse)"
for j in ledger.json status.json; do
  if [ -f "$j" ]; then node -e "JSON.parse(require('fs').readFileSync('$j','utf8'))" && echo "  ok $j"; fi
done

echo "CONSOLE-INIT-OK — restartable from AGENTS.md + the books"
