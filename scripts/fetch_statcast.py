"""Download 2026 regular-season Statcast pitch-level data (all MLB) from Baseball Savant,
one day per request (Savant caps a single CSV response at ~25k rows)."""

import concurrent.futures as cf
import datetime as dt
import os
import time
import urllib.request

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "raw", "days")
os.makedirs(OUT, exist_ok=True)
SEASON = int(os.environ.get("SEASON", "2026"))
START = dt.date(SEASON, 3, 20)
END = dt.date(SEASON, 10, 5)
URL = (
    "https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfGT=R%7C&hfSea={y}%7C"
    "&player_type=pitcher&game_date_gt={d}&game_date_lt={d}&type=details"
)


def get(d):
    path = os.path.join(OUT, f"{d}.csv")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return d, "cached"
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL.format(y=SEASON, d=d), headers={"User-Agent": "curl/8.5.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read()
            open(path, "wb").write(body)
            return d, len(body)
        except Exception as e:
            time.sleep(5 * (attempt + 1))
            err = e
    return d, f"FAILED {err}"


days = [START + dt.timedelta(i) for i in range((END - START).days + 1)]
with cf.ThreadPoolExecutor(3) as ex:
    for d, s in ex.map(get, days):
        print(d, s, flush=True)
