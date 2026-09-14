#!/bin/sh
# Package-manager hook. Preserve Chromium sandbox; do not set --no-sandbox.
set -eu
sandbox='/opt/NetPin/chrome-sandbox'
if [ -f "$sandbox" ]; then
  chown root:root "$sandbox"
  chmod 4755 "$sandbox"
fi
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database /usr/share/applications >/dev/null 2>&1 || true; fi
