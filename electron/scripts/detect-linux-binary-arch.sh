#!/usr/bin/env bash
set -euo pipefail


detect_binary_arch() {
  local binary="$1"
  local description

  description="$(file -Lb "$binary")"

  case "$description" in
    *"x86-64"*|*"x86_64"*)
      printf "%s\n" "x64"
      ;;
    *"aarch64"*|*"ARM aarch64"*)
      printf "%s\n" "arm64"
      ;;
    *)
      echo "ERROR: Unsupported binary architecture:" >&2
      echo "  $binary" >&2
      echo "  $description" >&2
      return 1
      ;;
  esac
}


[[ $# -eq 1 ]] || {
  echo "Usage: $0 <binary>" >&2
  exit 2
}

detect_binary_arch "$1"
