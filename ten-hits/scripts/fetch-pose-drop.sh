#!/usr/bin/env bash
# Pulls authored .glb files from a GitHub release and shrinks them for the game.
#
# The authored pose clips are far too large to hand over through a chat upload —
# they arrive at 100MB and up. A GitHub release asset has a 2GB limit and needs
# nothing installed to create, so that is the drop box: attach the files to a
# release, then run this.
#
# Usage: scripts/fetch-pose-drop.sh [tag]        (default tag: pose-drop)
set -euo pipefail

TAG="${1:-pose-drop}"
REPO="khs880514-code/backpackmaster-covenant-web"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "GITHUB_TOKEN is not set; cannot read the release." >&2
  exit 1
fi
AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")

echo "Reading release '$TAG'..."
RELEASE="$(curl -fsS "${AUTH[@]}" "https://api.github.com/repos/$REPO/releases/tags/$TAG")"

# id<TAB>name for every .glb attached to the release.
ASSETS="$(printf '%s' "$RELEASE" | node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const assets = (JSON.parse(raw).assets ?? []).filter((a) => a.name.toLowerCase().endsWith(".glb"));
  for (const a of assets) console.log(`${a.id}\t${a.name}\t${a.size}`);
});
')"

if [ -z "$ASSETS" ]; then
  echo "No .glb assets attached to '$TAG'." >&2
  exit 1
fi

mkdir -p "$WORK/in"
while IFS=$'\t' read -r id name size; do
  [ -n "$id" ] || continue
  printf '  %-20s %6.1f MB  downloading...\n' "$name" "$(echo "$size" | awk '{print $1/1048576}')"
  # The asset endpoint redirects to storage, so the token must not follow it.
  curl -fsSL "${AUTH[@]}" -H 'Accept: application/octet-stream' \
    -o "$WORK/in/$name" "https://api.github.com/repos/$REPO/releases/assets/$id"
done <<< "$ASSETS"

echo
echo "Preparing (strip authoring rigs, compress textures)..."
node scripts/prepare-models.mjs "$WORK/in" "$WORK/out"

echo
echo "Compressing geometry (EXT_meshopt_compression)..."
node scripts/compress-models.mjs "$WORK/out"

echo
echo "Installing into public/models/assets/ ..."
for file in "$WORK"/out/*.glb; do
  [ -e "$file" ] || continue
  base="$(basename "$file")"
  before="$(stat -c%s "$WORK/in/$base" 2>/dev/null || echo 0)"
  after="$(stat -c%s "$file")"
  cp "$file" "public/models/assets/$base"
  awk -v n="$base" -v b="$before" -v a="$after" 'BEGIN {
    printf "  %-20s %7.1f MB -> %5.2f MB  (-%d%%)\n", n, b/1048576, a/1048576, (b>0 ? (1-a/b)*100 : 0)
  }'
done

echo
echo "Done. Run: npm run check"
