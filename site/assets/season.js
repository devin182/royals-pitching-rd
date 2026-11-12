// Season Tracker: month-by-month staff and pitcher trends from data/t/<TEAM>/season.json (R/07_teams.R)
(function () {
  const $ = (id) => document.getElementById(id);
  let D, MET = "velo", PI = 0, REQ = 0;
  const teamCol = () => (teamInfo() || {}).color || "#7AB2DD";
  const LG = { color: "#9AA3B5", dash: "dash", width: 1.5 };
  const asRows = (c) => colsToRows(c);
  const lgTrace = (y, name = "MLB") => ({ x: D.months, y, type: "scatter", mode: "lines", name, line: LG, hovertemplate: "MLB %{y}<extra></extra>" });
  function kpis() {
    const S = D.staff, f = S[0], l = S[S.length - 1], t = teamInfo();
    const tot = S.reduce((a, s) => ({ sw: a.sw + s.sw, wh: a.wh + s.wh, n: a.n + s.n }), { sw: 0, wh: 0, n: 0 });
    const k = [
      ["Pitches tracked", nFmt(tot.n), `${S.reduce((a, s) => a + s.g, 0)} team-games`],
      ["Season whiff / swing", pct(tot.wh / tot.sw, 1), `${pct(f.wh / f.sw, 1)} in ${f.m} → ${pct(l.wh / l.sw, 1)} in ${l.m}`],
      ["4-seam velo", `${fmt(l.ff_velo)} mph`, `${l.m}; ${f.m} ${fmt(f.ff_velo)} (MLB ${fmt(l.lg.ff_velo)} → Sep)`],
      ["Staff Stuff+", fmt(t.stuff, 1), `${f.m} ${fmt(f.stuff, 1)} → ${l.m} ${fmt(l.stuff, 1)}`],
    ];
    $("skpi").innerHTML = k.map(([a, b, c]) => `<div class="kpi"><b>${b}</b><span>${a}</span><div class="muted" style="font-size:.76rem;margin-top:4px">${c}</div></div>`).join("");
  }
  function rateChart(id, key, num, den, title, cap) {
    const S = D.staff, y = S.map((s) => s[num] / s[den]), n = S.map((s) => s[den]);
    const best = S.reduce((b, s, i) => (y[i] - S[i].lg[key] > y[b] - S[b].lg[key] ? i : b), 0);
    Plotly.react(id, [
      { x: D.months, y, type: "scatter", mode: "lines+markers", name: CUR_TEAM, line: { color: teamCol(), width: 3 }, marker: { size: 8 }, error_y: wilsonErr(y, n),
        customdata: n, hovertemplate: `${CUR_TEAM} %{y:.1%} · n=%{customdata}<extra></extra>` },
      lgTrace(S.map((s) => s.lg[key])),
    ], LAYOUT({ title: { text: title, font: { size: 14 } }, margin: { l: 56, r: 50, t: 40, b: 48 }, yaxis: { tickformat: ".0%" }, xaxis: { type: "category" },
      annotations: [callout(0, 0, `Best month vs MLB: ${S[best].m}, ${pct(y[best], 1)} vs ${pct(S[best].lg[key], 1)} (${sgn(100 * (y[best] - S[best].lg[key]), 1)} pts).`)] }), CFG);
    if (cap) $(cap).textContent = `Whiffs per swing by month; bars are 95% Wilson intervals. Swings per month: ${S.map((s) => `${s.m} ${nFmt(s.sw)}`).join(", ")}. Dashed = MLB average that month.`;
  }
  function cswChart() {
    const S = D.staff, csw = S.map((s) => s.csw / s.n), ch = S.map((s) => s.ch / s.oz);
    Plotly.react("s_csw", [
      { x: D.months, y: csw, name: "CSW", type: "scatter", mode: "lines+markers", line: { color: teamCol(), width: 3 }, error_y: wilsonErr(csw, S.map((s) => s.n)), hovertemplate: "CSW %{y:.1%}<extra></extra>" },
      { x: D.months, y: ch, name: "Chase", type: "scatter", mode: "lines+markers", line: { color: GOLD, width: 3 }, error_y: wilsonErr(ch, S.map((s) => s.oz)), hovertemplate: "Chase %{y:.1%}<extra></extra>" },
      Object.assign(lgTrace(S.map((s) => s.lg.csw), "MLB CSW"), { hovertemplate: "MLB CSW %{y:.1%}<extra></extra>" }),
      Object.assign(lgTrace(S.map((s) => s.lg.chase), "MLB chase"), { hovertemplate: "MLB chase %{y:.1%}<extra></extra>" }),
    ], LAYOUT({ title: { text: "CSW and chase rate by month", font: { size: 14 } }, margin: { l: 56, r: 70, t: 40, b: 48 }, yaxis: { tickformat: ".0%" }, xaxis: { type: "category" },
      annotations: endLabels([{ x: D.months, y: csw, name: "CSW", line: { color: teamCol() } }, { x: D.months, y: ch, name: "Chase", line: { color: GOLD } }]) }), CFG);
  }
  function veloChart() {
    const S = D.staff.filter((s) => s.ff_n > 0), ci = S.map((s) => (1.96 * s.ff_sd) / Math.sqrt(s.ff_n));
    const d = S.length > 1 ? S[S.length - 1].ff_velo - S[0].ff_velo : 0, dl = S.length > 1 ? S[S.length - 1].lg.ff_velo - S[0].lg.ff_velo : 0;
    Plotly.react("s_velo", [
      { x: S.map((s) => s.m), y: S.map((s) => s.ff_velo), type: "scatter", mode: "lines+markers", name: CUR_TEAM, line: { color: teamCol(), width: 3 }, marker: { size: 8 },
        error_y: { type: "data", array: ci, color: "rgba(232,238,244,.7)", thickness: 1.4, width: 4 }, customdata: S.map((s) => s.ff_n), hovertemplate: "%{y:.1f} mph · n=%{customdata}<extra></extra>" },
      lgTrace(S.map((s) => s.lg.ff_velo)),
    ], LAYOUT({ title: { text: "Four-seam velocity by month (mph)", font: { size: 14 } }, margin: { l: 56, r: 50, t: 40, b: 48 }, xaxis: { type: "category" },
      annotations: S.length > 1 ? [callout(0, 0, `${S[0].m} to ${S[S.length - 1].m}: ${sgn(d, 1)} mph, vs ${sgn(dl, 1)} for MLB.`)] : [] }), CFG);
    $("c_velo").textContent = `Average four-seam release speed; bars are 95% intervals for the mean. Four-seamers per month: ${S.map((s) => `${s.m} ${nFmt(s.ff_n)}`).join(", ")}.`;
  }
  function stuffChart() {
    const S = D.staff;
    Plotly.react("s_stuff", [
      { x: D.months, y: S.map((s) => s.stuff), type: "scatter", mode: "lines+markers", name: CUR_TEAM, line: { color: teamCol(), width: 3 }, marker: { size: 8 }, customdata: S.map((s) => s.n), hovertemplate: "Stuff+ %{y:.1f} · n=%{customdata}<extra></extra>" },
      lgTrace(S.map((s) => s.lg.stuff)),
    ], LAYOUT({ title: { text: "Staff Stuff+ by month", font: { size: 14 } }, margin: { l: 56, r: 50, t: 40, b: 48 }, xaxis: { type: "category" } }), CFG);
  }
  function mixChart() {
    const M = asRows(D.mix), tot = {}, all = {};
    M.forEach((r) => { tot[r.m] = (tot[r.m] || 0) + r.n; all[r.pitch_type] = (all[r.pitch_type] || 0) + r.n; });
    const N = Object.values(all).reduce((a, b) => a + b, 0), keep = Object.keys(all).filter((t) => all[t] / N >= 0.02).sort((a, b) => all[b] - all[a]);
    const share = (t) => D.months.map((m) => M.filter((r) => r.m === m && (t === "Other" ? !keep.includes(r.pitch_type) : r.pitch_type === t)).reduce((a, r) => a + r.n, 0) / (tot[m] || 1));
    const types = keep.concat(Object.keys(all).some((t) => !keep.includes(t)) ? ["Other"] : []);
    const tr = types.map((t) => ({ x: D.months, y: share(t), name: t, type: "scatter", mode: "lines", stackgroup: "one", line: { width: 0.5, color: t === "Other" ? MUTED : PAL[t] }, fillcolor: t === "Other" ? MUTED : PAL[t], hovertemplate: `${t} %{y:.1%}<extra></extra>` }));
    const sw = types.filter((t) => t !== "Other").map((t) => { const s = share(t); return { t, d: s[s.length - 1] - s[0] }; }).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
    let cum = 0; const lab = types.map((t) => { const s = share(t), v = s[s.length - 1]; const y = cum + v / 2; cum += v; return { x: D.months[D.months.length - 1], y, text: t, showarrow: false, xanchor: "left", xshift: 6, font: { color: t === "Other" ? MUTED : PAL[t], size: 11 } }; }).filter((a, i) => share(types[i]).slice(-1)[0] >= 0.04);
    Plotly.react("s_mix", tr, LAYOUT({ title: { text: "Staff pitch mix by month", font: { size: 14 } }, margin: { l: 56, r: 48, t: 40, b: 48 }, yaxis: { tickformat: ".0%", range: [0, 1] }, xaxis: { type: "category" },
      annotations: (sw ? [callout(0, 0, `Biggest mix shift: the ${sw.t}, ${sgn(100 * sw.d, 1)} pts of the staff's pitches from ${D.months[0]} to ${D.months[D.months.length - 1]}.`)] : []).concat(lab) }), CFG);
  }
  function pitcher() {
    const P = D.pitchers[PI], R = asRows(P.rows), types = [...new Set(R.map((r) => r.pitch_type))];
    const mtot = {}; R.forEach((r) => { mtot[r.m] = (mtot[r.m] || 0) + r.n; });
    const val = (r) => ({ velo: r.n >= 10 ? r.velo : null, stuff: r.n >= 20 ? r.stuff : null, whiff: r.sw >= MIN_SWINGS ? r.wh / r.sw : null, usage: r.n / mtot[r.m] })[MET];
    const tr = types.map((t) => {
      const rr = D.months.map((m) => R.find((r) => r.m === m && r.pitch_type === t));
      const y = rr.map((r) => (r ? val(r) : null));
      const t0 = { x: D.months, y, name: t, type: "scatter", mode: "lines+markers", connectgaps: false, line: { color: PAL[t], width: 2.5 }, marker: { size: 7, color: PAL[t] },
        customdata: rr.map((r) => (r ? (MET === "whiff" ? `${r.sw} swings` : `n=${r.n}`) : "")), hovertemplate: `${t} %{y}${MET === "velo" ? " mph" : ""} · %{customdata}<extra></extra>` };
      if (MET === "velo") t0.error_y = { type: "data", array: rr.map((r) => (r && r.n >= 10 && r.velo_sd != null ? (1.96 * r.velo_sd) / Math.sqrt(r.n) : null)), color: PAL[t], thickness: 1, width: 3 };
      if (MET === "whiff") t0.error_y = wilsonErr(y.map((v) => v || 0), rr.map((r) => (r ? r.sw : 0)));
      if (MET === "whiff" || MET === "usage") t0.hovertemplate = `${t} %{y:.1%} · %{customdata}<extra></extra>`;
      return t0;
    });
    const ttl = { velo: "Velocity by month (mph)", stuff: "Stuff+ by month", whiff: "Whiff / swing by month (50+ swings)", usage: "Usage by month" }[MET];
    // gold callout: the largest first-to-last change among pitch types that have both ends plotted
    const ch = tr.map((t) => { const pts = t.y.map((v, i) => [i, v]).filter((p) => p[1] != null); return pts.length > 1 ? { t: t.name, a: pts[0], b: pts[pts.length - 1] } : null; }).filter(Boolean)
      .sort((u, v) => Math.abs(v.b[1] - v.a[1]) - Math.abs(u.b[1] - u.a[1]))[0];
    const f = (v) => (MET === "whiff" || MET === "usage" ? pct(v, 1) : fmt(v, 1));
    const ann = ch ? [callout(0, 0, `Biggest move: his ${ch.t}, ${f(ch.a[1])} in ${D.months[ch.a[0]]} → ${f(ch.b[1])} in ${D.months[ch.b[0]]}.`)] : [];
    Plotly.react("p_chart", tr, LAYOUT({ title: { text: `${nice(P.name)} · ${ttl}`, font: { size: 14 } }, margin: { l: 56, r: 50, t: 40, b: 48 }, xaxis: { type: "category" },
      yaxis: MET === "whiff" || MET === "usage" ? { tickformat: ".0%" } : {}, annotations: ann.concat(endLabels(tr.map((t) => { const i = t.y.map((v, j) => (v != null ? j : -1)).filter((j) => j >= 0).pop(); return i == null ? {} : { x: [t.x[i]], y: [t.y[i]], name: t.name, line: t.line }; }))) }), CFG);
    $("p_cap").textContent = `${nice(P.name)} (${P.throws}HP), ${nFmt(P.n)} pitches for ${CUR_TEAM}. Pitches by month: ${D.months.map((m) => `${m} ${mtot[m] || 0}`).join(", ")}.`;
    const cellv = (r) => { if (!r) return '<td class="muted">–</td>'; const v = val(r); return `<td>${v == null ? '<span class="muted">–</span>' : f(v)} <span class="muted" style="font-size:.78em">${MET === "whiff" ? r.sw + " sw" : "n " + r.n}</span></td>`; };
    $("p_tbl").innerHTML = `<thead><tr><th>Pitch</th>${D.months.map((m) => `<th>${m}</th>`).join("")}</tr></thead><tbody>` +
      types.map((t) => `<tr><td><span style="color:${PAL[t]}">●</span> ${t}</td>${D.months.map((m) => cellv(R.find((r) => r.m === m && r.pitch_type === t))).join("")}</tr>`).join("") + "</tbody>";
  }
  function draw() { kpis(); rateChart("s_whiff", "whiff", "wh", "sw", "Staff whiff / swing by month", "c_whiff"); veloChart(); cswChart(); stuffChart(); mixChart(); pitcher(); }
  function load() {
    const r = ++REQ;
    return getJSON(`data/t/${CUR_TEAM}/season.json`).then((d) => { if (r !== REQ) return; D = d;
      const want = new URLSearchParams(location.search).get("sp");
      PI = Math.max(0, D.pitchers.findIndex((p) => String(p.id) === want));
      $("spick").innerHTML = D.pitchers.map((p, i) => `<option value="${i}">${nice(p.name)} (${p.throws}HP, ${nFmt(p.n)})</option>`).join("");
      $("spick").value = PI; draw(); });
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("spick").onchange = (e) => { PI = +e.target.value; pitcher(); };
    $("smet").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { MET = b.dataset.m; $("smet").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); pitcher(); }));
    teamsReady.then(load); document.addEventListener("teamchange", load);
  });
})();
