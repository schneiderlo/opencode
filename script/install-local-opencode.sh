#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dst="${1:-$(command -v opencode 2>/dev/null || printf '%s\n' "$HOME/.opencode/bin/opencode")}"
src="$HOME/.cache/opencode/models.json"

build() {
  cd "$root/packages/opencode"
  if [[ -f "$src" ]]; then
    env MODELS_DEV_API_JSON="$src" OPENCODE_DISABLE_MODELS_FETCH=true bun --bun script/build.ts --single --skip-install
    return
  fi
  bun --bun script/build.ts --single --skip-install
}

if command -v nix >/dev/null 2>&1; then
  cd "$root"
  cmd="cd \"$root/packages/opencode\""
  if [[ -f "$src" ]]; then
    cmd="$cmd && env MODELS_DEV_API_JSON=\"$src\" OPENCODE_DISABLE_MODELS_FETCH=true bun --bun script/build.ts --single --skip-install"
  else
    cmd="$cmd && bun --bun script/build.ts --single --skip-install"
  fi
  nix develop -c bash -lc "$cmd"
else
  build
fi

bin="$(find "$root/packages/opencode/dist" -path '*/bin/opencode' -type f | head -n 1)"
if [[ -z "$bin" ]]; then
  printf 'built binary not found\n' >&2
  exit 1
fi

mkdir -p "$(dirname "$dst")"
install -m 755 "$bin" "$dst"
printf 'installed %s -> %s\n' "$bin" "$dst"
