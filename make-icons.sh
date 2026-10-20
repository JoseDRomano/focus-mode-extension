#!/bin/sh
# Renders icons/icon.svg into the PNG sizes Chrome and the Web Store need.
# Uses headless Google Chrome, so each size is drawn from the vector directly.
set -eu
cd "$(dirname "$0")/icons"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Rendered from a temp copy: file:// URLs with non-ASCII folder names don't
# resolve reliably.
cp icon.svg "$tmp/icon.svg"

# Draws the SVG as an <img> on a transparent page (opening the SVG directly
# sometimes screenshots blank). <canvas size> <padding> <output png>
render() {
  art=$(($1 - 2 * $2))
  cat > "$tmp/page.html" <<EOF
<!doctype html>
<meta charset="utf-8">
<body style="margin:0;padding:$2px"><img src="icon.svg" width="$art" height="$art" style="display:block"></body>
EOF
  "$CHROME" --headless --disable-gpu --hide-scrollbars --user-data-dir="$tmp/profile" \
    --default-background-color=00000000 --window-size="$1,$1" --virtual-time-budget=2000 \
    --screenshot="$PWD/$3" "file://$tmp/page.html" >/dev/null 2>&1
}

for size in 16 32 48 128; do
  render "$size" 0 "icon-$size.png"
done

# Web Store listing icon: 96px artwork inside 16px of transparent padding.
render 128 16 "store-icon-128.png"

echo "Rendered: $(ls ./*.png | tr '\n' ' ')"
