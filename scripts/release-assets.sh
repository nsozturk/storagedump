#!/bin/sh
# Builds the GitHub release files into tmp-smoke-artifacts/release-<version>/:
#   storagedump-<v>.zip (same package as the Web Store), storagedump-<v>.crx,
#   storagedump-companion-<v>.zip and SHA256SUMS.txt.
# The CRX is signed with the key kept in the macOS Keychain (slug storagedump-crx-key,
# base64 PEM), so its extension id stays the same across releases.
#   CHROME=/path/to/chrome sh scripts/release-assets.sh
set -eu
cd "$(dirname "$0")/.."
V=$(node -p "require('./public/manifest.json').version")
CHROME=${CHROME:-$(node -e "import('playwright').then(p=>console.log(p.chromium.executablePath()))")}
OUT="tmp-smoke-artifacts/release-$V"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
npm run pack >/dev/null
rm -rf "$OUT" && mkdir -p "$OUT"
security find-generic-password -s storagedump-crx-key -a "$USER" -w | base64 -d > "$WORK/key.pem"
cp -R dist "$WORK/storagedump"
"$CHROME" --pack-extension="$WORK/storagedump" --pack-extension-key="$WORK/key.pem" --no-message-box >/dev/null 2>&1
cp "$WORK/storagedump.crx" "$OUT/storagedump-$V.crx"
cp storagedump.zip "$OUT/storagedump-$V.zip"
(cd companion && zip -q -r "../$OUT/storagedump-companion-$V.zip" install.py storagedump_host.py storagedump_client.py)
(cd "$OUT" && shasum -a 256 storagedump-* > SHA256SUMS.txt && cat SHA256SUMS.txt)
echo "Release files: $OUT"
