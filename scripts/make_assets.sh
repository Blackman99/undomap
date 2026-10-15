#!/usr/bin/env bash
# Logo PNGs, OG image and GitHub social preview, all rendered from the site itself (same fonts, same map).
set -euo pipefail
cd "$(dirname "$0")/.."
S="$PWD/site"
printf '<html><body style="margin:0;background:transparent"><img src="file://%s/logo.svg" width="512" height="512" style="display:block"></body></html>' "$S" > /tmp/undomap-logo.html
printf '<html><body style="margin:0;background:transparent"><img src="file://%s/favicon.svg" width="32" height="32" style="display:block"></body></html>' "$S" > /tmp/undomap-fav.html
node scripts/shot.mjs /tmp/undomap-logo.html site/logo-512.png 512 512 --transparent
node scripts/shot.mjs /tmp/undomap-fav.html site/favicon-32.png 32 32 --transparent
node scripts/shot.mjs "file://$S/index.html?og&h=630" site/og.png 1200 630
node scripts/shot.mjs "file://$S/index.html?og&h=640" site/social-preview.png 1280 640
python3 - <<'PY'
from PIL import Image
for p in ("site/og.png", "site/social-preview.png"):
    im = Image.open(p).convert("RGB").quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    im.save(p, optimize=True)
    print(p, im.size)
PY
ls -la site/*.png
