#!/bin/sh
# Builds dist/focus-mode-<version>.zip for upload to the Chrome Web Store.
set -eu
cd "$(dirname "$0")/.."

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
out="dist/focus-mode-$version.zip"

mkdir -p dist
rm -f "$out"
zip -q -r "$out" manifest.json src icons -x "icons/store-icon-128.png" "*.DS_Store"
echo "Built $out"
