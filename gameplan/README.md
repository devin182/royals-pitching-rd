# Matchup model + series game-plan generator

This folder adds a pitch-level **matchup model** and a **series game-plan generator** for Royals starters. The opponents are the first four series on the published 2027 Royals schedule. Everything is computed from 2026 Statcast pitch-level and bat-tracking data.

| Output | What it is |
|---|---|
| `site/gameplan.html` | Interactive page with the site styling (CSS inlined). Pick a starter (9 with 8+ starts) and an opponent (MIN, CWS, STL, LAA). It shows 3 staff takeaways, a per-hitter attack/avoid/count plan, hitter zone maps and profiles, what the model learned, and validation. |
| `site/gameplan_data.json` | All the page data. `gameplan_data.js` holds the same data as `window.GAMEPLAN`, so the page also opens from `file://`. |
| `site/gameplan_print.html?p=<pitcher>&t=<team>` | Printable one-page plan for any pairing. |
| `site/gameplan_wacha_vs_MIN.pdf` | The one-page plan for Michael Wacha vs the Twins, the Opening Day 2027 opponent. |
| `out/validation.json`, `out/feature_importance.csv` | Validation metrics and model feature gain. |
| `screenshot.png` | The page rendered in headless Chrome. |

## Opponent and lineups
* **Schedule:** the 2027 Royals schedule is published. Opening Day is Thu **March 25, 2027 vs Minnesota at Kauffman Stadium**, with games on Mar 25 and 27-28. Next come CWS (Mar 29-31), at STL (Apr 1, 3-4), and at LAA (Apr 5-7). Sources: [AP 2027 Royals schedule](https://apnews.com/article/2027-kansas-city-royals-schedule-4804d732222e0d55c13fd367e012f9e1), [Royals release via KSAL](https://www.ksal.com/royals-announce-2027-regular-season-schedule/), [Kansas City Star](https://www.kansascity.com/sports/mlb/kansas-city-royals/article316539530.html). The schedule could shift if a CBA lockout happens.
* **Lineups:** each club's **top 9 hitters by 2026 plate appearances with that club**, from distinct PAs in the Statcast data, ordered by median batting-order slot. Offseason roster moves are not reflected.
* Switch hitters are scored from the side they'd bat against that pitcher.

## Method
1. **SQL feature prep** (`sql/01_matchup_features.sql`, DuckDB). The project DB is attached `READ_ONLY`. Bat tracking (`bat_speed`, `swing_length`, `attack_angle`) is re-read from the raw CSVs and joined on game/PA/pitch. Location is made hitter-relative (+x = inside) and split into 13 regions (a 3×3 zone plus above, below, off plate in, off plate away) plus waste. Counts are grouped into first pitch, ahead, even, and behind. The SQL also builds lineup PA/slot tables and Royals starters.
2. **Matchup model** (`R/01_matchup_model.R`, xgboost). The target is the project's de-noised pitcher run value per pitch (`xrv`; balls in play are valued by EV/LA/count).
   * Pitch features: velo, IVB, HB, spin, extension, arm angle, release height, VAA, and differentials vs the primary fastball.
   * Location and context: location (x_in, z), balls, strikes, platoon.
   * **Hitter profile:** bat speed, swing length, attack angle, chase, zone swing, zone whiff, whiff vs FB/BRK/OFF, and xwOBA on contact. Each is **empirical-Bayes shrunk** to league average: `(sum + k·mean)/(n + k)`, with k = 40 tracked swings for bat tracking, 150 out-of-zone pitches for chase, 60-100 for the whiff rates, and 80 BIP for xwOBAcon.
   * **Hitter residual layer:** an out-of-fold residual by hitter × pitch group × location band, shrunk with k = 300 pitches. k was fixed in advance.
3. **Plan generator** (`R/02_gameplan.R`).
   * Each pitch type a starter throws ≥4% of the time to that batter side is scored at his average 2026 shape. VAA is re-solved for the target height from a per-pitch `vaa ~ height` fit.
   * Each pitch is scored in all 13 regions × 12 counts against every hitter. Counts are combined using league count weights.
   * Values are **runs per 100 pitches relative to his own usual 2026 mix** in that count against that batter side (pitcher's view, + = good).
   * "Attack" only uses spots where he throws that pitch ≥6% of the time, so the plan is executable. "Avoid" lists his own habits (≥10%) that grade worst against the hitter.
   * The 3 headline takeaways (attack / avoid / put-away) come from lineup-wide averages.

## Validation
The model trains on games before **2026-08-01** and tests on Aug 1 to Sep 27. Test hitter profiles use only training-window data.

| Metric (test window) | Value |
|---|---|
| Pitches train / test | 483,705 / 228,307 |
| Pitch-level R² vs count-only baseline: pitch+location model / + hitter profile / + residual layer | 6.42% / 6.44% / 6.42% |
| Hitter × pitch group × location band cells (1,826 cells, 40+ test pitches): r, model vs hitter's raw first-half split | **0.72 vs 0.60** |
| Same cells, RMSE (runs/100): model vs raw split | **2.45 vs 3.03** |
| Cell r without hitter features | 0.71 |
| Hitter-adjustment signal: r of (matchup − no-hitter prediction) with (actual − no-hitter prediction), vs the same for raw split | 0.25 vs 0.16 |
| Within-hitter Spearman of cell ranking (178 hitters) | 0.70, the same as without hitter features |
| Calibration | Test deciles sit on the diagonal (see page) |

What this means:
* The model beats raw small-sample hitter splits clearly.
* Most of a plan's value comes from the pitcher's own pitch shapes and locations. Hitter traits tilt the plan modestly. The clearest hitter effect is **chase rate**: against top-quartile chasers, breaking balls below the zone gain about +0.8 runs/100 in the model, and the empirical gap is larger.
* Bat speed and swing length have small effects in the model.
* The residual layer is neutral; heavier shrinkage was slightly better. Treat hitter-specific splits as mostly noise.
* `auc_whiff_on_swings_*` in `validation.json` is ~0.47. It is **not** a useful metric here because pitch value also rewards called strikes on takes. It's kept only for transparency.
* Not modeled: sequencing/tunneling, catcher, park, umpire, and roster changes.

## Run
```bash
cd gameplan && ./run.sh      # ~8 min on 8 cores; needs R (DBI, duckdb, data.table, xgboost, jsonlite) + google-chrome
```
`work/` holds the scratch DuckDB and model files (git-ignored via `gameplan/.gitignore`). Note: the repo's root `.gitignore` ignores `*.csv`, so `out/feature_importance.csv` won't be committed unless that rule changes. The same importance numbers are in `site/gameplan_data.json` under `importance`.

## Integration notes (for whoever wires this into `site/`)
Copy `site/gameplan.html`, `gameplan_print.html`, `gameplan_data.json`, `gameplan_data.js`, and `gameplan_wacha_vs_MIN.pdf` into the main `site/`. The page already uses site-relative `img/favicon.svg` and a nav entry "Game Plan" pointing to `gameplan.html`. It needs no external JS (no Plotly; the charts are inline SVG).
