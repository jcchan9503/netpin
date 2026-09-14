#!/usr/bin/env bash
# End-user, offline installation. Downloads nothing; never changes sandbox/security policy.
set -euo pipefail
usage(){ printf 'Usage: bash install-linux.sh /path/to/NetPin-version-linux-arch.deb|rpm\nPut SHA256SUMS from the same build next to the package.\n'; }
if [[ $# != 1 ]]; then usage; exit 2; fi
[[ $(uname -s) == Linux ]] || { echo 'This installer is for Linux.' >&2; exit 2; }
case $(uname -m) in x86_64|amd64) debarch=amd64; rpmarch=x86_64;; aarch64|arm64) debarch=arm64; rpmarch=aarch64;; *) echo 'Unsupported CPU: no LoongArch, MIPS or SW64 runtime is included.' >&2; exit 2;; esac
[[ -f $1 ]] || { echo 'Local package not found.' >&2; exit 2; }
pkg=$(realpath -- "$1"); name=$(basename -- "$pkg"); dir=$(dirname -- "$pkg")
[[ -f "$dir/SHA256SUMS" ]] || { echo 'SHA256SUMS is required next to the package.' >&2; exit 2; }
expected=$(awk -v file="$name" '$2==file || $2=="*"file {print $1}' "$dir/SHA256SUMS")
[[ $expected =~ ^[a-fA-F0-9]{64}$ ]] || { echo 'Missing or ambiguous checksum entry.' >&2; exit 2; }
actual=$(sha256sum -- "$pkg"); actual=${actual%% *}
[[ ${actual,,} == ${expected,,} ]] || { echo 'Checksum mismatch. Installation stopped.' >&2; exit 2; }
# Integrity check, not a signature: use packages obtained from a trusted source.
case "$pkg" in
  *.deb)
    command -v dpkg-deb >/dev/null || { echo 'This system needs an RPM package instead.' >&2; exit 2; }
    [[ $(dpkg-deb -f "$pkg" Architecture) == "$debarch" ]] || { echo 'Package CPU does not match this computer.' >&2; exit 2; }
    [[ $(dpkg-deb -f "$pkg" Package) == netpin ]] || { echo 'Not a NetPin package.' >&2; exit 2; }
    command=(dpkg --install "$pkg");;
  *.rpm)
    command -v rpm >/dev/null || { echo 'This system needs a DEB package instead.' >&2; exit 2; }
    [[ $(rpm -qp --qf '%{ARCH}' "$pkg") == "$rpmarch" ]] || { echo 'Package CPU does not match this computer.' >&2; exit 2; }
    [[ $(rpm -qp --qf '%{NAME}' "$pkg") == netpin ]] || { echo 'Not a NetPin package.' >&2; exit 2; }
    command=(rpm -Uvh "$pkg");;
  *) usage; exit 2;;
esac
printf 'Local package verified: %s\n' "$name"
printf 'This script does not install missing OS dependencies from the internet.\n'
if [[ $EUID == 0 ]]; then "${command[@]}"; else sudo -- "${command[@]}"; fi
printf '\nInstalled. Launch NetPin from the desktop menu as a normal user.\nUOS/Kylin version compatibility still requires testing on your target computer.\n'
