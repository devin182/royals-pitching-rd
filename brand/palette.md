# Palette and type

Personal visual kit for a pitching-analytics portfolio. These colors are a
private navy / powder-blue / gold system for the site — not a team identity,
and they must not be combined with any MLB or club marks, crowns, uniforms,
or wordmarks.

## Color

| Hex | Name | Role | Contrast on bg navy / deep navy |
| --- | --- | --- | --- |
| `#0B1F3A` | Bg navy | Page background, hero field, favicon ground | Ground (not a text color) |
| `#071428` | Deep navy | Gradient terminus, footer, extra-dark panels | Ground (not a text color) |
| `#7AB2DD` | Powder blue | Primary line, links, monogram letters, charts | 7.27:1 (AAA) / 8.11:1 (AAA) |
| `#C5DCEF` | Light blue tint | Hover / highlight tints, secondary series | 11.69:1 (AAA) / 13.04:1 (AAA) |
| `#C9A227` | Gold | Accent trajectory, key dots, focus marks | 6.83:1 (AA) / 7.62:1 (AAA) |
| `#E8EEF4` | Off-white | Primary text and numbers on navy | 14.13:1 (AAA) / 15.76:1 (AAA) |
| `#9AA3B5` | Muted grey | Secondary text, axis labels, captions | 6.51:1 (AA) / 7.26:1 (AAA) |

Contrast is computed from sRGB relative luminance per WCAG 2.x
\((L1 + 0.05) / (L2 + 0.05)\). Grades: **AA** is 4.5:1 (regular text) or
3:1 (large text / UI), **AAA** is 7:1 (regular) or 4.5:1 (large).

- **Off-white** on either navy is AAA for body text and numbers.
- **Muted grey** on bg navy is AA for body text (and AAA for large text).
- **Powder blue** on bg navy is AAA — safe for links and chart labels.
- **Gold** on bg navy is AA for text and AAA for large type. Prefer it as an
  accent, not as long-form body copy. On deep navy it reaches AAA.
- Do not set body text in gold or powder on a light panel; if a light surface
  is needed, use off-white or tint as the ground and navy (`#0B1F3A`) as the
  text (off-white on navy inverted: **14.13:1**, AAA).

## Type

A free Google Fonts pairing: **Archivo** for headlines (compact, contemporary,
not a sports-broadcast costume), **IBM Plex Sans** for body copy (clear at
small sizes, comfortable for analysis write-ups), and **JetBrains Mono** for
numeric tables, pitch metrics, and code-like stat callouts.

```css
@import url('https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,500;0,600;0,700;1,500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --color-bg: #0B1F3A;
  --color-bg-deep: #071428;
  --color-powder: #7AB2DD;
  --color-powder-tint: #C5DCEF;
  --color-gold: #C9A227;
  --color-text: #E8EEF4;
  --color-text-muted: #9AA3B5;

  --font-display: 'Archivo', 'Arial Narrow', 'Helvetica Neue', sans-serif;
  --font-body: 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif;
  --font-mono: 'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace;
}

html {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
  font-weight: 400;
}

h1, h2, h3, .display {
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--color-text);
}

.stat, table.numeric, code, kbd {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

a { color: var(--color-powder); }
a:hover { color: var(--color-powder-tint); }
.accent { color: var(--color-gold); }
.muted { color: var(--color-text-muted); }
```

Load only the listed weights if the site needs to stay lean; `display=swap`
is already in the `@import` line.
