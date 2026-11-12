#!/usr/bin/env bash
# Rebuild the matchup model + series game plans. Run from anywhere; needs ../data/statcast.duckdb (opened read-only)
# and the raw Savant CSVs in ../data/raw/days/ (for bat_speed / swing_length / attack_angle).
set -euo pipefail
cd "$(dirname "$0")"
RSCRIPT=${RSCRIPT:-$(command -v Rscript || echo /home/box/renv/bin/Rscript)}
CHROME=${CHROME:-google-chrome}
"$RSCRIPT" R/00_features.R        # SQL feature prep  -> work/gameplan.duckdb
"$RSCRIPT" R/01_matchup_model.R   # time-split validation + final model -> out/validation.json, work/matchup_*
"$RSCRIPT" R/02_gameplan.R        # plans for every starter x opponent  -> site/gameplan_data.json(.js)
"$CHROME" --headless=new --no-sandbox --disable-gpu --no-pdf-header-footer --virtual-time-budget=6000 \
  --print-to-pdf="$PWD/site/gameplan_wacha_vs_MIN.pdf" "file://$PWD/site/gameplan_print.html?p=608379&t=MIN" 2>/dev/null
"$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=1360,2350 --virtual-time-budget=8000 \
  --screenshot="$PWD/screenshot.png" "file://$PWD/site/gameplan.html" 2>/dev/null
echo "done: site/gameplan.html, site/gameplan_wacha_vs_MIN.pdf, screenshot.png"
