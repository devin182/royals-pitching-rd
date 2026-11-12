# Pitch tunnel viewer

A 3D catcher's-eye (and orbit) view of average 2026 Kansas City Royals pitch trajectories, plus a 2D side/top fallback when WebGL is missing. This folder is self-contained. Site nav integration is handled elsewhere.

## Rebuild the data

```bash
python3 build_tunnel.py
```

Requires Python 3 with `duckdb`. The script copies `data/statcast.duckdb` to `/tmp` and opens the copy read-only so it doesn't lock the shared database. It writes `tunnel.json` (about 140 KB).

Royals pitchers are rows with `pitch_team = 'KC'` (the home team in the top of an inning, otherwise the away team). Names are joined from the `players` table and checked against the 2026 staff. A pitch type is included when that pitcher threw it at least 30 times with a complete 9-parameter Statcast fit. Pitchers with fewer than two qualifying types are omitted (nothing to compare).

## Trajectory model

Statcast constant acceleration, with `vx0, vy0, vz0, ax, ay, az` defined at `y = 50` ft:

```
y(t) = 50 + vy0 t + ½ ay t²
x(t) = x50 + vx0 t + ½ ax t²
z(t) = z50 + vz0 t + ½ az t²
```

`t = 0` is the `y = 50` plane. Release is at `y = 60.5 − extension` (`t < 0`); the front of the plate is at `y = 17/12` ft. `x50` and `z50` are backed out so the path goes through the average `release_pos_x` / `release_pos_z`. Each path is sampled at 40 points, uniformly in time.

**Separation is y-matched:** the Euclidean distance in the x–z plane at the same `y`, reported at the commit point (23.8 ft in front of the plate, `y = 17/12 + 23.8`) and at the plate, in inches.

## Serve and check

```bash
python3 -m http.server 8765 --directory /workspace/royals-portfolio/tunnel
# then open http://127.0.0.1:8765/
# 2D fallback: http://127.0.0.1:8765/?fallback=1
```

Vendored Three.js r170 lives in `vendor/` (no CDN). Screenshots from headless Chrome: `screenshot.png` (1280×800), `screenshot_mobile.png` (390×844), `screenshot_fallback.png` (WebGL disabled).

## Coverage and sanity (2026 KC, min 30 pitches)

27 pitchers, 120 pitch types, 22,839 pitches. Default view: Noah Cameron, 4-seam vs slider.

Reconstructed plate location and release speed, compared to the average observed `plate_x` / `plate_z` / `release_speed` of the same type (plate crossing at `y = 17/12` ft):

| Pitcher | Type | n | Δ plate_x | Δ plate_z | Δ release velo | Rec. plate velo |
|---|---|---:|---:|---:|---:|---:|
| Noah Cameron | FF | 695 | +0.08 in | +0.76 in | −0.006 mph | 84.7 mph |
| Noah Cameron | SL | 391 | +0.30 in | +1.23 in | −0.007 mph | 78.5 mph |
| Michael Wacha | FF | 840 | −0.22 in | +0.84 in | −0.067 mph | 85.4 mph |
| Michael Wacha | CU | 301 | −0.46 in | +1.52 in | −0.058 mph | 69.9 mph |

Across all 120 types: mean |Δ plate_x| = 0.25 in, mean |Δ plate_z| = 0.98 in, mean |Δ release velo| = 0.041 mph. Release speed and horizontal location match closely. There is a small, systematic ~1 in vertical residual (reconstructed slightly above observed `plate_z`) that is typical when an average of the 9 parameters is flown to the plate; the model itself reconstructs a single pitch's release point exactly.

Data: Baseball Savant Statcast, 2026 regular season, via this repo's DuckDB. No club marks are used.
