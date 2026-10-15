#!/usr/bin/env bash
# Horizontal-overflow check of a page at common widths (headless Chrome). usage: scripts/qa.sh site/index.html
f="file://$(realpath "$1")"
for w in 360 390 768 1024 1440 1920; do
  o=$(google-chrome --headless=new --no-sandbox --disable-gpu --allow-file-access-from-files --window-size=$w,1400 --virtual-time-budget=4000 --dump-dom "$f?still&qa" 2>/dev/null | grep -o 'data-overflow="[^"]*"')
  echo "$w px: ${o:-no data}"
done
