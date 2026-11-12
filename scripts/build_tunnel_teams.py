"""Build one Tunnel Viewer file per MLB team: site/tunnel/teams/<TEAM>.json.

Reuses tunnel/build_tunnel.py unchanged (the teammate's builder) by swapping its TEAM and OUT settings
for each club. The database is opened read-only in place (no write handle, safe while others read it).
"""

import contextlib
import io
import json
import pathlib
import sys

import duckdb

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tunnel"))
import build_tunnel as bt  # noqa: E402

OUT = ROOT / "site" / "tunnel" / "teams"
TEAMS = sorted(k for k in json.loads((ROOT / "config" / "teams.json").read_text()) if not k.startswith("_"))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bt.open_db = lambda: duckdb.connect(str(bt.DB_SRC), read_only=True)
    total = 0
    for team in TEAMS:
        bt.TEAM, bt.OUT = team, OUT / f"{team}.json"
        with contextlib.redirect_stdout(io.StringIO()):
            bt.main()
        d = json.loads(bt.OUT.read_text())
        total += bt.OUT.stat().st_size
        print(f"{team}: {len(d['pitchers'])} pitchers, {bt.OUT.stat().st_size:,} bytes")
    print(f"{len(TEAMS)} teams, {total:,} bytes")


if __name__ == "__main__":
    main()
