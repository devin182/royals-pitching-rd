# Royals 2026 Pitching R&D Portfolio

[![CI](https://github.com/devin182/royals-pitching-rd/actions/workflows/ci.yml/badge.svg)](https://github.com/devin182/royals-pitching-rd/actions/workflows/ci.yml)

**Live site: https://devin182.github.io/royals-pitching-rd/**

An end-to-end pitching analytics project built on public Statcast data for the 2026 Kansas City Royals staff, by Devin Jenkinson
([devin.jenkinson182@gmail.com](mailto:devin.jenkinson182@gmail.com)). It covers a SQL pipeline in DuckDB, a Stuff+ model and analysis in R,
interactive HTML/CSS/JS reports, and a reproducible daily pitching report printed to one-page PDFs.

## What's on the site
- **Pitcher Explorer**: arsenal table (velocity, spin, IVB/HB, extension, arm angle, VAA, release offsets, whiff/chase/CSW, run value, Stuff+), movement, release points, location heatmaps (frequency or whiff, by batter side) and pitch mix by count for every Royals pitcher with 300+ pitches.
- **Research**:
  1. Stuff+ (xgboost, physical traits only, temporal-holdout validation)
  2. Location-adjusted vertical approach angle
  3. Location and command
  4. Tunneling
  5. Count leverage with empirical-Bayes shrinkage
  6. Fatigue curves
  7. Four coach-facing recommendations
- **Tunnel Viewer** (`site/tunnel/`): a Three.js broadcast-style view of average pitch paths with camera presets, playback speeds, a live gap HUD and a 2D fallback when WebGL is missing. Data built by `tunnel/build_tunnel.py`.
- **Game Plan** (`gameplan/`): an xgboost matchup model and series game-plan generator for Royals starters vs the first 2027 opponents. Validation is reported honestly: hitter traits add little over pitcher and location features.
- **Reports**: a daily pitching report (velocity and shape vs each pitcher's baseline, alert flags, workload, opponent attack / avoid / put-away sheet) and a one-page card for every pitcher, rendered from R Markdown with SQL chunks.
- **Methods & Code**: definitions plus the actual SQL and R source.

## Data
- Source: [Baseball Savant](https://baseballsavant.mlb.com/statcast_search) Statcast search CSV (public pitch-level data), 2026 MLB regular season, all 30 clubs, 2026-03-25 to 2026-09-27.
- 716,792 raw rows → 712,014 modeled pitches in 2,429 games (pitchouts, intentional balls and unclassified pitches removed); 23,644 by Royals pitchers.
- Player names: MLB Stats API (`statsapi.mlb.com/api/v1/people`).
- Statcast data © MLB Advanced Media, made publicly available via Baseball Savant. Raw data is **not** included in this repo; `make fetch` downloads it.

## Pipeline
| Step | Files | Tool |
|---|---|---|
| Fetch | `scripts/fetch_statcast.py`, `scripts/fetch_players.py` | Python (one Savant request per day) |
| Transform | `sql/01_load.sql` … `sql/07_players.sql`, run by `R/01_build_db.R` | DuckDB SQL |
| Stuff+ | `R/02_stuff_model.R` | R · xgboost |
| Analyses → JSON | `R/03_analysis.R` | R · DuckDB · data.table |
| Reports | `report/daily_report.Rmd`, `report/pitcher_card.Rmd`, `R/04_reports.R` | R Markdown + SQL chunks, ggplot2 |
| PDFs | `scripts/print_pdf.sh` | headless Chrome |
| Site | `site_src/*.html` + `scripts/build_pages.py` → `site/` | vanilla HTML/CSS/JS, Plotly |

## Reproduce
Requirements: Python 3 with `duckdb`; R ≥ 4.3 with `DBI`, `duckdb`, `data.table`, `xgboost`, `jsonlite`, `rmarkdown`, `knitr`, `ggplot2` (and pandoc); Google Chrome; GNU make.
```bash
git clone https://github.com/devin182/royals-pitching-rd.git && cd royals-pitching-rd
make all       # fetch → sql → model → analysis → reports → pdf → pages (~15 min, mostly download)
make daily     # the in-season morning job: fetch → db → report → pdf
make serve     # http://localhost:8000
```
## Tests and CI
- `Rscript tests/testthat.R` runs testthat suites against a small committed fixture (`tests/fixtures/`: 30 games, ~8.6k pitches), so CI never needs the raw data:
  - **features**: shrinkage, arm-side mirroring, VAA (the SQL version is checked against an R reference implementation), Stuff+ scaling
  - **sql**: row counts, nulls, physical value ranges, pitch-type coverage, flag consistency, arsenal and daily-report coherence
  - **model**: Stuff+ trains and predicts; a deterministic fit is compared to frozen predictions (`tests/freeze_model.R` regenerates them)
- Lint: `lintr` (R, `.lintr`) and `ruff` (Python, `ruff.toml`).
- `.github/workflows/ci.yml` runs on every push and PR. `.github/workflows/pages.yml` deploys `site/` to GitHub Pages only after CI passes on `main`.

## Notes on method
- Movement is mirrored for left-handers so arm side is always positive.
- Stuff+ targets expected run value (balls in play valued by exit velocity / launch angle / count), is scaled 100 = MLB average and 10 = 1 SD, and was validated on late-season games the model never saw.
- Small samples are shrunk toward league averages (k = 250 pitches for run values, k = 60 for hitter splits).
- Release-point flags are prompts to check video: Statcast release coordinates carry park-to-park calibration error.

## Disclaimer
Independent portfolio project. Not affiliated with, endorsed by, or produced for Major League Baseball, MLB Advanced Media, or the Kansas City Royals. Team abbreviations and player names are used only to describe public data. No club logos or marks are used.
