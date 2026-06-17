#!/usr/bin/env bash
set -euo pipefail
API="https://api.replicate.com/v1"
AUTH=(-H "Authorization: Bearer $REPLICATE_API_TOKEN")
BGVER="a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc"
OUT="diag6/stress"

# Stronger background isolation in BASE so even "oil" doesn't paint a landscape.
BASE='The subject is a single residential house. Preserve its architecture, roofline, window and door placement, and overall proportions and composition so it stays recognizable as this specific house. Completely isolate the building on a perfectly flat mid-grey (#7f7f7f) studio backdrop. ABSOLUTELY NO landscape, NO sky, NO trees, NO foliage, NO bushes, NO grass, NO ground, NO shadow, NO surroundings, NO people, NO vehicles, NO text, NO watermark. The area outside the building silhouette must be a single solid flat #7f7f7f, nothing else.'

WC_PRESET='Soft watercolor painting on cold-press paper. Wet-on-wet washes, gentle pigment bleed at edges, visible paper texture, light translucent layers, hand-painted look. Limited soft palette.'
OIL_BRIDGE='The result must read as an oil painting on canvas, NOT a photograph: visible thick impasto brush strokes, palette-knife texture, painterly broken edges, rich saturated pigment, no photographic micro-detail.'
OIL_PRESET='Oil painting in the style of a classical European master. Thick impasto brushwork, expressive palette-knife strokes, warm earthy and jewel-tone palette, painterly canvas texture.'

upload () {
  curl -sS -X POST "$API/files" "${AUTH[@]}" -F "content=@${1};type=image/jpeg" | jq -r '.urls.get'
}

flux () {
  local src_url="$1" prompt="$2" out="$3"
  local body=$(jq -n --arg img "$src_url" --arg p "$prompt" \
    '{input:{input_image:$img, prompt:$p, output_format:"png", safety_tolerance:2, prompt_upsampling:false, aspect_ratio:"match_input_image"}}')
  local pid=$(curl -sS -X POST "$API/models/black-forest-labs/flux-kontext-pro/predictions" \
    "${AUTH[@]}" -H "Content-Type: application/json" -d "$body" | jq -r '.id')
  local status url
  for i in $(seq 1 90); do
    sleep $(( i<5 ? 3 : 6 ))
    r=$(curl -sS "$API/predictions/$pid" "${AUTH[@]}")
    status=$(echo "$r" | jq -r '.status')
    [ "$status" = "succeeded" ] && { url=$(echo "$r" | jq -r '.output | if type=="array" then .[0] else . end'); break; }
    [ "$status" = "failed" ] || [ "$status" = "canceled" ] && { echo "FLUX FAIL: $r" >&2; return 1; }
  done
  curl -sSL "$url" -o "$out"
  echo "$url"
}

bgrm () {
  local img_url="$1" out="$2"
  local body=$(jq -n --arg img "$img_url" --arg v "$BGVER" \
    '{version:$v, input:{image:$img, format:"png", background_type:"rgba"}}')
  local pid=$(curl -sS -X POST "$API/predictions" "${AUTH[@]}" \
    -H "Content-Type: application/json" -d "$body" | jq -r '.id')
  local status url
  for i in $(seq 1 60); do
    sleep $(( i<5 ? 2 : 4 ))
    r=$(curl -sS "$API/predictions/$pid" "${AUTH[@]}")
    status=$(echo "$r" | jq -r '.status')
    [ "$status" = "succeeded" ] && { url=$(echo "$r" | jq -r '.output | if type=="array" then .[0] else . end'); break; }
    [ "$status" = "failed" ] || [ "$status" = "canceled" ] && { echo "BGRM FAIL: $r" >&2; return 1; }
  done
  curl -sSL "$url" -o "$out"
}

run_one () {
  local hf="$1" style="$2" preset="$3" bridge="${4:-}"
  local name=$(basename "$hf" .jpg)
  echo "=== $name / $style ==="
  local src=$(upload "$hf")
  local prompt="${BASE}
${bridge}
Render the subject in the following art style. Apply it fully to the subject while keeping its structure and identity recognizable:
${preset}"
  flux "$src" "$prompt" "$OUT/${name}_${style}_flux.png" > /tmp/flux_url
  local fu=$(cat /tmp/flux_url)
  bgrm "$fu" "$OUT/${name}_${style}_cutout.png"
}

for h in $OUT/house1.jpg $OUT/house2.jpg $OUT/house3.jpg $OUT/house4.jpg; do
  run_one "$h" "watercolor" "$WC_PRESET" "" &
done
wait
for h in $OUT/house1.jpg $OUT/house2.jpg $OUT/house3.jpg $OUT/house4.jpg; do
  run_one "$h" "oil" "$OIL_PRESET" "$OIL_BRIDGE" &
done
wait
echo "DONE"
