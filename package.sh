#!/bin/sh
# Builds dist/focus-mode-<version>.zip for upload to the Chrome Web Store.
set -eu
cd "$(dirname "$0")"

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
out="dist/focus-mode-$version.zip"

mkdir -p dist
rm -f "$out"
zip -q -r "$out" manifest.json ./*.html ./*.js ./*.css icons -x "icons/store-icon-128.png" "icons/icon.svg"
echo "Built $out"
