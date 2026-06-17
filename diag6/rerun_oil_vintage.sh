#!/usr/bin/env bash
set -euo pipefail

# Sandbox-only rerun for oil + vintage with strengthened prompts.
# Uses Replicate directly (REPLICATE_API_TOKEN). Source frame is the
# previously isolated mid-grey base (diag/house_fluxA2_midgrey.png).
# Does NOT touch product_configs, schema, or edge functions.

API="https://api.replicate.com/v1"
AUTH=(-H "Authorization: Bearer $REPLICATE_API_TOKEN")
OUT=diag6
SRC="diag/house_fluxA2_midgrey.png"

echo "Uploading source $SRC ..."
SRC_URL=$(curl -sS -X POST "$API/files" "${AUTH[@]}" \
  -F "content=@${SRC};type=image/png" | jq -r '.urls.get')
echo "SRC_URL=$SRC_URL"

BASE='The subject is a single residential house. Preserve its architecture, roofline, window and door placement, and overall proportions and composition so it stays recognizable as this specific house. Isolate the subject completely on a flat mid-grey (#7f7f7f) studio background. No ground, no shadow, no surroundings, no people, no vehicles, no vegetation touching the building, no text or watermarks.'

# Stronger oil + vintage prompts.
OIL_BRIDGE='Apply the painting style aggressively. The result must read as an oil painting on canvas, NOT a photograph: visible thick impasto brush strokes, palette-knife texture, painterly broken edges, rich saturated pigment, no photographic micro-detail, no smooth gradients, no lens look. Strong painterly stylization is required.'
OIL_PRESET='Oil painting in the style of a classical European master. Thick impasto brushwork, expressive palette-knife strokes, warm earthy and jewel-tone palette, dramatic chiaroscuro lighting, painterly canvas texture visible throughout.'

VINT_BRIDGE='The result must look like an aged printed illustration / mid-century travel poster, NOT a photograph: flat screen-printed shapes, limited muted retro palette (ochre, faded teal, cream, brick red), visible halftone dots and paper grain, soft registration offset, no photographic lighting, no modern color, no realism.'
VINT_PRESET='Vintage 1960s travel-poster illustration. Flat screen-printed color blocks, limited muted retro palette, halftone dots, slightly off-register print look, aged paper texture, hand-drawn ink outlines.'

run_style () {
  local name="$1"; local bridge="$2"; local preset="$3"
  local prompt="${BASE}
${bridge}
Render the subject in the following art style. This defines the final look and must be applied fully to the subject, while keeping its structure and identity recognizable:
${preset}"

  echo "===== $name ====="
  local body
  body=$(jq -n --arg img "$SRC_URL" --arg p "$prompt" \
    '{input:{input_image:$img, prompt:$p, output_format:"png", safety_tolerance:2, prompt_upsampling:false, aspect_ratio:"match_input_image"}}')
  local create
  create=$(curl -sS -X POST "$API/models/black-forest-labs/flux-kontext-pro/predictions" \
    "${AUTH[@]}" -H "Content-Type: application/json" -d "$body")
  local pid status flux_url
  pid=$(echo "$create" | jq -r '.id')
  echo "flux prediction id=$pid"
  for i in $(seq 1 90); do
    sleep $(( i<5 ? 3 : 6 ))
    r=$(curl -sS "$API/predictions/$pid" "${AUTH[@]}")
    status=$(echo "$r" | jq -r '.status')
    [ "$status" = "succeeded" ] && { flux_url=$(echo "$r" | jq -r '.output | if type=="array" then .[0] else . end'); break; }
    if [ "$status" = "failed" ] || [ "$status" = "canceled" ]; then echo "$r"; exit 1; fi
  done
  echo "flux_url=$flux_url"
  curl -sSL "$flux_url" -o "$OUT/${name}_flux.png"

  # Background removal -> RGBA
  local rb
  rb=$(curl -sS -X POST "$API/models/851-labs/background-remover/predictions" \
    "${AUTH[@]}" -H "Content-Type: application/json" \
    -d "$(jq -n --arg img "$flux_url" '{input:{image:$img, format:"png", background_type:"rgba"}}')")
  local rpid rurl
  rpid=$(echo "$rb" | jq -r '.id'); echo "bg prediction id=$rpid"
  for i in $(seq 1 60); do
    sleep $(( i<5 ? 2 : 4 ))
    r=$(curl -sS "$API/predictions/$rpid" "${AUTH[@]}")
    status=$(echo "$r" | jq -r '.status')
    [ "$status" = "succeeded" ] && { rurl=$(echo "$r" | jq -r '.output | if type=="array" then .[0] else . end'); break; }
    if [ "$status" = "failed" ] || [ "$status" = "canceled" ]; then echo "$r"; exit 1; fi
  done
  echo "rurl=$rurl"
  curl -sSL "$rurl" -o "$OUT/${name}_cutout.png"
}

run_style "oil"     "$OIL_BRIDGE"  "$OIL_PRESET"
run_style "vintage" "$VINT_BRIDGE" "$VINT_PRESET"

echo "Done."
