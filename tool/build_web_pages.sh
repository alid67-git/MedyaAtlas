#!/usr/bin/env bash
# Build + arrange GitHub Pages tree so each release lives under /r/<version>/
# (escapes old Flutter service-worker precache of /MedyaAtlas/index.html).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VER="$(grep -E "^const appVersion" lib/app_version.dart | sed -E "s/.*'([^']+)'.*/\1/")"
BASE="/MedyaAtlas/r/${VER}/"
echo "Building MedyaAtlas ${VER} base-href=${BASE}"
flutter build web --release --base-href "$BASE" --pwa-strategy=none

OUT="${ROOT}/build/pages-deploy"
rm -rf "$OUT"
mkdir -p "$OUT/r/${VER}"
cp -a build/web/. "$OUT/r/${VER}/"

# Root redirectors + kill-switch + root version.json for old clients
cp web/flutter_service_worker_killswitch.js "$OUT/flutter_service_worker.js"
cp "build/web/version.json" "$OUT/version.json"
cat > "$OUT/index.html" <<EOF
<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MedyaAtlas</title>
<meta name="theme-color" content="#071018">
<style>
html,body{margin:0;height:100%;background:#071018;color:#c8d0d8;font-family:-apple-system,system-ui,sans-serif}
.boot{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;padding:24px;text-align:center}
a{color:#2EC4B6;font-size:18px}
</style>
<script>
(async function(){
  try{
    if('serviceWorker' in navigator){
      var regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(function(r){return r.unregister();}));
    }
    if(window.caches&&caches.keys){
      var keys=await caches.keys();
      await Promise.all(keys.map(function(k){return caches.delete(k);}));
    }
  }catch(e){}
  location.replace('r/${VER}/?t='+Date.now());
})();
</script>
</head>
<body>
<div class="boot">
  <div>Güncelleniyor…</div>
  <a href="r/${VER}/">Elle aç (v${VER})</a>
</div>
</body></html>
EOF
cat > "$OUT/go.html" <<EOF
<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0;url=r/${VER}/">
<script>location.replace('r/${VER}/?t='+Date.now());</script>
<title>MedyaAtlas</title>
</head>
<body><a href="r/${VER}/">MedyaAtlas v${VER}</a></body></html>
EOF

# Patch kill-switch destination for this version
sed -i "s|/MedyaAtlas/r/[0-9.]*/|/MedyaAtlas/r/${VER}/|g" "$OUT/flutter_service_worker.js" || true

echo "Deploy tree ready: $OUT (version ${VER})"
ls -la "$OUT" | head
ls -la "$OUT/r/${VER}" | head
