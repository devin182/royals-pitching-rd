"""Batter/pitcher name lookup (MLB Stats API people endpoint) for every player id in the raw Statcast files."""
import duckdb, json, urllib.request, csv, os
ids = [r[0] for r in duckdb.sql("SELECT DISTINCT batter FROM read_csv('data/raw/days/*.csv', union_by_name=true, ignore_errors=true) "
                                "UNION SELECT DISTINCT pitcher FROM read_csv('data/raw/days/*.csv', union_by_name=true, ignore_errors=true)").fetchall() if r[0]]
out = "data/raw/players.csv"; rows = []
for i in range(0, len(ids), 150):
    url = "https://statsapi.mlb.com/api/v1/people?personIds=" + ",".join(str(int(x)) for x in ids[i:i+150])
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.5.0"})
    for p in json.load(urllib.request.urlopen(req, timeout=60))["people"]:
        rows.append((p["id"], p.get("fullName"), p.get("batSide", {}).get("code"), p.get("pitchHand", {}).get("code")))
with open(out, "w", newline="") as f:
    w = csv.writer(f); w.writerow(["id", "full_name", "bats", "throws"]); w.writerows(rows)
print(f"{len(rows)} players -> {out}")
