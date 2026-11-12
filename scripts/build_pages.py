"""Assemble static pages: site_src/<page>.html bodies + shared head/nav/footer -> site/<page>.html.
Also copies the SQL / R source into site/code so the Methods page shows the real pipeline code."""

import hashlib
import json
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "site_src", ROOT / "site"
PAGES = [
    ("index.html", "Home"),
    ("explorer.html", "Pitcher Explorer"),
    ("season.html", "Season Tracker"),
    ("research.html", "Research"),
    ("sequencing.html", "Sequencing"),
    ("lab.html", "Design Lab"),
    ("tunnel/index.html", "Tunnel Viewer"),
    ("gameplan.html", "Game Plan"),
    ("reports.html", "Reports"),
    ("methods.html", "Methods & Code"),
]
GITHUB = "https://github.com/devin182/royals-pitching-rd"
# Plotly (1.3 MB) is only loaded by the pages that draw Plotly charts
PLOTLY_PAGES = {"explorer.html", "research.html", "season.html"}
# built like the others but linked from pages instead of the nav
EXTRA = [("card.html", "Coach Card")]
PLOTLY_TAG = '<script src="assets/plotly.min.js" defer></script>'
HEAD = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · Devin Jenkinson · Pitching R&amp;D Portfolio</title>
<meta name="description" content="Independent pitching analytics portfolio: season-long Statcast tracking of 2026 MLB pitching staffs (all 30 clubs; Royals featured) with DuckDB SQL, R and xgboost.">
<link rel="icon" href="img/favicon.svg" type="image/svg+xml"><link rel="icon" href="img/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="img/apple-touch-icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&amp;family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap">
<link rel="stylesheet" href="assets/style.css">
<script>window.DATA_V="{data_v}";</script>{plotly}<script src="assets/palette.js" defer></script><script src="assets/app.js" defer></script>
</head><body>
<nav class="nav"><div class="wrap"><a class="brand" href="index.html"><img src="img/favicon.svg" alt="" width="28" height="28">Devin Jenkinson <span class="muted" style="font-weight:500">· Pitching R&amp;D</span></a>
<button class="burger" aria-label="Menu">☰</button><ul>{links}</ul></div></nav>
"""
FOOT = """<footer><div class="wrap">
<p>Independent portfolio project by Devin Jenkinson. Not affiliated with, endorsed by, or produced for Major League Baseball or any MLB club. Team abbreviations and player names are used only to describe public data.</p>
<p>Data: <a href="https://baseballsavant.mlb.com/statcast_search">Baseball Savant Statcast search</a> (public pitch-level data, 2026 regular season, <span data-meta="first_day"></span> to <span data-meta="last_day"></span>); player names from the MLB Stats API.
Code: <a href="{gh}">GitHub repo</a> (<a href="{gh}/actions/workflows/ci.yml">CI status</a>) · Contact: <a href="mailto:devin.jenkinson182@gmail.com">devin.jenkinson182@gmail.com</a></p>
</div></footer></body></html>"""
code = OUT / "code"
code.mkdir(exist_ok=True)
for f in list((ROOT / "sql").glob("*.sql")) + list((ROOT / "R").glob("*.R")) + list((ROOT / "report").glob("*.Rmd")) + [ROOT / "Makefile"]:
    if f.exists():
        shutil.copy(f, code / (f.name + (".txt" if f.suffix in (".R", ".Rmd", "") else ".txt")))
# Pages built here from site_src/; tunnel.html and gameplan.html are self-contained pages copied in from
# tunnel/ and gameplan/ -- for those we only rewrite the nav list (and add the CI badge) so every page matches.
NAV = [(n, t) for n, t in PAGES if (SRC / n).exists() or (OUT / n).exists()]
# short nav labels so ten entries fit on one line at desktop widths
SHORT = {"Pitcher Explorer": "Explorer", "Season Tracker": "Season", "Tunnel Viewer": "Tunnel", "Methods & Code": "Methods"}
links = "".join(f'<li><a href="{n}">{SHORT.get(t, t)}</a></li>' for n, t in NAV)
BADGE = f' (<a href="{GITHUB}/actions/workflows/ci.yml">CI status</a>)'
TUNNEL_NAV = (
    '<div class="nav-inner"><a class="brand" href="../index.html">Devin Jenkinson <span>· Pitching R&amp;D</span></a><ul class="site-links">'
    + "".join(f'<li><a href="../{n}"{" class=on" if n.startswith("tunnel/") else ""}>{SHORT.get(t, t)}</a></li>' for n, t in NAV)
    + "</ul></div>"
)
pal_js = json.dumps({k: v for k, v in json.loads((ROOT / "config" / "pitch_colors.json").read_text()).items() if not k.startswith("_")})


def short_hash(*paths):
    h = hashlib.sha256()
    for f in paths:
        h.update(f.read_bytes())
    return h.hexdigest()[:10]


# Explorer data: one small index (names, arsenal tables, count/region summaries) for every page, plus one file per
# pitcher with the pitch sample and location grid, fetched only when that pitcher is picked (was a single 1.2 MB file).
EXP = OUT / "data" / "explorer.json"
if EXP.exists():
    exp = json.loads(EXP.read_text())
    (OUT / "data" / "explorer").mkdir(exist_ok=True)
    for p in exp:
        (OUT / "data" / "explorer" / f"{p['id']}.json").write_text(
            json.dumps({"pitches": p["pitches"], "heat": p["heat"]}, separators=(",", ":"))
        )
    idx = [{k: v for k, v in p.items() if k not in ("pitches", "heat")} for p in exp]
    (OUT / "data" / "explorer_index.json").write_text(json.dumps(idx, separators=(",", ":")))

# Cache busting: every local JS/CSS/JSON reference carries ?v=<content hash>, so a deploy never pairs new HTML
# with a stale cached script. Content hashes (not timestamps) keep the build reproducible for the CI sync check.
DATA_V = short_hash(*sorted((OUT / "data").rglob("*.json")), *sorted((OUT / "code").glob("*.txt")))

for name, title in NAV + [(n, t) for n, t in EXTRA if (SRC / n).exists()]:
    if name.startswith("tunnel/"):
        html = (OUT / name).read_text()
        html = re.sub(
            r"<!--site-nav-->.*?<!--/site-nav-->", lambda m: "<!--site-nav-->" + TUNNEL_NAV + "<!--/site-nav-->", html, flags=re.S
        )
        (OUT / name).write_text(html)
        continue
    if (SRC / name).exists():
        body = (SRC / name).read_text()
        (OUT / name).write_text(
            HEAD.format(
                title=title,
                links=links,
                data_v=DATA_V,
                plotly=PLOTLY_TAG if name in PLOTLY_PAGES else "",
            )
            + body
            + FOOT.format(gh=GITHUB)
        )
        continue
    html = (OUT / name).read_text()
    head, sep, rest = html.partition('<button class="burger" aria-label="Menu">☰</button><ul>')
    if sep:
        cur = links.replace(f'href="{name}">', f'href="{name}" class="on">')
        html = head + sep + cur + rest[rest.index("</ul>") :]
    # shared pitch palette (config/pitch_colors.json) instead of the page's own
    html = re.sub(r"const PAL=\{[^}]*\};", lambda m: f"const PAL={pal_js};", html)
    gh_link = f'<a href="{GITHUB}">GitHub repo</a>'
    html = re.sub(r' <a href="[^"]*/actions/workflows/ci\.yml"><img [^>]*badge\.svg[^>]*></a>', "", html)
    if gh_link in html and "actions/workflows/ci.yml" not in html:
        html = html.replace(gh_link, gh_link + BADGE, 1)
    (OUT / name).write_text(html)
pal = json.loads((ROOT / "config" / "pitch_colors.json").read_text())
pal = {k: v for k, v in pal.items() if not k.startswith("_")}
(OUT / "assets" / "palette.js").write_text(
    "// generated from config/pitch_colors.json by scripts/build_pages.py\nwindow.PITCH_COLORS = " + json.dumps(pal) + ";\n"
)


def bust(html, base):
    def rep(m):
        ref = m.group(2)
        f = (base / ref).resolve()
        return f'{m.group(1)}="{ref}?v={short_hash(f)}"' if f.exists() else m.group(0)

    html = re.sub(r'\?v=[0-9a-f]{10}(?=["\)])', "", html)
    return re.sub(r'(src|href)="((?![a-z]+:|//|#)[^"?]+\.(?:js|css|json))"', rep, html)


tun = OUT / "tunnel"
if (tun / "app.js").exists():
    teams_v = hashlib.sha1(
        b"".join(f.read_bytes() for f in sorted((tun / "teams").glob("*.json"))) + (OUT / "data" / "teams.json").read_bytes()
    ).hexdigest()[:10]
    js = re.sub(r'const TUNNEL_V = "[0-9a-f]*";', f'const TUNNEL_V = "{teams_v}";', (tun / "app.js").read_text())
    (tun / "app.js").write_text(js)
for name, _ in NAV + [(n, t) for n, t in EXTRA if (SRC / n).exists()]:
    page = OUT / name
    page.write_text(bust(page.read_text(), page.parent))
if (OUT / "gameplan_print.html").exists():
    (OUT / "gameplan_print.html").write_text(bust((OUT / "gameplan_print.html").read_text(), OUT))
print("pages:", ", ".join(n for n, _ in PAGES))
