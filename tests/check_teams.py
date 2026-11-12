"""Multi-team data checks (CI site job): every club has complete, valid, consistent data files."""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
D = ROOT / "site" / "data"
errors = []


def load(p):
    try:
        return json.loads(p.read_text())
    except Exception as e:  # missing file or invalid JSON
        errors.append(f"{p.relative_to(ROOT)}: {e}")
        return None


def arr(v):
    return v if isinstance(v, list) else [v]


cfg = {k for k in json.loads((ROOT / "config" / "teams.json").read_text()) if not k.startswith("_")}
teams = load(D / "teams.json")
codes = [t["team"] for t in teams["teams"]]
if len(codes) != 30 or set(codes) != cfg:
    errors.append(f"teams.json lists {len(codes)} teams; expected the 30 in config/teams.json")
if teams["default"] != "KC":
    errors.append("default team should be KC")
n_pitchers = 0
for t in teams["teams"]:
    T = t["team"]
    idx = load(D / "t" / T / "index.json")
    season = load(D / "t" / T / "season.json")
    seq = load(D / "seq" / f"{T}.json")
    lab = load(D / "lab" / "teams" / f"{T}.json")
    tun = load(ROOT / "site" / "tunnel" / "teams" / f"{T}.json")
    if None in (idx, season, seq, lab, tun):
        continue
    ps = idx["pitchers"]
    if len(ps) != t["listed"]:
        errors.append(f"{T}: index has {len(ps)} pitchers, teams.json says {t['listed']}")
    if not ps:
        errors.append(f"{T}: no pitchers")
    for p in ps:
        n_pitchers += 1
        if p["n"] < idx["min_pitches"]:
            errors.append(f"{T} {p['id']}: {p['n']} pitches < {idx['min_pitches']}")
        listed = sum(a["n"] for a in p["arsenal"])  # rare types are left out of the arsenal table
        if not 0.8 * p["n"] <= listed <= p["n"]:
            errors.append(f"{T} {p['id']}: arsenal covers {listed} of {p['n']} pitches")
        f = load(D / "t" / T / "p" / f"{p['id']}.json")
        if f is None:
            continue
        cols = f["pitches"]
        lens = {len(arr(v)) for v in cols.values()}
        if len(lens) != 1 or lens.pop() > 450:
            errors.append(f"{T} {p['id']}: ragged or oversized pitch sample")
        if not {a["pitch_type"] for a in p["arsenal"]} & set(arr(cols["pitch_type"])):
            errors.append(f"{T} {p['id']}: pitch sample shares no type with the arsenal")
    ids = {p["id"] for p in ps}
    if {p["id"] for p in season["pitchers"]} != ids:
        errors.append(f"{T}: season tracker pitchers differ from the index")
    if [s["m"] for s in season["staff"]] != teams["months"]:
        errors.append(f"{T}: season months differ from teams.json")
    if sum(s["n"] for s in season["staff"]) != t["pitches"]:
        errors.append(f"{T}: monthly pitches do not add up to the season total")
    if seq["team"] != T or not 0.6 * t["pitches"] < seq["n"] <= t["pitches"]:  # first pitch of each PA has no previous pitch
        errors.append(f"{T}: sequencing team file mismatch")
    if tun["meta"]["team"] != T or not tun["pitchers"]:
        errors.append(f"{T}: tunnel file mismatch")
    for r in lab:
        if not (D / "lab" / "p" / f"{r['pitcher']}_{r['pitch_type']}.json").exists():
            errors.append(f"{T}: lab baseline missing for {r['pitcher']}_{r['pitch_type']}")
if errors:
    print("\n".join(errors[:50]))
    sys.exit(f"{len(errors)} multi-team check(s) failed")
print(f"ok: 30 teams, {n_pitchers} team-pitchers with 300+ pitches; index, season, pitcher, sequencing, lab and tunnel files consistent")
