#!/usr/bin/env bash
# Print the HTML reports to PDF with headless Chrome (CSS @page = US Letter).
set -euo pipefail
CHROME=${CHROME:-google-chrome}
pdf() { "$CHROME" --headless=new --no-sandbox --disable-gpu --no-pdf-header-footer --virtual-time-budget=4000 --print-to-pdf="$2" "file://$PWD/$1" 2>/dev/null; }
pdf site/reports/daily_report.html site/reports/daily_report.pdf
FEATURED=${FEATURED:-$(ls -S site/reports/cards/*.html | head -1 | xargs basename -s .html)}
pdf "site/reports/cards/${FEATURED}.html" site/reports/pitcher_card_${FEATURED}.pdf
for f in site/reports/*.pdf; do echo "$f: $(pdfinfo "$f" | awk '/Pages/{print $2}') page(s)"; done
