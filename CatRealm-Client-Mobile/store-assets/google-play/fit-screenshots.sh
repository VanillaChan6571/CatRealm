#!/usr/bin/env bash
# Fits phone screenshots to Play's 9:16 requirement without cropping, adding brand-colored side bars.
# Usage: put PNG/JPEG files in screenshots-raw/, then run: ./fit-screenshots.sh
set -euo pipefail
cd "$(dirname "$0")"
shopt -s nullglob nocaseglob
for f in screenshots-raw/*.{png,jpg,jpeg}; do
  n=$(basename "${f%.*}")
  convert "$f" -resize 1080x1920 -background '#171225' -gravity center -extent 1080x1920 -alpha off -strip "screenshots/$n.png"
  echo "screenshots/$n.png"
done
