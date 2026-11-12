// Sequencing page: model grid + empirical cells from R/06_sequencing.R (site/data/sequencing.json)
(function () {
  const $ = (id) => document.getElementById(id);
  let S, st = { pt: "FF", loc: "Zone up", res: "Called strike", count: "0-1", m: 0 };
  const MET = ["CSW", "Whiff / swing", "xRV / 100"];
  const LOCN = { "Zone up": "up in the zone", "Zone down": "low in the zone", "Out above": "above the zone", "Out below": "below the zone", "Out side": "off the plate" };
  const RESN = { Ball: "taken for a ball", "Called strike": "taken for a strike", Whiff: "swung through", Foul: "fouled off" };
  const ciTxt = (k, n) => { const [a, b] = wilson(k, n); return `${Math.round(100 * a)}–${Math.round(100 * b)}%`; };
  const vfmt = (v) => (st.m === 2 ? sgn(v, 2) : pct(v, 1));
  function pills(id, vals, key, lab = (v) => v) {
    $(id).innerHTML = vals.map((v) => `<button data-v="${v}">${lab(v)}</button>`).join("");
    $(id).querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { st[key] = b.dataset.v; fixCount(); draw(); }));
  }
  const validCounts = () => {
    const out = [];
    for (let b = 0; b <= 3; b++) for (let s = 0; s <= 2; s++) {
      if (!b && !s) continue; if (st.res === "Ball" && !b) continue; if (st.res !== "Ball" && !s) continue; out.push(`${b}-${s}`);
    }
    return out;
  };
  function fixCount() {
    const cs = validCounts(); if (!cs.includes(st.count)) st.count = cs[0];
    $("qcount").innerHTML = cs.map((c) => `<option${c === st.count ? " selected" : ""}>${c}</option>`).join("");
  }
  function cell(src, key, t) { const c = (src[key] || {})[t]; return c ? { n: c[0], csw: c[1], sw: c[2], wh: c[3], rv: c[4] } : null; }
  function empTxt(c, who, minN) {
    if (!c) return `<span class="muted">${who}: no pitches</span>`;
    if (st.m === 0) return c.n >= minN ? `${who} ${pct(c.csw / c.n, 1)} <span class="muted">(${ciTxt(c.csw, c.n)}, n=${nFmt(c.n)})</span>` : `<span class="muted">${who}: n=${c.n} pitches, too few to quote</span>`;
    if (st.m === 1) return c.sw >= MIN_SWINGS ? `${who} ${pct(c.wh / c.sw, 1)} <span class="muted">(${ciTxt(c.wh, c.sw)}, ${nFmt(c.sw)} swings)</span>` : `<span class="muted">${who}: ${c.sw} swings, too few to quote</span>`;
    return `${who} ${sgn(c.rv / c.n, 2)} <span class="muted">(n=${nFmt(c.n)})</span>`;
  }
  function draw() {
    ["qpt", "qloc", "qres"].forEach((id, i) => $(id).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === st[["pt", "loc", "res"][i]])));
    $("qmet").querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.m === st.m));
    const key = `${st.pt}|${st.loc}|${st.res}|${st.count}`, ekey = `${st.pt}|${st.loc}|${st.res}`;
    const g = S.grid[key], b0 = S.base_grid[st.count];
    if (!g) { $("qbars").innerHTML = '<p class="muted">No estimate for this combination.</p>'; return; }
    const vals = g[st.m], base = b0[st.m];
    const lo = st.m === 2 ? Math.min(0, ...vals, ...base) : 0, hi = Math.max(...vals, ...base) * 1.08 + (st.m === 2 ? 0.1 : 0);
    const X = (v) => (100 * (v - lo)) / (hi - lo);
    const order = S.types.map((t, i) => i).sort((a, b) => vals[b] - vals[a]);
    $("qbars").innerHTML = order.map((i) => {
      const t = S.types[i], v = vals[i], bv = base[i], d = v - bv;
      return `<div class="qrow"><div class="qlab"><span style="color:${PAL[t]}">●</span> <b>${t}</b> <span class="muted">${NAMES[t] || ""}</span></div>
        <div class="qbar"><div class="qfill" style="left:${X(Math.min(0, v))}%;width:${Math.abs(X(v) - X(0))}%;background:${PAL[t]}"></div>
          <div class="qbase" style="left:${X(bv)}%" title="no-sequence baseline ${vfmt(bv)}"></div></div>
        <div class="qval mono">${vfmt(v)} <span class="muted" style="font-size:.8em">${st.m === 2 ? sgn(d, 2) : sgn(100 * d, 1) + " pts"} vs base</span></div>
        <div class="qemp">${empTxt(cell(S.league, ekey, t), "League", 50)} · ${empTxt(cell(S.royals, ekey, t), "Royals", 50)}</div></div>`;
    }).join("");
    const best = order[0], diffs = S.types.map((t, i) => vals[i] - base[i]), mx = diffs.indexOf(Math.max(...diffs)), mn = diffs.indexOf(Math.min(...diffs));
    const u = (x) => (st.m === 2 ? `${sgn(x, 2)} runs/100` : `${sgn(100 * x, 1)} pts`);
    $("qcall").innerHTML = `After a ${NAMES[st.pt] || st.pt} ${LOCN[st.loc]}, ${RESN[st.res]} (${st.count} now), the model's best next pitch for ${MET[st.m]} is the <b>${NAMES[S.types[best]]}</b> (${vfmt(vals[best])}). Compared with ignoring the previous pitch, the ${S.types[mx]} gains the most (${u(diffs[mx])}) and the ${S.types[mn]} loses the most (${u(diffs[mn])}). These are league-wide model estimates.`;
  }
  function valTable() {
    const V = S.validation, nm = { csw: "CSW (per pitch)", whiff: "Whiff (per swing)", rv: "xRV (per pitch)" };
    $("qval").innerHTML = `<thead><tr><th>Outcome</th><th>Held-out n</th><th>Metric</th><th>No-sequence</th><th>Sequence</th><th>Lift (95% CI)</th><th>AUC / R²</th></tr></thead><tbody>` +
      V.map((v) => `<tr><td>${nm[v.outcome]}</td><td>${nFmt(v.n_test)}</td><td>${v.metric}</td><td>${v.base.toFixed(v.metric === "MSE" ? 5 : 4)}</td><td>${v.seq.toFixed(v.metric === "MSE" ? 5 : 4)}</td>
        <td><b>${v.lift_pct.toFixed(2)}%</b> <span class="muted">(${v.lift_ci[0].toFixed(2)}–${v.lift_ci[1].toFixed(2)})</span></td>
        <td>${v.auc_base != null ? `${v.auc_base.toFixed(3)} → ${v.auc_seq.toFixed(3)}` : `${(100 * v.r2_base).toFixed(2)}% → ${(100 * v.r2_seq).toFixed(2)}%`}</td></tr>`).join("") + "</tbody>";
    const w = V.find((v) => v.outcome === "whiff");
    $("qvalcap").innerHTML = `Trained on ${nFmt(w.n_train)} swings / ${nFmt(V[0].n_train)} pitches through ${S.split_date}, tested on later games. Lift = % reduction in held-out loss. All three lifts are above zero, with intervals that exclude zero, but they are <b>small</b>. The previous pitch adds a little information beyond the count and the pitch type, not a lot. Most of what decides a pitch's outcome (its location, its shape, the hitter) is not in either model.`;
    return w;
  }
  function royals() {
    const F = S.findings, NM = (t) => NAMES[t] || t;
    $("qroy").innerHTML = F.leads.map((L) => `<div class="card"><div class="eyebrow">${NM(L.prev)} → ${NM(L.next_pt)}</div>
      <p style="margin:.3em 0">Royals ${NM(L.next_pt).toLowerCase()}s thrown right after a ${NM(L.prev).toLowerCase()}: <b>${pct(L.whiff, 1)}</b> whiffs per swing
      <span class="muted">(95% CI ${pct(L.whiff_ci[0], 1)}–${pct(L.whiff_ci[1], 1)}, ${L.swings} swings, ${L.pitchers} pitchers)</span>, vs ${pct(L.other_whiff, 1)}
      <span class="muted">(${pct(L.other_ci[0], 1)}–${pct(L.other_ci[1], 1)}, ${nFmt(L.other_swings)} swings)</span> after any other pitch.</p>
      <p class="muted" style="margin:0">After adjusting for count, location context, hands and each pitcher's own ${NM(L.next_pt).toLowerCase()} baseline: <b style="color:var(--bad)">${sgn(100 * L.adj, 1)} pts</b> (95% CI ${sgn(100 * L.adj_ci[0], 1)} to ${sgn(100 * L.adj_ci[1], 1)}).</p></div>`).join("");
    $("qroycap").innerHTML = `Honest caveat: we scanned ${F.n_pairs} Royals previous→next pitch pairs (200+ pitches each) on two outcomes, ${F.n_tests} tests in all. ${F.n_sig} cleared p &lt; .05, and about ${F.expected_by_chance.toFixed(1)} would by chance alone. Treat these as leads to check on video and in next season's data, not as proven effects. Both point the same way: after a sinker, the Royals' next fastball gets fewer whiffs than expected.`;
  }
  document.addEventListener("DOMContentLoaded", () => getJSON("data/sequencing.json").then((s) => {
    S = s; $("qsplit").textContent = S.split_date;
    pills("qpt", S.types, "pt"); pills("qloc", S.locs, "loc"); pills("qres", S.results, "res");
    $("qcount").addEventListener("change", (e) => { st.count = e.target.value; draw(); });
    $("qmet").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { st.m = +b.dataset.m; draw(); }));
    valTable(); royals(); fixCount(); draw();
  }));
})();
