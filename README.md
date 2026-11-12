# Royals 2026 Pitching R&D Portfolio

[![CI](https://github.com/devin182/royals-pitching-rd/actions/workflows/ci.yml/badge.svg)](https://github.com/devin182/royals-pitching-rd/actions/workflows/ci.yml)

**Live site: https://devin182.github.io/royals-pitching-rd/**

Season-long pitching coverage of the 2026 MLB regular season (Mar 25 – Sep 27) from public Statcast data, for all 30 staffs with the
Kansas City Royals as the featured study, by Devin Jenkinson ([devin.jenkinson182@gmail.com](mailto:devin.jenkinson182@gmail.com)). It covers a SQL pipeline in DuckDB, a Stuff+ model and analysis in R,
interactive HTML/CSS/JS reports, and a reproducible daily pitching report printed to one-page PDFs.

## What's on the site
Most pages have a **team selector** (all 30 clubs; Royals by default). The choice is kept in the URL (`?team=NYY`) and in
localStorage, and each team's data is a separate lazy-loaded file (`site/data/t/<TEAM>/`, built by `R/07_teams.R`). A pitcher is
listed under a club with 300+ pitches for that club, using only those pitches, so a traded pitcher can appear under two teams.
- **Season Tracker** (`site/season.html`): month-by-month staff whiff rate, CSW, chase, four-seam velocity, Stuff+ and pitch mix against the MLB average for the same month, plus velocity, Stuff+, whiff rate and usage by month for each pitcher (Mar–Apr through Sep, real game dates).
- **Pitcher Explorer**: arsenal table (velocity, spin, IVB/HB, extension, arm angle, VAA, release offsets, whiff/chase/CSW, run value, Stuff+), movement, release points, location heatmaps (frequency or whiff, by batter side) and pitch mix by count for every pitcher with 300+ pitches for the selected club.
- **Research**:
  1. Stuff+ (xgboost, physical traits only, temporal-holdout validation)
  2. Location-adjusted vertical approach angle
  3. Location and command
  4. Tunneling
  5. Count leverage with empirical-Bayes shrinkage
  6. Fatigue curves
  7. Four coach-facing recommendations
  8. All 30 staffs ranked (whiff, CSW, chase, velocity, staff Stuff+, run value) with the selected club highlighted
- **Tunnel Viewer** (`site/tunnel/`): a Three.js broadcast-style view of average pitch paths with camera presets, playback speeds, a live gap HUD and a 2D fallback when WebGL is missing. Data built by `tunnel/build_tunnel.py`, run for every club by `scripts/build_tunnel_teams.py` (`site/tunnel/teams/<TEAM>.json`).
- **Pitch Design Lab** (`site/lab.html`): sliders for velo, spin, movement, release and extension on any pitcher's pitch (per-team index `site/data/lab/teams/<TEAM>.json`), re-graded live by the Stuff+ xgboost model running in the browser (trees exported by `R/05_design_lab.R`; `tests/js/lab.test.js` checks that JS matches R to within 1e-6 and that every team's baselines grade identically, and runs in CI). Model estimates only. Slider positions outside the training data are flagged, and the nearest MLB comparables are shown.
- **Sequencing** (`site/sequencing.html`): previous pitch (type, location, result) plus count → next-pitch CSW, whiff and xRV, league-wide, compared on held-out games with a no-sequence baseline (the lift is small and is reported as such). The actual-rate line switches with the team selector (`site/data/seq/<TEAM>.json`). Includes two Royals leads with n, intervals and a multiple-testing caveat.
- **Game Plan** (`gameplan/`): an xgboost matchup model and series game-plan generator for Royals starters vs the first 2027 opponents (Royals only; the page says so). Validation is reported honestly: hitter traits add little over pitcher and location features.
- **Reports**: a daily pitching report (velocity and shape vs each pitcher's baseline, alert flags, workload, opponent attack / avoid / put-away sheet) and a one-page card for every Royals pitcher, rendered from R Markdown with SQL chunks. Cards for the other 29 clubs (`site/card.html`) are generated in the browser from the per-team JSON with the same rules, instead of rendering ~570 more HTML files.
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
| Design Lab export | `R/05_design_lab.R` → `site/data/lab/`, checked by `tests/js/lab.test.js` | R · xgboost tree dump · JS |
| Sequencing | `R/06_sequencing.R` → `site/data/sequencing.json`, `site/data/seq/<TEAM>.json` | R · xgboost |
| All 30 teams + Season Tracker | `R/07_teams.R` → `site/data/teams.json`, `site/data/t/<TEAM>/` (index, season, one file per pitcher); `scripts/build_tunnel_teams.py` → `site/tunnel/teams/`; checked by `tests/check_teams.py` | DuckDB SQL · R · Python |
| Reports | `report/daily_report.Rmd`, `report/pitcher_card.Rmd`, `R/04_reports.R` | R Markdown + SQL chunks, ggplot2 |
| PDFs | `scripts/print_pdf.sh` | headless Chrome |
| Site | `site_src/*.html` + `scripts/build_pages.py` → `site/` | vanilla HTML/CSS/JS, Plotly |

## Reproduce
Requirements: Python 3 with `duckdb`; R ≥ 4.3 with `DBI`, `duckdb`, `data.table`, `xgboost`, `jsonlite`, `rmarkdown`, `knitr`, `ggplot2` (and pandoc); Google Chrome; GNU make.
```bash
git clone https://github.com/devin182/royals-pitching-rd.git && cd royals-pitching-rd
make all       # fetch → sql → model → analysis → lab → sequencing → teams → tunnel → reports → pdf → pages (~15 min, mostly download)
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
