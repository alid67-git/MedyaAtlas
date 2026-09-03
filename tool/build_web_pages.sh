#!/usr/bin/env bash
# Build + arrange GitHub Pages tree under a STABLE path (/MedyaAtlas/).
# Same URL every release — no /r/<version>/ folders.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VER="$(grep -E "^const appVersion" lib/app_version.dart | sed -E "s/.*'([^']+)'.*/\1/")"
BASE="/MedyaAtlas/"
echo "Building MedyaAtlas ${VER} base-href=${BASE} (stable path)"
flutter build web --release --wasm --base-href "$BASE" --pwa-strategy=none
bash "$ROOT/tool/stamp_web_version.sh" "$ROOT/build/web"

OUT="${ROOT}/build/pages-deploy"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -a build/web/. "$OUT/"

# Cache-busting go.html helper (same destination every time).
cat > "$OUT/go.html" <<EOF
<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="refresh" content="0;url=./?t=$(date +%s)">
<script>location.replace('./?t='+Date.now());</script>
<title>MedyaAtlas</title>
</head>
<body><a href="./">MedyaAtlas</a></body></html>
EOF

# Eski /r/<sürüm>/ Ana Ekran ikonları → sabit adrese.
cat > "$OUT/404.html" <<'EOF'
<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0;url=/MedyaAtlas/">
<script>location.replace('/MedyaAtlas/?t='+Date.now());</script>
<title>MedyaAtlas</title>
</head>
<body><a href="/MedyaAtlas/">MedyaAtlas</a></body></html>
EOF
mkdir -p "$OUT/r/${VER}"
cat > "$OUT/r/${VER}/index.html" <<EOF
<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0;url=/MedyaAtlas/">
<script>location.replace('/MedyaAtlas/?t='+Date.now());</script>
<title>MedyaAtlas</title>
</head>
<body><a href="/MedyaAtlas/">MedyaAtlas (sabit adres)</a></body></html>
EOF

echo "Deploy tree ready: $OUT (version ${VER}, stable /MedyaAtlas/)"
ls -la "$OUT" | head
