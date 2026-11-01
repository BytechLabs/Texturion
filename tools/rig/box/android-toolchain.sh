#!/usr/bin/env bash
# Installs the JDK and the Android SDK that `rig apk` builds with, at the
# versions and checksums pinned in android-toolchain.json (docs/RIG.md FA15).
#
#   bash tools/rig/box/android-toolchain.sh                    # JDK and command-line tools
#   bash tools/rig/box/android-toolchain.sh --accept-licences  # and the SDK packages
#
# Run as the rig account. Accepting the SDK licences is an agreement, so only
# the flag does it; without it the packages wait. Safe to run again.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PINS="$HERE/android-toolchain.json"
SDK="$HOME/android-sdk"
JDK="$HOME/jdk"
accept=0
[[ "${1:-}" == --accept-licences ]] && accept=1

pin() { jq -er "$1" "$PINS"; }

# fetch <url> <file> <sha256> [sha1]
fetch() {
  curl -fsSLo "$2" "$1"
  echo "$3  $2" | sha256sum -c - >/dev/null || { echo "android-toolchain.sh: $1 does not match its pinned SHA-256" >&2; exit 1; }
  if [[ -n "${4:-}" ]]; then
    echo "$4  $2" | sha1sum -c - >/dev/null || { echo "android-toolchain.sh: $1 does not match the SHA-1 in Google's repository XML" >&2; exit 1; }
  fi
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

jdk_version="$(pin .jdk.version)"
if ! grep -q "^SEMANTIC_VERSION=\"${jdk_version}[.\"]" "$JDK/release" 2>/dev/null; then
  echo "== JDK $jdk_version"
  fetch "$(pin .jdk.url)" "$work/jdk.tar.gz" "$(pin .jdk.sha256)"
  target="$HOME/jdk-$jdk_version"
  rm -rf "$target"
  mkdir "$target"
  tar -xzf "$work/jdk.tar.gz" -C "$target" --strip-components=1
  ln -sfn "$target" "$JDK"
fi

revision="$(pin .cmdlineTools.revision)"
if ! grep -qx "Pkg.Revision=$revision" "$SDK/cmdline-tools/latest/source.properties" 2>/dev/null; then
  echo "== Android command-line tools $revision"
  fetch "$(pin .cmdlineTools.url)" "$work/cmdline-tools.zip" "$(pin .cmdlineTools.sha256)" "$(pin .cmdlineTools.sha1)"
  mkdir -p "$SDK/cmdline-tools"
  rm -rf "$SDK/cmdline-tools/latest"
  unzip -q "$work/cmdline-tools.zip" -d "$work/unpacked"
  mv "$work/unpacked/cmdline-tools" "$SDK/cmdline-tools/latest"
fi

export JAVA_HOME="$JDK"
sdkmanager="$SDK/cmdline-tools/latest/bin/sdkmanager"
if (( accept )); then
  echo "== Android SDK licences, accepted"
  "$sdkmanager" --sdk_root="$SDK" --licenses < <(yes) >/dev/null
fi
if [[ ! -f "$SDK/licenses/android-sdk-license" ]]; then
  echo "android-toolchain.sh: the SDK licences are not accepted yet (FA15), so no SDK package is installed."
  echo "The founder agrees to them once; then run: bash $0 --accept-licences"
  exit 0
fi

echo "== Android SDK packages"
mapfile -t packages < <(pin '.packages[]')
"$sdkmanager" --sdk_root="$SDK" "${packages[@]}"

# `rig apk` finds the toolchain here when its environment names none
# (tools/rig/src/apk.mjs), but a login shell should agree.
marker="# loonext-rig android toolchain"
if ! grep -qF "$marker" "$HOME/.profile"; then
  printf '\n%s\nexport JAVA_HOME="$HOME/jdk"\nexport ANDROID_HOME="$HOME/android-sdk"\n' "$marker" >> "$HOME/.profile"
fi
echo "android-toolchain.sh: done."
