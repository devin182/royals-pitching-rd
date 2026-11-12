// Pitch Design Lab: evaluates the exported xgboost Stuff+ trees (assets/xgb.js) on a Royals pitcher's real pitches
// after applying slider shifts. Data from R/05_design_lab.R (site/data/lab/).
(function () {
  const $ = (id) => document.getElementById(id);
  const SL = [ // key, label, unit, min, max, step, feature, scale(slider->feature units), decimals for absolute value
    { k: "velo", lab: "Velocity", u: "mph", min: -5, max: 5, step: 0.1, f: "release_speed", s: 1, d: 1, diff: "velo_diff" },
    { k: "spin", lab: "Spin rate", u: "rpm", min: -500, max: 500, step: 10, f: "release_spin_rate", s: 1, d: 0 },
    { k: "ivb", lab: "Induced vertical break", u: "in", min: -8, max: 8, step: 0.1, f: "ivb", s: 1, d: 1, diff: "ivb_diff" },
    { k: "hb", lab: "Horizontal break (arm side +)", u: "in", min: -8, max: 8, step: 0.1, f: "hb_arm", s: 1, d: 1, diff: "hb_diff" },
    { k: "rz", lab: "Release height", u: "in", min: -12, max: 12, step: 0.5, f: "release_pos_z", s: 1 / 12, d: 2, fu: "ft" },
    { k: "rx", lab: "Release side (arm side +)", u: "in", min: -12, max: 12, step: 0.5, f: "rel_side_arm", s: 1 / 12, d: 2, fu: "ft" },
    { k: "ext", lab: "Extension", u: "in", min: -12, max: 12, step: 0.5, f: "release_extension", s: 1 / 12, d: 2, fu: "ft" },
  ];
  const COMP_F = ["release_speed", "ivb", "hb_arm", "release_spin_rate", "release_pos_z", "rel_side_arm", "release_extension"];
  let M, IDX, COMPS, CUR, ROWS, FI, base = {}, delta = {};
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const fi = (f) => M.features.indexOf(f);

  function sliderUI() {
    $("sliders").innerHTML = SL.map((s) => `<div class="sl" id="w_${s.k}"><div class="sl-top"><span>${s.lab}</span>
      <span class="mono"><b id="a_${s.k}"></b> <span class="muted" id="v_${s.k}"></span></span></div>
      <input type="range" id="r_${s.k}" min="${s.min}" max="${s.max}" step="${s.step}" value="0" aria-label="${s.lab} change">
      <div class="sl-flag" id="f_${s.k}"></div></div>`).join("");
    SL.forEach((s) => $("r_" + s.k).addEventListener("input", (e) => { delta[s.k] = +e.target.value; update(); }));
  }
  function resetSliders() { SL.forEach((s) => { delta[s.k] = 0; $("r_" + s.k).value = 0; }); }

  // adjusted feature matrix (rows x features) for current deltas
  function adjusted() {
    const n = ROWS[0].length, out = [];
    for (let i = 0; i < n; i++) {
      const x = ROWS.map((c) => c[i]);
      for (const s of SL) {
        const dv = delta[s.k] * s.s;
        if (!dv) continue;
        const j = fi(s.f); if (x[j] != null) x[j] += dv;
        if (s.diff && !CUR.primary_fb) { const q = fi(s.diff); if (x[q] != null) x[q] += dv; }
      }
      out.push(x);
    }
    return out;
  }
  function boot(preds, B = 400) { // bootstrap 95% interval of the Stuff+ mean over the sampled pitches
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = preds.length, st = [];
    for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += preds[(rnd() * n) | 0]; st.push(XGB.stuffPlus(s / n, M.mu, M.sd)); }
    st.sort((a, b) => a - b);
    return [st[Math.floor(0.025 * B)], st[Math.ceil(0.975 * B) - 1]];
  }
  function score(X) { const g = M.groups[CUR.group]; return X.map((x) => XGB.predictOne(g, x)); }

  function flags(X) {
    const R = M.ranges[CUR.group], bad = [];
    M.features.forEach((f, j) => {
      const [lo, hi] = R[f], v = X.map((x) => x[j]).filter((z) => z != null);
      if (!v.length) return;
      const m = mean(v), share = v.filter((z) => z < lo || z > hi).length / v.length;
      if (m < lo || m > hi || share > 0.5) bad.push({ f, m, lo, hi, share });
    });
    return bad;
  }
  const FNAME = { release_speed: "velocity", ivb: "IVB", hb_arm: "HB", release_spin_rate: "spin", spin_axis_arm: "spin axis",
    release_extension: "extension", release_pos_z: "release height", rel_side_arm: "release side", arm_angle: "arm angle",
    velo_diff: "velo gap to primary FB", ivb_diff: "IVB gap to primary FB", hb_diff: "HB gap to primary FB" };

  function update() {
    const X = adjusted(), p = score(X), pm = mean(p);
    const s1 = XGB.stuffPlus(pm, M.mu, M.sd), ci = boot(p), d = s1 - base.s0;
    $("s0").textContent = base.s0; $("s1").textContent = s1;
    $("s1ci").textContent = `95% interval ${ci[0]}–${ci[1]} · n = ${p.length} pitches`;
    $("sd").textContent = (d > 0 ? "+" : "") + d; $("sd").style.color = d > 0 ? "var(--good)" : d < 0 ? "var(--bad)" : "inherit";
    const bad = flags(X), badF = new Set(bad.map((b) => b.f));
    for (const s of SL) {
      const j = fi(s.f), m = mean(X.map((x) => x[j]).filter((z) => z != null));
      const dd = delta[s.k];
      $("a_" + s.k).textContent = `${m.toFixed(s.d)} ${s.fu || s.u}`;
      $("v_" + s.k).textContent = dd ? `(${dd > 0 ? "+" : ""}${dd}${s.u === "in" && s.fu ? " in" : ""})` : "";
      const off = badF.has(s.f) || (s.diff && badF.has(s.diff));
      $("f_" + s.k).innerHTML = off ? '<span class="oor-chip">outside training data</span>' : "";
      $("w_" + s.k).classList.toggle("off", off);
      // training band (1st-99th pct of the pitch group) drawn on the slider track, in slider units
      const [lo, hi] = M.ranges[CUR.group][s.f], m0 = base.means[s.f], span = s.max - s.min;
      const a = Math.max(0, Math.min(100, (100 * ((lo - m0) / s.s - s.min)) / span)), b = Math.max(0, Math.min(100, (100 * ((hi - m0) / s.s - s.min)) / span));
      $("r_" + s.k).style.background = `linear-gradient(90deg,#3a2430 0 ${a}%,#2b4f78 ${a}% ${b}%,#3a2430 ${b}% 100%)`;
    }
    $("oor").innerHTML = bad.length ? `<div class="oor-box"><b>Outside the training data:</b> ${bad.map((b) =>
      `${FNAME[b.f]} (avg ${b.m.toFixed(1)}; MLB 1st–99th pct ${b.lo.toFixed(1)} to ${b.hi.toFixed(1)}${b.share > 0 ? `; ${Math.round(100 * b.share)}% of his pitches outside` : ""})`).join("; ")}. Treat this grade as an extrapolation.</div>` : "";
    const moved = SL.filter((s) => delta[s.k]).map((s) => `${delta[s.k] > 0 ? "+" : ""}${delta[s.k]} ${s.u} ${s.lab.split(" (")[0].toLowerCase()}`);
    const nm = CUR.name.split(", ").reverse().join(" "), pt = NAMES[CUR.pitch_type] || CUR.pitch_type;
    $("lcall").innerHTML = moved.length
      ? `${moved.join(", ")} moves ${nm}'s ${pt} from ${base.s0} to <b>${s1}</b> Stuff+ (model estimate, 95% interval ${ci[0]}–${ci[1]}${bad.length ? ", outside training data" : ""}).`
      : `${nm}'s ${pt}: ${base.s0} Stuff+ in the browser model (published ${CUR.stuff_pub}, n = ${CUR.n} pitches). Move a slider to test a change.`;
    comps(X);
  }

  function comps(X) {
    const C = COMPS, t = CUR.pitch_type, ix = [];
    for (let i = 0; i < C.pitcher.length; i++) if (C.pitch_type[i] === t && C.pitcher[i] !== CUR.pitcher) ix.push(i);
    const sd = {}, target = {};
    COMP_F.forEach((f) => {
      const v = ix.map((i) => C[f][i]).filter((z) => z != null), m = mean(v);
      sd[f] = Math.sqrt(mean(v.map((z) => (z - m) ** 2))) || 1;
      const j = fi(f); target[f] = mean(X.map((x) => x[j]).filter((z) => z != null));
    });
    const dist = (i) => Math.sqrt(COMP_F.reduce((s, f) => s + (C[f][i] == null ? 0 : ((C[f][i] - target[f]) / sd[f]) ** 2), 0));
    const near = ix.map((i) => [i, dist(i)]).sort((a, b) => a[1] - b[1]).slice(0, 6);
    $("comps").innerHTML = `<thead><tr><th>Pitcher</th><th>T</th><th>#</th><th>Velo</th><th>IVB</th><th>HB</th><th>Spin</th><th>Ext</th><th>Stuff+</th></tr></thead><tbody>` +
      near.map(([i]) => `<tr><td>${C.name[i]}${C.kc[i] ? ' <span class="muted">(KC)</span>' : ""}</td><td>${C.throws[i]}</td><td>${C.n[i]}</td><td>${fmt(C.release_speed[i])}</td>
      <td>${fmt(C.ivb[i])}</td><td>${fmt(C.hb_arm[i])}</td><td>${fmt(C.release_spin_rate[i], 0)}</td><td>${fmt(C.release_extension[i])}</td>
      <td><span class="sp" style="background:${stuffColor(C.stuff[i])}">${C.stuff[i]}</span></td></tr>`).join("") + "</tbody>";
    // movement map (SVG): HB arm side on x, IVB on y
    const W = 520, H = 300, P = 34, xs = ix.map((i) => C.hb_arm[i]).concat([base.hb, target.hb_arm]), ys = ix.map((i) => C.ivb[i]).concat([base.ivb, target.ivb]);
    const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
    const X_ = (v) => P + ((v - x0) / (x1 - x0)) * (W - P - 10), Y_ = (v) => H - P + 6 - ((v - y0) / (y1 - y0)) * (H - P - 6);
    const nearSet = new Set(near.map((n) => n[0]));
    const tick = (a, b) => { const st = (b - a) > 30 ? 10 : 5, o = []; for (let v = Math.ceil(a / st) * st; v <= b; v += st) o.push(v); return o; };
    const col = PAL[t];
    $("lmap").innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="labmap" role="img" aria-label="Movement map of MLB ${t} pitch types">
      ${tick(x0, x1).map((v) => `<line x1="${X_(v)}" x2="${X_(v)}" y1="6" y2="${H - P + 6}" class="gl"/><text x="${X_(v)}" y="${H - P + 20}" class="tk" text-anchor="middle">${v}</text>`).join("")}
      ${tick(y0, y1).map((v) => `<line x1="${P}" x2="${W - 10}" y1="${Y_(v)}" y2="${Y_(v)}" class="gl"/><text x="${P - 6}" y="${Y_(v) + 4}" class="tk" text-anchor="end">${v}</text>`).join("")}
      <text x="${(W + P) / 2}" y="${H - 2}" class="tk" text-anchor="middle">Horizontal break, arm side + (in)</text>
      ${ix.filter((i) => !nearSet.has(i)).map((i) => `<circle cx="${X_(C.hb_arm[i])}" cy="${Y_(C.ivb[i])}" r="2.6" fill="#5b6b7f" opacity=".55"/>`).join("")}
      ${near.map(([i]) => `<circle cx="${X_(C.hb_arm[i])}" cy="${Y_(C.ivb[i])}" r="5" fill="#7AB2DD"><title>${C.name[i]} · Stuff+ ${C.stuff[i]}</title></circle>`).join("")}
      <circle cx="${X_(base.hb)}" cy="${Y_(base.ivb)}" r="8" fill="none" stroke="#C9A227" stroke-width="2.4"/>
      <circle cx="${X_(target.hb_arm)}" cy="${Y_(target.ivb)}" r="6.5" fill="#C9A227" stroke="${col}" stroke-width="2"/>
      <text x="${P + 4}" y="16" class="tk">IVB (in)</text></svg>`;
  }

  function pickPitch(row) {
    CUR = row;
    document.querySelectorAll("#lpitch button").forEach((b) => b.classList.toggle("on", b.dataset.t === row.pitch_type));
    getJSON(`data/lab/p/${row.pitcher}_${row.pitch_type}.json`).then((f) => {
      ROWS = f.rows; resetSliders();
      const p = score(adjusted());
      base = { s0: XGB.stuffPlus(mean(p), M.mu, M.sd), hb: mean(ROWS[fi("hb_arm")]), ivb: mean(ROWS[fi("ivb")]), means: {} };
      SL.forEach((s) => { base.means[s.f] = mean(ROWS[fi(s.f)].filter((z) => z != null)); });
      $("lnote").innerHTML = `Model grade for ${row.name.split(", ").reverse().join(" ")}'s ${NAMES[row.pitch_type] || row.pitch_type} on ${p.length} sampled pitches (of ${row.n}). Published Stuff+: <b>${row.stuff_pub}</b>.${row.primary_fb ? " This is his primary fastball, so off-speed gaps stay fixed." : ""}`;
      update();
    });
  }
  function pickPitcher(id) {
    const rows = IDX.filter((r) => r.pitcher === +id).sort((a, b) => b.n - a.n);
    $("lpitch").innerHTML = rows.map((r) => `<button data-t="${r.pitch_type}"><span style="color:${PAL[r.pitch_type]}">●</span> ${r.pitch_type}</button>`).join("");
    $("lpitch").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => pickPitch(rows.find((r) => r.pitch_type === b.dataset.t))));
    const want = new URLSearchParams(location.search).get("pitch");
    pickPitch(rows.find((r) => r.pitch_type === want) || rows[0]);
  }
  document.addEventListener("DOMContentLoaded", () => {
    Promise.all(["model", "royals", "comps"].map((n) => getJSON(`data/lab/${n}.json`))).then(([m, idx, c]) => {
      M = m; IDX = idx; COMPS = c;
      const a = M.agreement_with_published;
      $("agree").textContent = `across ${a.n_types} MLB pitch types with 100+ pitches, correlation ${a.cor.toFixed(3)}, ${Math.round(100 * a.share_within_1)}% within 1 point, mean gap ${a.mean_abs_diff.toFixed(1)} points`;
      const ps = [...new Map(IDX.map((r) => [r.pitcher, r.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
      $("lpick").innerHTML = ps.map(([id, n]) => `<option value="${id}">${n}</option>`).join("");
      const want = new URLSearchParams(location.search).get("p");
      $("lpick").value = want && ps.some((p) => String(p[0]) === want) ? want : String(ps.find((p) => p[1] === "Wacha, Michael")?.[0] || ps[0][0]);
      sliderUI();
      $("lpick").addEventListener("change", (e) => pickPitcher(e.target.value));
      $("lreset").addEventListener("click", () => { resetSliders(); update(); });
      pickPitcher($("lpick").value);
    });
  });
})();
