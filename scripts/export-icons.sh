#!/bin/zsh
# Renders the Icon Composer icon to the PNGs used by the web extension manifest and the container app.
set -euo pipefail

root="${0:A:h:h}"
icon="${ICON:-$root/PeekPreview/PeekPreview/AppIcon.icon}"
out="$root/Extension/images"
developer_dir="$(xcode-select -p)"
ictool="${developer_dir:h}/Applications/Icon Composer.app/Contents/Executables/ictool"

if [[ ! -x "$ictool" ]]; then
  echo "Icon Composer's ictool not found at: $ictool" >&2
  exit 1
fi

mkdir -p "$out"
for size in 16 32 48 64 96 128 256 512; do
  "$ictool" "$icon" --export-image --output-file "$out/icon-$size.png" \
    --platform macOS --rendition Default --width "$size" --height "$size" --scale 1 >/dev/null
done
# Container app's welcome-screen image (shown at 128pt).
"$ictool" "$icon" --export-image --output-file "$root/PeekPreview/PeekPreview/Resources/Icon.png" \
  --platform macOS --rendition Default --width 128 --height 128 --scale 2 >/dev/null

echo "Exported $(ls "$out"/icon-*.png | wc -l | tr -d ' ') icons to $out"
