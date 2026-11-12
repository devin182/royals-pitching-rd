#!/usr/bin/env python3
"""Build tunnel/tunnel.json from the repo's Statcast DuckDB.

Reads the shared database READ-ONLY (copies it to /tmp first so a lock
doesn't block other agents). Averages the Statcast 9-parameter fit for
every 2026 Kansas City Royals pitcher x pitch type with at least
MIN_PITCHES pitches, then reconstructs the average trajectory.

Trajectory model (Statcast constant acceleration, parameters at y = 50 ft):

    y(t) = 50 + vy0 t + 1/2 ay t^2
    x(t) = x50 + vx0 t + 1/2 ax t^2
    z(t) = z50 + vz0 t + 1/2 az t^2

t = 0 is the y = 50 ft plane. Release is at y = 60.5 - extension (t < 0);
the front of the plate is at y = 17/12 ft (t > 0). x50, z50 are backed
out so the path passes through the average release_pos_x / release_pos_z.
"""

from __future__ import annotations

import json
import math
import shutil
import sys
from pathlib import Path

import duckdb

DIR = Path(__file__).resolve().parent
REPO = DIR.parent
DB_SRC = REPO / "data" / "statcast.duckdb"
DB_COPY = Path("/tmp/statcast_tunnel.duckdb")
OUT = DIR / "tunnel.json"

MIN_PITCHES = 30
N_POINTS = 40
Y_REF = 50.0
RUBBER_Y = 60.5
PLATE_FRONT_Y = 17.0 / 12.0  # 1.4167 ft
COMMIT_FROM_FRONT_FT = 23.8
COMMIT_Y = PLATE_FRONT_Y + COMMIT_FROM_FRONT_FT  # 25.2167 ft from the back point
FT_S_TO_MPH = 3600.0 / 5280.0  # 0.681818...
SEASON = 2026
TEAM = "KC"

# Default pair shown on first load: a starter with a clear fastball / breaking-ball tunnel.
DEFAULT_PITCHER = 702070  # Noah Cameron
DEFAULT_A = "FF"
DEFAULT_B = "SL"


def time_at_y(vy0: float, ay: float, y: float) -> float:
    """Time when the ball crosses a given y, with t = 0 at y = 50.

    The physical root is t = (-vy0 - sqrt(vy0^2 - 2 ay (50 - y))) / ay,
    which is negative at release (y > 50) and positive toward the plate.
    """
    disc = vy0 * vy0 - 2.0 * ay * (Y_REF - y)
    if disc < 0:
        raise ValueError(f"negative discriminant at y={y}: vy0={vy0}, ay={ay}")
    return (-vy0 - math.sqrt(disc)) / ay


def state_at_t(x50, z50, vx0, vy0, vz0, ax, ay, az, t):
    x = x50 + vx0 * t + 0.5 * ax * t * t
    y = Y_REF + vy0 * t + 0.5 * ay * t * t
    z = z50 + vz0 * t + 0.5 * az * t * t
    vx = vx0 + ax * t
    vy = vy0 + ay * t
    vz = vz0 + az * t
    return x, y, z, vx, vy, vz


def r3(v: float) -> float:
    return round(float(v), 3)


def r4(v: float) -> float:
    return round(float(v), 4)


def speed_mph(vx, vy, vz) -> float:
    return math.sqrt(vx * vx + vy * vy + vz * vz) * FT_S_TO_MPH


def reconstruct(rel_x, rel_z, ext, vx0, vy0, vz0, ax, ay, az):
    y_rel = RUBBER_Y - ext
    t_rel = time_at_y(vy0, ay, y_rel)
    t_plt = time_at_y(vy0, ay, PLATE_FRONT_Y)
    t_cmt = time_at_y(vy0, ay, COMMIT_Y)
    x50 = rel_x - vx0 * t_rel - 0.5 * ax * t_rel * t_rel
    z50 = rel_z - vz0 * t_rel - 0.5 * az * t_rel * t_rel

    def at(t):
        return state_at_t(x50, z50, vx0, vy0, vz0, ax, ay, az, t)

    pts = []
    for i in range(N_POINTS):
        u = i / (N_POINTS - 1)
        t = t_rel + u * (t_plt - t_rel)
        x, y, z, *_ = at(t)
        pts.append([r3(x), r3(y), r3(z)])

    xr, yr, zr, vxr, vyr, vzr = at(t_rel)
    xc, yc, zc, vxc, vyc, vzc = at(t_cmt)
    xp, yp, zp, vxp, vyp, vzp = at(t_plt)
    return {
        "t_rel": t_rel,
        "t_cmt": t_cmt,
        "t_plt": t_plt,
        "x50": x50,
        "z50": z50,
        "pts": pts,
        "release": (xr, yr, zr, vxr, vyr, vzr),
        "commit": (xc, yc, zc, vxc, vyc, vzc),
        "plate": (xp, yp, zp, vxp, vyp, vzp),
    }


def open_db():
    if not DB_SRC.exists():
        sys.exit(f"missing database: {DB_SRC}")
    shutil.copy2(DB_SRC, DB_COPY)
    return duckdb.connect(str(DB_COPY), read_only=True)


def main():
    con = open_db()

    # Royals pitchers = pitchers with pitch_team = 'KC'. That column is built
    # in sql/01_load.sql as: when the inning is the top, the home team is
    # pitching; otherwise the away team is. Validated below by name.
    rows = con.execute(
        """
        SELECT
          p.pitcher                                              AS pitcher_id,
          any_value(pl.full_name)                                AS full_name,
          any_value(p.player_name)                               AS savant_name,
          any_value(p.p_throws)                                  AS throws,
          p.pitch_type                                           AS pitch_type,
          any_value(p.pitch_name)                                AS pitch_name,
          count(*)                                               AS n,
          avg(p.release_pos_x)                                   AS rel_x,
          avg(p.release_pos_z)                                   AS rel_z,
          avg(p.release_extension)                               AS ext,
          avg(p.vx0)                                             AS vx0,
          avg(p.vy0)                                             AS vy0,
          avg(p.vz0)                                             AS vz0,
          avg(p.ax)                                              AS ax,
          avg(p.ay)                                              AS ay,
          avg(p.az)                                              AS az,
          avg(p.release_speed)                                   AS velo,
          avg(p.plate_x)                                         AS plate_x,
          avg(p.plate_z)                                         AS plate_z,
          avg(p.sz_top)                                          AS sz_top,
          avg(p.sz_bot)                                          AS sz_bot
        FROM pitches p
        LEFT JOIN players pl ON pl.id = p.pitcher
        WHERE p.pitch_team = ?
          AND p.game_year = ?
          AND p.pitch_type IS NOT NULL
          AND p.release_extension IS NOT NULL
          AND p.vx0 IS NOT NULL AND p.vy0 IS NOT NULL AND p.vz0 IS NOT NULL
          AND p.ax IS NOT NULL AND p.ay IS NOT NULL AND p.az IS NOT NULL
          AND p.release_pos_x IS NOT NULL AND p.release_pos_z IS NOT NULL
        GROUP BY p.pitcher, p.pitch_type
        HAVING count(*) >= ?
        ORDER BY pitcher_id, n DESC
        """,
        [TEAM, SEASON, MIN_PITCHES],
    ).fetchall()
    cols = [
        "pitcher_id", "full_name", "savant_name", "throws", "pitch_type",
        "pitch_name", "n", "rel_x", "rel_z", "ext", "vx0", "vy0", "vz0",
        "ax", "ay", "az", "velo", "plate_x", "plate_z", "sz_top", "sz_bot",
    ]

    zone = con.execute(
        """
        SELECT avg(sz_top), avg(sz_bot)
        FROM pitches
        WHERE pitch_team = ? AND game_year = ? AND sz_top IS NOT NULL
        """,
        [TEAM, SEASON],
    ).fetchone()
    con.close()

    by_pitcher: dict[int, dict] = {}
    sanity = []
    for raw in rows:
        r = dict(zip(cols, raw))
        rec = reconstruct(
            r["rel_x"], r["rel_z"], r["ext"],
            r["vx0"], r["vy0"], r["vz0"],
            r["ax"], r["ay"], r["az"],
        )
        xp, yp, zp, vxp, vyp, vzp = rec["plate"]
        xr, yr, zr, vxr, vyr, vzr = rec["release"]
        xc, yc, zc, *_ = rec["commit"]
        rel_mph = speed_mph(vxr, vyr, vzr)
        plt_mph = speed_mph(vxp, vyp, vzp)
        sanity.append({
            "name": r["full_name"] or r["savant_name"],
            "pitch_type": r["pitch_type"],
            "n": int(r["n"]),
            "d_plate_x_in": (xp - r["plate_x"]) * 12,
            "d_plate_z_in": (zp - r["plate_z"]) * 12,
            "d_velo_mph": rel_mph - r["velo"],
            "obs_plate_x": r["plate_x"],
            "rec_plate_x": xp,
            "obs_plate_z": r["plate_z"],
            "rec_plate_z": zp,
            "obs_velo": r["velo"],
            "rec_velo": rel_mph,
            "rec_plate_velo": plt_mph,
        })

        pid = int(r["pitcher_id"])
        if pid not in by_pitcher:
            by_pitcher[pid] = {
                "id": pid,
                "name": r["full_name"] or " ".join(reversed(r["savant_name"].split(", "))),
                "throws": r["throws"],
                "n": 0,
                "sz_top": 0.0,
                "sz_bot": 0.0,
                "pitches": {},
            }
        # Weighted zone later
        entry = {
            "name": r["pitch_name"],
            "n": int(r["n"]),
            "velo": r3(r["velo"]),
            "ext": r3(r["ext"]),
            "rel": [r3(r["rel_x"]), r3(RUBBER_Y - r["ext"]), r3(r["rel_z"])],
            "p50": {
                "vx0": r4(r["vx0"]), "vy0": r4(r["vy0"]), "vz0": r4(r["vz0"]),
                "ax": r4(r["ax"]), "ay": r4(r["ay"]), "az": r4(r["az"]),
                "x": r4(rec["x50"]), "z": r4(rec["z50"]),
            },
            "t": [r4(rec["t_rel"]), r4(rec["t_cmt"]), r4(rec["t_plt"])],
            "commit": [r3(xc), r3(yc), r3(zc)],
            "plate": [r3(xp), r3(yp), r3(zp)],
            "plate_mph": r3(plt_mph),
            "pts": rec["pts"],
            "_sz_top": float(r["sz_top"]),
            "_sz_bot": float(r["sz_bot"]),
        }
        by_pitcher[pid]["pitches"][r["pitch_type"]] = entry
        by_pitcher[pid]["n"] += int(r["n"])

    # Drop pitchers with fewer than two qualifying types (nothing to compare)
    # and roll up a pitch-weighted strike zone.
    pitchers = []
    for rec in by_pitcher.values():
        if len(rec["pitches"]) < 2:
            continue
        tw = sum(p["n"] for p in rec["pitches"].values())
        rec["sz_top"] = r3(sum(p["_sz_top"] * p["n"] for p in rec["pitches"].values()) / tw)
        rec["sz_bot"] = r3(sum(p["_sz_bot"] * p["n"] for p in rec["pitches"].values()) / tw)
        for p in rec["pitches"].values():
            del p["_sz_top"]
            del p["_sz_bot"]
        pitchers.append(rec)

    pitchers.sort(key=lambda p: (-p["n"], p["name"]))

    # Keep the default only if that pitcher made the cut with both types.
    default_pitcher = DEFAULT_PITCHER
    default_a, default_b = DEFAULT_A, DEFAULT_B
    ids = {p["id"]: p for p in pitchers}
    if default_pitcher not in ids or default_a not in ids[default_pitcher]["pitches"] \
            or default_b not in ids[default_pitcher]["pitches"]:
        default_pitcher = pitchers[0]["id"]
        types = list(pitchers[0]["pitches"])
        default_a, default_b = types[0], types[1] if len(types) > 1 else types[0]

    payload = {
        "meta": {
            "season": SEASON,
            "team": TEAM,
            "source": "Baseball Savant Statcast, via this repo's DuckDB (data/statcast.duckdb)",
            "min_pitches": MIN_PITCHES,
            "n_points": N_POINTS,
            "y_ref_ft": Y_REF,
            "plate_front_y_ft": r4(PLATE_FRONT_Y),
            "commit_from_plate_front_ft": COMMIT_FROM_FRONT_FT,
            "commit_y_ft": r4(COMMIT_Y),
            "comparison": "y-matched",
            "model": "Statcast constant-acceleration; vx0,vy0,vz0,ax,ay,az defined at y=50 ft",
            "default_pitcher": default_pitcher,
            "default_a": default_a,
            "default_b": default_b,
        },
        "zone": {"sz_top": r3(zone[0]), "sz_bot": r3(zone[1])},
        "pitchers": pitchers,
    }

    OUT.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    size = OUT.stat().st_size

    n_types = sum(len(p["pitches"]) for p in pitchers)
    n_pitches = sum(p["n"] for p in pitchers)
    print(f"wrote {OUT} ({size:,} bytes)")
    print(f"pitchers: {len(pitchers)}  pitch types: {n_types}  pitches used: {n_pitches:,}")
    print("roster:")
    for p in pitchers:
        types = ", ".join(f"{k}({v['n']})" for k, v in p["pitches"].items())
        print(f"  {p['name']:20} {p['throws']}  {p['n']:4d}  {types}")

    # Sanity: reconstructed plate location / release speed vs observed averages.
    # Restrict the printed sample to pitchers who remain in the viewer.
    keep = {p["id"] for p in pitchers}
    # Map name+type from sanity; print two well-known arms in full and a summary.
    print("\nSanity check: average-parameter trajectory vs average observed plate_x/plate_z")
    print("and release speed. Plate crossing is y = 17/12 ft. Residuals are in inches / mph.")
    # Recompute name filter from sanity list — it has no id. Use the printed pairs.
    focus = {("Noah Cameron", "FF"), ("Noah Cameron", "SL"),
             ("Michael Wacha", "FF"), ("Michael Wacha", "CU")}
    for s in sanity:
        if (s["name"], s["pitch_type"]) in focus:
            print(
                f"  {s['name']} {s['pitch_type']} n={s['n']}: "
                f"plate_x obs={s['obs_plate_x']:+.3f} rec={s['rec_plate_x']:+.3f} "
                f"d={s['d_plate_x_in']:+.2f} in; "
                f"plate_z obs={s['obs_plate_z']:.3f} rec={s['rec_plate_z']:.3f} "
                f"d={s['d_plate_z_in']:+.2f} in; "
                f"velo obs={s['obs_velo']:.2f} rec={s['rec_velo']:.2f} "
                f"d={s['d_velo_mph']:+.3f} mph; "
                f"plate velo rec={s['rec_plate_velo']:.2f} mph"
            )

    # Overall residual summary for every averaged type that made the cut
    names_ok = {p["name"] for p in pitchers}
    used = [s for s in sanity if s["name"] in names_ok]
    def mean(xs):
        xs = list(xs)
        return sum(xs) / len(xs)
    print(
        f"  all {len(used)} types: "
        f"mean |d plate_x|={mean(abs(s['d_plate_x_in']) for s in used):.2f} in, "
        f"mean |d plate_z|={mean(abs(s['d_plate_z_in']) for s in used):.2f} in, "
        f"mean |d velo|={mean(abs(s['d_velo_mph']) for s in used):.3f} mph, "
        f"mean signed d plate_z={mean(s['d_plate_z_in'] for s in used):+.2f} in"
    )
    print(f"default view: {ids[default_pitcher]['name']} {default_a} vs {default_b}")


if __name__ == "__main__":
    main()
