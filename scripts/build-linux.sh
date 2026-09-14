#!/usr/bin/env bash
# Build computer only. Output installers do not require Node.js on user computers.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ $(uname -s) == Linux ]] || { echo 'Build the Linux packages on Linux.' >&2; exit 2; }
case "${1:-$(uname -m)}" in x86_64|amd64|x64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Only x86_64 and ARM64 are supported. LoongArch/MIPS/SW64 need a separate runtime port.' >&2; exit 2;; esac
command -v node >/dev/null || { echo 'Install Node.js 24 LTS on the build computer.' >&2; exit 2; }
command -v fpm >/dev/null || { echo 'Install Ruby fpm 1.16.0 and the rpm build tools on the build computer. See docs/INSTALL.md.' >&2; exit 2; }
if [[ ${NETPIN_SKIP_INSTALL:-0} != 1 ]]; then npm ci --no-audit --no-fund; fi
npm run check
npm test
npm run test:integration
if [[ -n ${DISPLAY:-} ]]; then npm run test:desktop; else xvfb-run -a npm run test:desktop; fi
export USE_SYSTEM_FPM=true
npm run "dist:linux:$arch"
node scripts/package-metadata.mjs
printf 'Packages and SHA256SUMS are in release/.\n'
