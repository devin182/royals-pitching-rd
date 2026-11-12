"""Batter/pitcher name lookup (MLB Stats API people endpoint) for every player id in the raw Statcast files."""

import csv
import json
import urllib.request

import duckdb

RAW = "read_csv('data/raw/days/*.csv', union_by_name=true, ignore_errors=true)"
ids = [r[0] for r in duckdb.sql(f"SELECT DISTINCT batter FROM {RAW} UNION SELECT DISTINCT pitcher FROM {RAW}").fetchall() if r[0]]
out = "data/raw/players.csv"
rows = []
for i in range(0, len(ids), 150):
    url = "https://statsapi.mlb.com/api/v1/people?personIds=" + ",".join(str(int(x)) for x in ids[i : i + 150])
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.5.0"})
    for p in json.load(urllib.request.urlopen(req, timeout=60))["people"]:
        rows.append((p["id"], p.get("fullName"), p.get("batSide", {}).get("code"), p.get("pitchHand", {}).get("code")))
with open(out, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["id", "full_name", "bats", "throws"])
    w.writerows(rows)
print(f"{len(rows)} players -> {out}")
