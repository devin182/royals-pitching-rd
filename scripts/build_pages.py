"""Assemble static pages: site_src/<page>.html bodies + shared head/nav/footer -> site/<page>.html.
Also copies the SQL / R source into site/code so the Methods page shows the real pipeline code."""

import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "site_src", ROOT / "site"
PAGES = [
    ("index.html", "Home"),
    ("explorer.html", "Pitcher Explorer"),
    ("research.html", "Research"),
    ("reports.html", "Reports"),
    ("methods.html", "Methods & Code"),
]
GITHUB = "https://github.com/devin182/royals-pitching-rd"
HEAD = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · Devin Jenkinson · Pitching R&amp;D Portfolio</title>
<meta name="description" content="Independent pitching analytics portfolio: Statcast pitch-level analysis of the 2026 Kansas City Royals staff with DuckDB SQL, R and xgboost.">
<link rel="icon" href="img/favicon.svg" type="image/svg+xml"><link rel="icon" href="img/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="img/apple-touch-icon-180.png">
<link rel="stylesheet" href="assets/style.css">
<script src="assets/plotly.min.js" defer></script><script src="assets/app.js" defer></script>
</head><body>
<nav class="nav"><div class="wrap"><a class="brand" href="index.html"><img src="img/favicon.svg" alt="">Devin Jenkinson <span class="muted" style="font-weight:500">· Pitching R&amp;D</span></a>
<button class="burger" aria-label="Menu">☰</button><ul>{links}</ul></div></nav>
"""
FOOT = """<footer><div class="wrap">
<p>Independent portfolio project by Devin Jenkinson. Not affiliated with, endorsed by, or produced for Major League Baseball or any MLB club. Team abbreviations and player names are used only to describe public data.</p>
<p>Data: <a href="https://baseballsavant.mlb.com/statcast_search">Baseball Savant Statcast search</a> (public pitch-level data, 2026 regular season, <span data-meta="first_day"></span> to <span data-meta="last_day"></span>); player names from the MLB Stats API. Built <span data-meta="built"></span>.
Code: <a href="{gh}">GitHub repo</a> <a href="{gh}/actions/workflows/ci.yml"><img src="{gh}/actions/workflows/ci.yml/badge.svg" alt="CI status" style="vertical-align:middle;height:20px"></a> · Contact: <a href="mailto:devin.jenkinson182@gmail.com">devin.jenkinson182@gmail.com</a></p>
</div></footer></body></html>"""
for name, title in PAGES:
    links = "".join(f'<li><a href="{n}">{t}</a></li>' for n, t in PAGES)
    body = (SRC / name).read_text()
    (OUT / name).write_text(HEAD.format(title=title, links=links) + body + FOOT.format(gh=GITHUB))
code = OUT / "code"
code.mkdir(exist_ok=True)
for f in list((ROOT / "sql").glob("*.sql")) + list((ROOT / "R").glob("*.R")) + list((ROOT / "report").glob("*.Rmd")) + [ROOT / "Makefile"]:
    if f.exists():
        shutil.copy(f, code / (f.name + (".txt" if f.suffix in (".R", ".Rmd", "") else ".txt")))
print("pages:", ", ".join(n for n, _ in PAGES))
