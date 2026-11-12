// Pitch tunnel viewer v2: broadcast-style 3D view of average 2026 Royals pitch paths.
// Statcast coordinates (ft): x = catcher's right (+ = 1B side), y = distance from the back tip of home plate, z = height.
const BG = 0x071428;
const MUTED = "#9AA3B5";
const PITCH_COLORS = window.PITCH_COLORS || {};
const BALL_R = 2.9 / 2 / 12; // regulation ball, 2.9 in diameter
const TAIL_S = 0.075; // comet tail length in seconds of flight

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);

const state = {
  data: null, pitcher: null, typeA: null, typeB: null,
  progress: 0, playing: false, speed: 0.25, showPaths: false, view: "catcher", zoom: 1, bigBall: false,
  webgl: false, lastTs: 0, hold: 0,
};
let three = null;

function hasWebGL() {
  if (q.has("fallback") || q.get("webgl") === "0") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
const fmtIn = (v) => `${v.toFixed(1)} in`;
const fmtMph = (v) => `${v.toFixed(1)} mph`;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (p, r, t) => [lerp(p[0], r[0], t), lerp(p[1], r[1], t), lerp(p[2], r[2], t)];
const distIn = (p, r) => Math.hypot(p[0] - r[0], p[2] - r[2]) * 12;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function colorOf(code) { return PITCH_COLORS[code] || MUTED; }
// Two pitches can share a family colour (rare); nudge B to powder so they never look identical.
function colA() { return colorOf(state.typeA); }
function colB() { const a = colA(), b = colorOf(state.typeB); return a === b ? "#7AB2DD" : b; }

function pointAt(pitch, tFromRelease) {
  const flight = pitch.t[2] - pitch.t[0];
  const u = clamp(tFromRelease / flight, 0, 1);
  const pts = pitch.pts;
  const x = u * (pts.length - 1);
  const i = Math.min(Math.floor(x), pts.length - 2);
  return lerp3(pts[i], pts[i + 1], x - i);
}
// Position of a pitch when it is at distance y from the plate (paths are monotone in y).
function pointAtY(pitch, y) {
  const pts = pitch.pts;
  if (y >= pts[0][1]) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][1] <= y) {
      const t = (pts[i - 1][1] - y) / (pts[i - 1][1] - pts[i][1]);
      return lerp3(pts[i - 1], pts[i], t);
    }
  }
  return pts[pts.length - 1];
}
function currentPair() {
  const p = state.pitcher;
  if (!p) return null;
  const a = p.pitches[state.typeA], b = p.pitches[state.typeB];
  if (!a || !b) return null;
  return { a, b, flightA: a.t[2] - a.t[0], flightB: b.t[2] - b.t[0] };
}
const longerFlight = (pair) => Math.max(pair.flightA, pair.flightB);
const pitchLabel = (code, pitch) => `${pitch.name} · ${pitch.velo.toFixed(1)} mph · ${pitch.n} pitches`;

function fillPitcherSelect() {
  const sel = $("pitcher");
  sel.innerHTML = "";
  for (const p of state.data.pitchers) {
    const opt = document.createElement("option");
    opt.value = String(p.id);
    opt.textContent = `${p.name} (${p.throws}HP, ${p.n.toLocaleString()} pitches)`;
    sel.appendChild(opt);
  }
}
function fillTypeSelects() {
  const p = state.pitcher;
  for (const id of ["pitchA", "pitchB"]) {
    const sel = $(id);
    const keep = id === "pitchA" ? state.typeA : state.typeB;
    sel.innerHTML = "";
    for (const [code, pitch] of Object.entries(p.pitches)) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = pitchLabel(code, pitch);
      sel.appendChild(opt);
    }
    if (keep && p.pitches[keep]) sel.value = keep;
  }
  state.typeA = $("pitchA").value;
  state.typeB = $("pitchB").value;
}
function defaultTypes(p) {
  const codes = Object.keys(p.pitches);
  const meta = state.data.meta;
  if (p.id === meta.default_pitcher && p.pitches[meta.default_a] && p.pitches[meta.default_b]) return [meta.default_a, meta.default_b];
  const preferB = ["SL", "ST", "CU", "KC", "SV", "CH", "FS", "FC", "SI"];
  const a = codes.includes("FF") ? "FF" : codes[0];
  const b = preferB.find((c) => c !== a && p.pitches[c]) || codes.find((c) => c !== a) || a;
  return [a, b];
}
function setPitcher(id) {
  const p = state.data.pitchers.find((x) => x.id === Number(id));
  if (!p) return;
  state.pitcher = p;
  [state.typeA, state.typeB] = defaultTypes(p);
  $("pitcher").value = String(p.id);
  fillTypeSelects();
  onPairChange();
}
function onPairChange() {
  const pair = currentPair();
  if (!pair) return;
  $("sepCommit").textContent = fmtIn(distIn(pair.a.commit, pair.b.commit));
  $("sepPlate").textContent = fmtIn(distIn(pair.a.plate, pair.b.plate));
  $("veloA").textContent = fmtMph(pair.a.velo);
  $("veloB").textContent = fmtMph(pair.b.velo);
  $("veloA").style.color = colA();
  $("veloB").style.color = colB();
  $("labA").textContent = `${pair.a.name} · ${pair.a.n} pitches`;
  $("labB").textContent = `${pair.b.name} · ${pair.b.n} pitches`;
  document.querySelector(".swatch.a").style.background = colA();
  document.querySelector(".swatch.b").style.background = colB();
  $("hudDotA").style.background = colA();
  $("hudDotB").style.background = colB();
  $("hudNameA").textContent = `${state.typeA} · ${pair.a.name}`;
  $("hudNameB").textContent = `${state.typeB} · ${pair.b.name}`;
  $("hudVeloA").textContent = fmtMph(pair.a.velo);
  $("hudVeloB").textContent = fmtMph(pair.b.velo);
  if (three) three.rebuild(pair);
  updateHud();
  drawFallback();
}

// HUD: live gap between the two pitches at the same distance from the plate (the lead ball's depth).
function updateHud() {
  const pair = currentPair();
  if (!pair) return;
  const meta = state.data.meta;
  const T = longerFlight(pair);
  const t = state.progress * T;
  const pa = pointAt(pair.a, t), pb = pointAt(pair.b, t);
  const lead = pa[1] < pb[1] ? pa : pb;
  const y = Math.max(lead[1], meta.plate_front_y_ft);
  const gap = distIn(pointAtY(pair.a, y), pointAtY(pair.b, y));
  $("hudGap").textContent = fmtIn(gap);
  const fromPlate = Math.max(0, y - meta.plate_front_y_ft);
  const lp = lead === pa ? pair.a : pair.b;
  const msLeft = Math.max(0, (lp.t[2] - lp.t[0] - Math.min(t, lp.t[2] - lp.t[0])) * 1000);
  $("hudMeta").textContent = `${fromPlate.toFixed(1)} ft from plate · ${msLeft.toFixed(0)} ms to arrive`;
  const nearCommit = Math.abs(fromPlate - meta.commit_from_plate_front_ft) < 3;
  $("hudCommit").classList.toggle("hit", nearCommit || (fromPlate < meta.commit_from_plate_front_ft && fromPlate > 0));
  $("clock").textContent = `${t.toFixed(3)} s · ${state.speed}×`;
  $("scrub").value = String(Math.round(state.progress * 1000));
}
function setProgress(u) {
  state.progress = clamp(u, 0, 1);
  updateHud();
  if (three) three.sync();
  drawFallback();
}
function setPlaying(on) {
  state.playing = on;
  state.lastTs = 0;
  $("playBtn").textContent = on ? "Pause" : "Play";
  $("playBtn").setAttribute("aria-label", on ? "Pause" : "Play");
}
function tick(ts) {
  if (state.playing) {
    const pair = currentPair();
    if (pair) {
      if (!state.lastTs) state.lastTs = ts;
      const dt = Math.min(0.1, (ts - state.lastTs) / 1000);
      state.lastTs = ts;
      const next = state.progress + (dt * state.speed) / longerFlight(pair);
      if (next >= 1) { setProgress(1); setPlaying(false); } else setProgress(next);
    }
  }
  if (three) three.frame(ts);
  requestAnimationFrame(tick);
}

/* ---------- 2D fallback (side + top) ---------- */
function stageSize(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

function drawPath(ctx, pts, map, color, width) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = map(p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawFallback() {
  if (state.webgl) return;
  const pair = currentPair();
  const side = $("cSide");
  const top = $("cTop");
  if (!pair || !side || !top) return;

  const meta = state.data.meta;
  const zoneTop = state.pitcher.sz_top;
  const zoneBot = state.pitcher.sz_bot;
  const T = longerFlight(pair);
  const t = state.progress * T;
  const posA = pointAt(pair.a, t);
  const posB = pointAt(pair.b, t);

  // Side view: x = statcast y (mound left, plate right), y = statcast z
  {
    const { w, h } = stageSize(side);
    const ctx = side.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    // Leave room at the bottom for the playback bar. Mound on the left, plate on the right.
    const padL = 28, padR = 22, padT = 28, padB = 58;
    const yMin = -0.5, yMax = 61, zMin = 0, zMax = 7.5;
    const sx = (w - padL - padR) / (yMax - yMin);
    const sz = (h - padT - padB) / (zMax - zMin);
    const ox = padL;
    const oz = padT;
    const map = (p) => [ox + (yMax - p[1]) * sx, oz + (zMax - p[2]) * sz];

    // ground
    ctx.fillStyle = "#071428";
    ctx.fillRect(0, 0, w, h);
    const g = map([0, yMin, 0]);
    const g2 = map([0, yMax, 0]);
    ctx.strokeStyle = "#1f3d66";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(g[0], g[1]); ctx.lineTo(g2[0], g2[1]); ctx.stroke();

    // commit line
    const c1 = map([0, meta.commit_y_ft, 0]);
    const c2 = map([0, meta.commit_y_ft, 7]);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "#c9a227";
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#c9a227";
    ctx.font = "10px 'IBM Plex Sans', sans-serif";
    ctx.fillText("commit 23.8 ft", c2[0] + 4, c2[1] + 10);

    // strike zone (side = vertical bar at plate front)
    const z1 = map([0, meta.plate_front_y_ft, zoneBot]);
    const z2 = map([0, meta.plate_front_y_ft, zoneTop]);
    ctx.strokeStyle = "#e8eef4";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(z1[0], z1[1]); ctx.lineTo(z2[0], z2[1]); ctx.stroke();

    drawPath(ctx, pair.a.pts, map, colA(), 2.2);
    drawPath(ctx, pair.b.pts, map, colB(), 2.2);
    for (const [pos, col] of [[posA, colA()], [posB, colB()]]) {
      const q = map(pos);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Top view: x = statcast x (3B left, 1B right), y = statcast y (plate bottom, mound top)
  {
    const { w, h } = stageSize(top);
    const ctx = top.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    // Bottom pad clears the playback bar. Horizontal scale is stretched so
    // a few feet of arm-side / glove-side movement is actually visible.
    const padL = 28, padR = 22, padT = 22, padB = 58;
    const xMin = -3.2, xMax = 3.2, yMin = -1, yMax = 61;
    const sx = (w - padL - padR) / (xMax - xMin);
    const sy = (h - padT - padB) / (yMax - yMin);
    const ox = padL;
    const oy = padT;
    const map = (p) => [ox + (p[0] - xMin) * sx, oy + (yMax - p[1]) * sy];

    ctx.fillStyle = "#071428";
    ctx.fillRect(0, 0, w, h);

    // midline
    const m1 = map([0, yMin, 0]), m2 = map([0, yMax, 0]);
    ctx.strokeStyle = "#1f3d66";
    ctx.beginPath(); ctx.moveTo(m1[0], m1[1]); ctx.lineTo(m2[0], m2[1]); ctx.stroke();

    // commit
    const c1 = map([-4, meta.commit_y_ft, 0]), c2 = map([4, meta.commit_y_ft, 0]);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "#c9a227";
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // plate (simple pentagon)
    const plate = [
      [0, 0, 0],
      [-8.5 / 12, 8.5 / 12, 0],
      [-8.5 / 12, 17 / 12, 0],
      [8.5 / 12, 17 / 12, 0],
      [8.5 / 12, 8.5 / 12, 0],
    ];
    ctx.beginPath();
    plate.forEach((p, i) => {
      const q = map(p);
      if (i === 0) ctx.moveTo(q[0], q[1]);
      else ctx.lineTo(q[0], q[1]);
    });
    ctx.closePath();
    ctx.fillStyle = "#e8eef4";
    ctx.fill();

    // zone width at plate front
    const zl = map([-8.5 / 12, meta.plate_front_y_ft, 0]);
    const zr = map([8.5 / 12, meta.plate_front_y_ft, 0]);
    ctx.strokeStyle = "#c5dcef";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(zl[0], zl[1]); ctx.lineTo(zr[0], zr[1]); ctx.stroke();

    drawPath(ctx, pair.a.pts, map, colA(), 2.2);
    drawPath(ctx, pair.b.pts, map, colB(), 2.2);
    for (const [pos, col] of [[posA, colA()], [posB, colB()]]) {
      const q = map(pos);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/* ---------- 3D view ---------- */
async function initThree() {
  const [THREE, controlsMod] = await Promise.all([import("three"), import("three/addons/controls/OrbitControls.js")]);
  const { OrbitControls } = controlsMod;
  const canvas = $("c3");
  const mobile = Math.min(window.innerWidth, window.innerHeight) < 720;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const to3 = (x, y, z) => new THREE.Vector3(x, z, -y);
  const V = (p) => to3(p[0], p[1], p[2]);

  // Backdrop: vertical navy gradient (stadium night sky) + matching fog for depth.
  {
    const c = document.createElement("canvas");
    c.width = 4; c.height = 256;
    const g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, "#030a17"); grd.addColorStop(0.55, "#0b1f3a"); grd.addColorStop(0.8, "#13305a"); grd.addColorStop(1, "#0b1f3a");
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    scene.fog = new THREE.Fog(0x0b1f3a, 70, 190);
  }

  // Soft lighting: sky/ground hemisphere, a warm key from above the first-base side, a cool rim from behind the mound.
  scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x0b1f3a, 1.25));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.6);
  key.position.set(18, 40, 10);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7ab2dd, 0.55);
  rim.position.set(-12, 14, -70);
  scene.add(rim);

  const std = (color, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });

  // Field: dark grass, infield dirt arc, home-plate dirt circle, mound with flat table, pitching rubber.
  const field = new THREE.Group();
  scene.add(field);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), std(0x0d2a2a, 1));
  grass.rotation.x = -Math.PI / 2;
  grass.position.copy(to3(0, 120, -0.01));
  field.add(grass);
  // mowing stripes (subtle)
  for (let i = -6; i <= 6; i += 2) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(8, 400), new THREE.MeshBasicMaterial({ color: 0x113333, transparent: true, opacity: 0.35, depthWrite: false }));
    s.rotation.x = -Math.PI / 2;
    s.position.copy(to3(i * 8, 120, -0.005));
    field.add(s);
  }
  const dirt = (r, x, y) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 64), std(0x3a2c22, 1));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(to3(x, y, 0));
    field.add(m);
  };
  dirt(13, 0, 0.7); // home plate circle (26 ft diameter)
  // Mound: 18 ft diameter, 10 in high, flat 5 x 3 ft table; centre 59 ft from the back of the plate.
  const moundH = 10 / 12;
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 9, moundH, 64, 1), std(0x47362a, 1));
  mound.position.copy(to3(0, 59, moundH / 2));
  field.add(mound);
  // Rubber: 24 x 6 in, front edge 60.5 ft from the back point of the plate.
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(2, 0.06, 0.5), std(0xf2f4f7, 0.5));
  rubber.position.copy(to3(0, 60.5 + 0.25, moundH + 0.03));
  field.add(rubber);
  // Home plate: 17 in front edge, 8.5 in sides, 12 in back edges meeting at the point (y = 0).
  const ps = new THREE.Shape();
  [[0, 0], [8.5, 8.5], [8.5, 17], [-8.5, 17], [-8.5, 8.5]].forEach(([x, y], i) => (i ? ps.lineTo(x / 12, y / 12) : ps.moveTo(x / 12, y / 12)));
  ps.closePath();
  const plate = new THREE.Mesh(new THREE.ShapeGeometry(ps), std(0xf5f7fa, 0.55));
  plate.rotation.x = -Math.PI / 2; // shape (x, y) -> world (x, -z) = statcast (x, y)
  plate.position.y = 0.012;
  field.add(plate);
  // Batter's boxes: 4 x 6 ft, 6 in off the plate, centred on the plate's mid-depth; chalk lines.
  const chalk = new THREE.LineBasicMaterial({ color: 0xe8eef4, transparent: true, opacity: 0.55 });
  for (const sgn of [-1, 1]) {
    const x0 = sgn * (8.5 / 12 + 0.5), x1 = sgn * (8.5 / 12 + 4.5), yc = 8.5 / 12, y0 = yc - 3, y1 = yc + 3;
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => to3(x, y, 0.015));
    field.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), chalk));
  }

  const dynamic = new THREE.Group();
  scene.add(dynamic);

  // Baseball texture: off-white leather with the two-lobed seam curve and red stitches (equirect for SphereGeometry UVs).
  function ballTexture() {
    const W = 512, H = 256;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#f3efe6"; g.fillRect(0, 0, W, H);
    const toUV = (X, Y, Z) => {
      const theta = Math.acos(clamp(Y, -1, 1));
      let phi = Math.atan2(Z, -X);
      if (phi < 0) phi += 2 * Math.PI;
      return [(phi / (2 * Math.PI)) * W, (theta / Math.PI) * H];
    };
    const b = 0.3, a = 1 - b, cz = 2 * Math.sqrt(a * b);
    const seam = (t, off) => {
      let X = a * Math.cos(t) + b * Math.cos(3 * t), Y = a * Math.sin(t) - b * Math.sin(3 * t), Z = cz * Math.sin(2 * t);
      // offset along the surface, perpendicular to the curve, for the two stitch rows
      const dX = -a * Math.sin(t) - 3 * b * Math.sin(3 * t), dY = a * Math.cos(t) - 3 * b * Math.cos(3 * t), dZ = 2 * cz * Math.cos(2 * t);
      let nX = Y * dZ - Z * dY, nY = Z * dX - X * dZ, nZ = X * dY - Y * dX;
      const nl = Math.hypot(nX, nY, nZ) || 1;
      X += (off * nX) / nl; Y += (off * nY) / nl; Z += (off * nZ) / nl;
      const l = Math.hypot(X, Y, Z);
      return toUV(X / l, Y / l, Z / l);
    };
    const N = 600;
    g.lineCap = "round";
    // seam groove
    g.strokeStyle = "rgba(150,120,100,.55)"; g.lineWidth = 2;
    g.beginPath();
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const [u, v] = seam((i / N) * 2 * Math.PI, 0);
      if (prev && Math.abs(u - prev[0]) < W / 2) g.lineTo(u, v); else g.moveTo(u, v);
      prev = [u, v];
    }
    g.stroke();
    // red stitches: short ticks between the two rows
    g.strokeStyle = "#c8102e"; g.lineWidth = 2.2;
    const S = 108;
    for (let i = 0; i < S; i++) {
      const t = (i / S) * 2 * Math.PI;
      const p1 = seam(t, -0.07), p2 = seam(t + 0.025, 0.07);
      if (Math.abs(p1[0] - p2[0]) > W / 2) continue;
      g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }
  const BALL_TEX = ballTexture();
  // Soft round sprite used for the ball halo and the ground shadow.
  function radialTexture(inner, outer) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, inner); grd.addColorStop(1, outer);
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  const SHADOW_TEX = radialTexture("rgba(0,0,0,0.55)", "rgba(0,0,0,0)");
  const HALO_TEX = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    g.strokeStyle = "#ffffff"; g.lineWidth = 6;
    g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
    return new THREE.CanvasTexture(c);
  })();

  function makeBall(color) {
    const grp = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20), new THREE.MeshStandardMaterial({ map: BALL_TEX, roughness: 0.55, metalness: 0 }));
    ball.renderOrder = 10;
    grp.add(ball);
    // Pitch-colour ring in screen space: identifies the pitch and keeps a distant ball findable. Drawn over everything.
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: HALO_TEX, color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    halo.scale.setScalar(0.024);
    halo.renderOrder = 12;
    grp.add(halo);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: SHADOW_TEX, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 1;
    return { grp, ball, halo, shadow };
  }

  // Comet tail: a thin ribbon over the last TAIL_S seconds, vertex colours fading to black under additive blending.
  const TAIL_N = 28;
  function makeTail(color) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TAIL_N * 2 * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TAIL_N * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < TAIL_N - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    return { mesh, col: new THREE.Color(color) };
  }
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3();
  function updateTail(tail, pitch, t, camera) {
    const pos = tail.mesh.geometry.attributes.position.array, col = tail.mesh.geometry.attributes.color.array;
    const flight = pitch.t[2] - pitch.t[0];
    const tEnd = Math.min(t, flight), tStart = Math.max(0, tEnd - TAIL_S);
    const halfW = 0.035; // ~0.8 in wide ribbon at the head, tapering to nothing
    for (let i = 0; i < TAIL_N; i++) {
      const f = i / (TAIL_N - 1);
      const tt = lerp(tStart, tEnd, f);
      const p = V(pointAt(pitch, tt));
      const pn = V(pointAt(pitch, Math.min(flight, tt + 0.004)));
      tmpA.subVectors(pn, p).normalize();
      toCam.subVectors(camera.position, p).normalize();
      side.crossVectors(tmpA, toCam).normalize().multiplyScalar(halfW * f);
      tmpB.copy(p).add(side); pos.set([tmpB.x, tmpB.y, tmpB.z], i * 6);
      tmpB.copy(p).sub(side); pos.set([tmpB.x, tmpB.y, tmpB.z], i * 6 + 3);
      const k = Math.pow(f, 1.6) * 0.85 * (tEnd > 0 ? 1 : 0);
      for (const o of [0, 3]) col.set([tail.col.r * k, tail.col.g * k, tail.col.b * k], i * 6 + o);
    }
    tail.mesh.geometry.attributes.position.needsUpdate = true;
    tail.mesh.geometry.attributes.color.needsUpdate = true;
  }

  function fullPath(pts, color) {
    const geo = new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(pts.map(V)).getPoints(120));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
    line.renderOrder = 4;
    return line;
  }

  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 3;
  controls.maxDistance = 140;
  controls.enablePan = true;
  // Zoom changes the lens (field of view), not the camera position, so the hitter's-eye viewpoint stays put.
  controls.enableZoom = false;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.PAN };

  // Camera presets [position, target, horizontal FOV deg], statcast coords.
  const VIEWS = {
    // hitter's-eye catcher view: crouched eye height (~3.3 ft) a few feet behind the plate, telephoto lens
    catcher: { pos: [0, -7, 3.3], tgt: [0, 30, 1.05], hfov: 28, vmin: 24 },
    batterR: { pos: [-2.9, 1.2, 5.6], tgt: [0, 40, 4.0], hfov: 40, vmin: 22 },
    batterL: { pos: [2.9, 1.2, 5.6], tgt: [0, 40, 4.0], hfov: 40, vmin: 22 },
    side: { pos: [34, 31, 4.5], tgt: [0, 31, 3.2], hfov: 76 },
    overhead: { pos: [0.01, 30, 78], tgt: [0, 30, 0], hfov: 62 },
  };
  let tween = null;
  let hfov = VIEWS.catcher.hfov, vmin = VIEWS.catcher.vmin || 0;
  function applyFov() {
    const r = canvas.getBoundingClientRect();
    const aspect = Math.max(r.width, 1) / Math.max(r.height, 1);
    camera.aspect = aspect;
    const h = (hfov * Math.PI) / 180;
    const f = Math.min(80, Math.max(vmin, (2 * Math.atan(Math.tan(h / 2) / Math.max(aspect, 0.35)) * 180) / Math.PI));
    camera.fov = (2 * Math.atan(Math.tan((f * Math.PI) / 360) / state.zoom) * 180) / Math.PI;
    camera.updateProjectionMatrix();
  }
  function setView(name, instant) {
    const v = VIEWS[name] || VIEWS.catcher;
    state.view = name;
    document.querySelectorAll(".cam").forEach((b) => b.classList.toggle("on", b.dataset.view === name));
    const to = { pos: V(v.pos), tgt: V(v.tgt), hfov: v.hfov, vmin: v.vmin || 0 };
    setZoom(1);
    if (instant) {
      camera.position.copy(to.pos); controls.target.copy(to.tgt); hfov = to.hfov; vmin = to.vmin;
      camera.up.set(0, 1, 0); applyFov(); controls.update();
      return;
    }
    tween = { t0: performance.now(), dur: 900, from: { pos: camera.position.clone(), tgt: controls.target.clone(), hfov, vmin }, to };
    controls.enabled = false;
  }

  function setZoom(z) {
    state.zoom = clamp(z, 1, 6);
    const zl = $("zoomLvl"); if (zl) zl.textContent = state.zoom.toFixed(1) + "×";
    applyFov();
  }
  renderer.domElement.addEventListener("wheel", (e) => { e.preventDefault(); setZoom(state.zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  let pinch = null; // two-finger pinch -> lens zoom
  const pdist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  renderer.domElement.addEventListener("touchstart", (e) => { if (e.touches.length === 2) pinch = { d: pdist(e.touches), z: state.zoom }; }, { passive: true });
  renderer.domElement.addEventListener("touchmove", (e) => { if (pinch && e.touches.length === 2) setZoom(pinch.z * pdist(e.touches) / pinch.d); }, { passive: true });
  renderer.domElement.addEventListener("touchend", (e) => { if (e.touches.length < 2) pinch = null; }, { passive: true });
  function setBig(on) { state.bigBall = on; if (objs) objs.balls.forEach((b) => b.ball.scale.setScalar(on ? 2.5 : 1)); }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const cur = renderer.getSize(new THREE.Vector2());
    if (cur.x !== w || cur.y !== h) renderer.setSize(w, h, false);
    applyFov();
  }

  let objs = null;
  function dispose(o) { o.traverse((c) => { c.geometry?.dispose?.(); if (c.material && !c.material.map) c.material.dispose?.(); }); }
  function rebuild(pair) {
    while (dynamic.children.length) { const o = dynamic.children[0]; dynamic.remove(o); dispose(o); }
    const p = state.pitcher, meta = state.data.meta;
    const cA = new THREE.Color(colA()), cB = new THREE.Color(colB());
    // Strike zone: clean thin frame at the front of the plate (pitcher's average zone top / bottom), faint fill.
    const hw = 8.5 / 12 + BALL_R, yz = meta.plate_front_y_ft;
    const zf = [[-hw, p.sz_bot], [hw, p.sz_bot], [hw, p.sz_top], [-hw, p.sz_top], [-hw, p.sz_bot]].map(([x, z]) => to3(x, yz, z));
    const zone = new THREE.Line(new THREE.BufferGeometry().setFromPoints(zf), new THREE.LineBasicMaterial({ color: 0xe8eef4, transparent: true, opacity: 0.9 }));
    zone.renderOrder = 3;
    dynamic.add(zone);
    const zfill = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, p.sz_top - p.sz_bot), new THREE.MeshBasicMaterial({ color: 0xe8eef4, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }));
    zfill.position.copy(to3(0, yz, (p.sz_top + p.sz_bot) / 2));
    dynamic.add(zfill);
    // Commit point: a faint gold frame across the lane plus a gold ring around each pitch where it crosses 23.8 ft.
    const cy = meta.commit_y_ft, W = 3.6, H = 6.4;
    const cf = [[-W / 2, 0], [W / 2, 0], [W / 2, H], [-W / 2, H], [-W / 2, 0]].map(([x, z]) => to3(x, cy, z));
    const cframe = new THREE.Line(new THREE.BufferGeometry().setFromPoints(cf), new THREE.LineBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.25 }));
    dynamic.add(cframe);
    const cplane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false }));
    cplane.position.copy(to3(0, cy, H / 2));
    dynamic.add(cplane);
    const rings = [pair.a.commit, pair.b.commit].map((c) => {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.27, 48), new THREE.MeshBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
      r.position.copy(V(c));
      dynamic.add(r);
      return r;
    });
    const paths = [fullPath(pair.a.pts, cA), fullPath(pair.b.pts, cB)];
    paths.forEach((l) => { l.visible = state.showPaths; dynamic.add(l); });
    const tails = [makeTail(cA), makeTail(cB)];
    tails.forEach((t) => dynamic.add(t.mesh));
    const balls = [makeBall(cA), makeBall(cB)];
    balls.forEach((b) => { dynamic.add(b.grp); dynamic.add(b.shadow); });
    objs = { pair, paths, tails, balls, rings, cplane, cframe };
    setBig(state.bigBall);
    sync();
  }
  function setPaths(on) { if (objs) objs.paths.forEach((l) => (l.visible = on)); }

  function sync() {
    if (!objs) return;
    const pair = currentPair();
    if (!pair) return;
    const T = longerFlight(pair);
    const t = state.progress * T;
    const meta = state.data.meta;
    [pair.a, pair.b].forEach((pitch, i) => {
      const p = pointAt(pitch, t);
      const b = objs.balls[i];
      b.grp.position.copy(V(p));
      // ground shadow: larger and softer the higher the ball
      const s = 0.32 + p[2] * 0.08;
      b.shadow.scale.set(s, s, 1);
      b.shadow.position.copy(to3(p[0], p[1], 0.02));
      b.shadow.material.opacity = clamp(1.1 - p[2] * 0.12, 0.25, 0.9);
      updateTail(objs.tails[i], pitch, t, camera);
      // commit ring brightens as the ball passes the commit point
      const d = Math.abs(p[1] - meta.commit_y_ft);
      objs.rings[i].material.opacity = d < 2.5 ? 1 : 0.4;
      objs.rings[i].lookAt(camera.position);
    });
    const lead = Math.min(pointAt(pair.a, t)[1], pointAt(pair.b, t)[1]);
    const near = Math.abs(lead - meta.commit_y_ft) < 2.5;
    objs.cframe.material.opacity = near ? 0.85 : 0.25;
    objs.cplane.material.opacity = near ? 0.09 : 0.035;
  }

  function frame(ts) {
    resize();
    if (tween) {
      const k = clamp((performance.now() - tween.t0) / tween.dur, 0, 1), e = ease(k);
      camera.position.lerpVectors(tween.from.pos, tween.to.pos, e);
      controls.target.lerpVectors(tween.from.tgt, tween.to.tgt, e);
      hfov = lerp(tween.from.hfov, tween.to.hfov, e);
      vmin = lerp(tween.from.vmin, tween.to.vmin, e);
      camera.up.set(0, 1, 0);
      camera.lookAt(controls.target);
      applyFov();
      if (k >= 1) { tween = null; controls.enabled = true; }
    }
    controls.update();
    sync();
    renderer.render(scene, camera);
  }

  window.addEventListener("resize", resize);
  resize();
  setView(VIEWS[q.get("view")] ? q.get("view") : "catcher", true);
  three = { rebuild, sync, frame, setView, setPaths, setZoom, setBig };
}

function bind() {
  $("pitcher").addEventListener("change", (e) => setPitcher(e.target.value));
  $("pitchA").addEventListener("change", (e) => { state.typeA = e.target.value; onPairChange(); });
  $("pitchB").addEventListener("change", (e) => { state.typeB = e.target.value; onPairChange(); });
  $("playBtn").addEventListener("click", () => {
    if (!state.playing && state.progress >= 1) setProgress(0);
    setPlaying(!state.playing);
  });
  $("scrub").addEventListener("input", (e) => { setPlaying(false); setProgress(Number(e.target.value) / 1000); });
  document.querySelectorAll(".spd").forEach((b) => b.addEventListener("click", () => {
    state.speed = Number(b.dataset.speed);
    document.querySelectorAll(".spd").forEach((x) => x.classList.toggle("on", x === b));
    updateHud();
  }));
  document.querySelectorAll(".cam").forEach((b) => b.addEventListener("click", () => { if (three) three.setView(b.dataset.view); }));
  $("zoomIn").addEventListener("click", () => three && three.setZoom(state.zoom * 1.25));
  $("zoomOut").addEventListener("click", () => three && three.setZoom(state.zoom / 1.25));
  $("zoomLvl").addEventListener("click", () => three && three.setZoom(1));
  $("bigBall").addEventListener("change", (e) => three && three.setBig(e.target.checked));
  $("showPaths").addEventListener("change", (e) => { state.showPaths = e.target.checked; if (three) three.setPaths(state.showPaths); });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !["SELECT", "INPUT", "BUTTON"].includes(e.target.tagName)) { e.preventDefault(); $("playBtn").click(); }
  });
  window.addEventListener("resize", () => { if (!state.webgl) drawFallback(); });
}

async function main() {
  bind();
  let data;
  try {
    const res = await fetch("tunnel.json?v=fbecce1532");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    $("stage").innerHTML = `<p class="err">Could not load tunnel.json (${err.message}).</p>`;
    return;
  }
  state.data = data;
  fillPitcherSelect();
  state.webgl = hasWebGL();
  if (state.webgl) {
    try { await initThree(); } catch (err) { console.warn("WebGL init failed, using 2D fallback", err); state.webgl = false; three = null; }
  }
  if (!state.webgl) {
    $("c3").style.display = "none";
    $("fallback").classList.add("show");
    document.querySelectorAll(".cam").forEach((b) => { b.disabled = true; b.title = "3D camera views need WebGL"; });
    $("showPaths").closest("label").style.display = "none";
    $("bigBall").closest("label").style.display = "none";
    document.querySelector(".zoom").style.display = "none";
    $("hud").style.display = "none";
  }
  if (q.get("speed")) { const b = document.querySelector(`.spd[data-speed="${q.get("speed")}"]`); if (b) b.click(); }
  if (q.get("big") === "1") { $("bigBall").checked = true; state.bigBall = true; }
  if (q.get("paths") === "1") { $("showPaths").checked = true; state.showPaths = true; }
  const pid = Number(q.get("p")) || data.meta.default_pitcher;
  setPitcher(data.pitchers.some((x) => x.id === pid) ? pid : data.meta.default_pitcher);
  if (three && state.showPaths) three.setPaths(true);
  // Start mid-flight so the first frame (and a still screenshot) shows both balls in the air.
  setProgress(q.has("t") ? Number(q.get("t")) : 0.55);
  if (q.get("play") === "1") setPlaying(true);
  requestAnimationFrame(tick);
}

main();
