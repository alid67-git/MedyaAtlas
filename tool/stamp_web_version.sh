#!/usr/bin/env bash
# Damga: lib/app_version.dart → web asset’lerdeki __MEDYAATLAS_VERSION__
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-$ROOT/build/web}"
VER="$(grep -E "^const appVersion" "$ROOT/lib/app_version.dart" | sed -E "s/.*'([^']+)'.*/\1/")"
if [[ -z "$VER" ]]; then
  echo "appVersion okunamadı" >&2
  exit 1
fi
echo "Stamping MedyaAtlas web version ${VER} → ${TARGET}"
for f in app_version.js update.js sw.js index.html manifest.json; do
  if [[ -f "$TARGET/$f" ]]; then
    sed -i "s/__MEDYAATLAS_VERSION__/${VER}/g" "$TARGET/$f"
  fi
done
# manifest ikon cache-buster
if [[ -f "$TARGET/manifest.json" ]]; then
  sed -i -E "s/(\\?v=)[0-9]+\\.[0-9]+\\.[0-9]+/\\1${VER}/g" "$TARGET/manifest.json"
fi
echo "Stamp done: ${VER}"
