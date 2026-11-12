"""Assemble static pages: site_src/<page>.html bodies + shared head/nav/footer -> site/<page>.html.
Also copies the SQL / R source into site/code so the Methods page shows the real pipeline code."""

import json
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "site_src", ROOT / "site"
PAGES = [
    ("index.html", "Home"),
    ("explorer.html", "Pitcher Explorer"),
    ("research.html", "Research"),
    ("tunnel/index.html", "Tunnel Viewer"),
    ("gameplan.html", "Game Plan"),
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
<script src="assets/plotly.min.js" defer></script><script src="assets/palette.js" defer></script><script src="assets/app.js" defer></script>
</head><body>
<nav class="nav"><div class="wrap"><a class="brand" href="index.html"><img src="img/favicon.svg" alt="">Devin Jenkinson <span class="muted" style="font-weight:500">· Pitching R&amp;D</span></a>
<button class="burger" aria-label="Menu">☰</button><ul>{links}</ul></div></nav>
"""
FOOT = """<footer><div class="wrap">
<p>Independent portfolio project by Devin Jenkinson. Not affiliated with, endorsed by, or produced for Major League Baseball or any MLB club. Team abbreviations and player names are used only to describe public data.</p>
<p>Data: <a href="https://baseballsavant.mlb.com/statcast_search">Baseball Savant Statcast search</a> (public pitch-level data, 2026 regular season, <span data-meta="first_day"></span> to <span data-meta="last_day"></span>); player names from the MLB Stats API. Built <span data-meta="built"></span>.
Code: <a href="{gh}">GitHub repo</a> <a href="{gh}/actions/workflows/ci.yml"><img src="{gh}/actions/workflows/ci.yml/badge.svg" alt="CI status" style="vertical-align:middle;height:20px"></a> · Contact: <a href="mailto:devin.jenkinson182@gmail.com">devin.jenkinson182@gmail.com</a></p>
</div></footer></body></html>"""
# Pages built here from site_src/; tunnel.html and gameplan.html are self-contained pages copied in from
# tunnel/ and gameplan/ -- for those we only rewrite the nav list (and add the CI badge) so every page matches.
NAV = [(n, t) for n, t in PAGES if (SRC / n).exists() or (OUT / n).exists()]
links = "".join(f'<li><a href="{n}">{t}</a></li>' for n, t in NAV)
BADGE = f' <a href="{GITHUB}/actions/workflows/ci.yml"><img src="{GITHUB}/actions/workflows/ci.yml/badge.svg" alt="CI status" style="vertical-align:middle;height:20px"></a>'
TUNNEL_NAV = (
    '<div class="nav-inner"><a class="brand" href="../index.html">Devin Jenkinson <span>· Pitching R&amp;D</span></a><ul class="site-links">'
    + "".join(f'<li><a href="../{n}"{" class=on" if n.startswith("tunnel/") else ""}>{t}</a></li>' for n, t in NAV)
    + "</ul></div>"
)
pal_js = json.dumps({k: v for k, v in json.loads((ROOT / "config" / "pitch_colors.json").read_text()).items() if not k.startswith("_")})
for name, title in NAV:
    if name.startswith("tunnel/"):
        html = (OUT / name).read_text()
        html = re.sub(
            r"<!--site-nav-->.*?<!--/site-nav-->", lambda m: "<!--site-nav-->" + TUNNEL_NAV + "<!--/site-nav-->", html, flags=re.S
        )
        (OUT / name).write_text(html)
        continue
    if (SRC / name).exists():
        body = (SRC / name).read_text()
        (OUT / name).write_text(HEAD.format(title=title, links=links) + body + FOOT.format(gh=GITHUB))
        continue
    html = (OUT / name).read_text()
    head, sep, rest = html.partition('<button class="burger" aria-label="Menu">☰</button><ul>')
    if sep:
        cur = links.replace(f'href="{name}">', f'href="{name}" class="on">')
        html = head + sep + cur + rest[rest.index("</ul>") :]
    # shared pitch palette (config/pitch_colors.json) instead of the page's own
    html = re.sub(r"const PAL=\{[^}]*\};", lambda m: f"const PAL={pal_js};", html)
    gh_link = f'<a href="{GITHUB}">GitHub repo</a>'
    if gh_link in html and "ci.yml/badge.svg" not in html:
        html = html.replace(gh_link, gh_link + BADGE, 1)
    (OUT / name).write_text(html)
code = OUT / "code"
code.mkdir(exist_ok=True)
for f in list((ROOT / "sql").glob("*.sql")) + list((ROOT / "R").glob("*.R")) + list((ROOT / "report").glob("*.Rmd")) + [ROOT / "Makefile"]:
    if f.exists():
        shutil.copy(f, code / (f.name + (".txt" if f.suffix in (".R", ".Rmd", "") else ".txt")))
pal = json.loads((ROOT / "config" / "pitch_colors.json").read_text())
pal = {k: v for k, v in pal.items() if not k.startswith("_")}
(OUT / "assets" / "palette.js").write_text(
    "// generated from config/pitch_colors.json by scripts/build_pages.py\nwindow.PITCH_COLORS = " + json.dumps(pal) + ";\n"
)
print("pages:", ", ".join(n for n, _ in PAGES))
