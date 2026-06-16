#!/bin/bash
cd /root/.openclaw/workspace/main/avatar-service/photos/test_model_compare

LABELS=(
  "retro_90s - 3.1-flash (9.0s)"
  "fashion_editorial - 3.1-flash (9.5s)"
  "cinema - 3.1-flash (9.3s)"
  "location - 3.1-flash (6.9s)"
  "retro_90s - 3-pro (19.3s)"
  "fashion_editorial - 3-pro (19.5s)"
  "cinema - 3-pro (18.4s)"
  "location - 3-pro (16.8s)"
  "retro_90s - 2.5-flash (8.7s)"
  "fashion_editorial - 2.5-flash (11.8s)"
  "cinema - 2.5-flash (8.1s)"
  "location - 2.5-flash (27.6s)"
)

FILES=(
  generated_1781633480810.jpg
  generated_1781633490287.jpg
  generated_1781633499539.jpg
  generated_1781633506413.jpg
  generated_1781633525759.jpg
  generated_1781633545235.jpg
  generated_1781633563612.jpg
  generated_1781633580372.jpg
  generated_1781633589036.png
  generated_1781633600855.png
  generated_1781633608925.png
  generated_1781633636549.png
)

mkdir -p labeled

for i in "${!FILES[@]}"; do
  f="${FILES[$i]}"
  label="${LABELS[$i]}"
  echo "Labeling: $f -> $label"
  convert "$f" \
    -gravity south \
    -background '#00000080' \
    -fill white \
    -pointsize 32 \
    -splice 0x50+0+0 \
    -annotate +0+10 " $label " \
    "labeled/$f"
done

echo ""
echo "Done:"
ls -lh labeled/
