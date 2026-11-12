const COLOR_A = 0x7ab2dd;
const COLOR_B = 0xc9a227;
const BG = 0x071428;
const SLOWMO = 8;

const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  pitcher: null,
  typeA: null,
  typeB: null,
  progress: 0, // 0–1 of the longer flight
  playing: false,
  orbit: false,
  webgl: false,
  lastTs: 0,
};

let three = null; // filled if WebGL is available

function hasWebGL() {
  const q = new URLSearchParams(location.search);
  if (q.has("fallback") || q.get("webgl") === "0") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

function fmtIn(v) {
  return `${v.toFixed(1)} in`;
}
function fmtMph(v) {
  return `${v.toFixed(1)} mph`;
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function lerp3(p, q, t) {
  return [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];
}
function distIn(p, q) {
  const dx = p[0] - q[0], dz = p[2] - q[2];
  return Math.sqrt(dx * dx + dz * dz) * 12;
}

function pointAt(pitch, tFromRelease) {
  const flight = pitch.t[2] - pitch.t[0];
  const u = clamp(tFromRelease / flight, 0, 1);
  const pts = pitch.pts;
  const x = u * (pts.length - 1);
  const i = Math.min(Math.floor(x), pts.length - 2);
  return lerp3(pts[i], pts[i + 1], x - i);
}

function currentPair() {
  const p = state.pitcher;
  if (!p) return null;
  const a = p.pitches[state.typeA];
  const b = p.pitches[state.typeB];
  if (!a || !b) return null;
  return { a, b, flightA: a.t[2] - a.t[0], flightB: b.t[2] - b.t[0] };
}

function longerFlight(pair) {
  return Math.max(pair.flightA, pair.flightB);
}

function pitchLabel(code, pitch) {
  return `${pitch.name} · ${pitch.velo.toFixed(1)} mph · ${pitch.n} pitches`;
}

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
  if (p.id === meta.default_pitcher && p.pitches[meta.default_a] && p.pitches[meta.default_b]) {
    return [meta.default_a, meta.default_b];
  }
  const preferB = ["SL", "ST", "CU", "KC", "SV", "CH", "FS", "FC", "SI"];
  const a = codes.includes("FF") ? "FF" : codes[0];
  const b = preferB.find((c) => c !== a && p.pitches[c]) || codes.find((c) => c !== a) || a;
  return [a, b];
}

function setPitcher(id) {
  const p = state.data.pitchers.find((x) => x.id === Number(id));
  if (!p) return;
  state.pitcher = p;
  const [a, b] = defaultTypes(p);
  state.typeA = a;
  state.typeB = b;
  $("pitcher").value = String(p.id);
  fillTypeSelects();
  onPairChange();
}

function onPairChange() {
  const pair = currentPair();
  if (!pair) return;
  const sepC = distIn(pair.a.commit, pair.b.commit);
  const sepP = distIn(pair.a.plate, pair.b.plate);
  $("sepCommit").textContent = fmtIn(sepC);
  $("sepPlate").textContent = fmtIn(sepP);
  $("veloA").textContent = fmtMph(pair.a.velo);
  $("veloB").textContent = fmtMph(pair.b.velo);
  $("labA").textContent = `${pair.a.name} · ${pair.a.n} pitches`;
  $("labB").textContent = `${pair.b.name} · ${pair.b.n} pitches`;
  updateClock();
  if (three) three.rebuild(pair);
  drawFallback();
}

function updateClock() {
  const pair = currentPair();
  if (!pair) return;
  const T = longerFlight(pair);
  const t = state.progress * T;
  $("clock").textContent = `${t.toFixed(2)} s · 8× slow motion`;
  $("scrub").value = String(Math.round(state.progress * 1000));
}

function setProgress(u) {
  state.progress = clamp(u, 0, 1);
  updateClock();
  if (three) three.sync();
  drawFallback();
}

function tick(ts) {
  if (state.playing) {
    const pair = currentPair();
    if (pair) {
      if (!state.lastTs) state.lastTs = ts;
      const dt = (ts - state.lastTs) / 1000;
      state.lastTs = ts;
      const T = longerFlight(pair);
      const next = state.progress + dt / (T * SLOWMO);
      if (next >= 1) {
        setProgress(1);
        state.playing = false;
        $("playBtn").textContent = "Play";
      } else {
        setProgress(next);
      }
    }
  } else {
    state.lastTs = 0;
  }
  if (three) three.frame();
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

    drawPath(ctx, pair.a.pts, map, "#7AB2DD", 2.2);
    drawPath(ctx, pair.b.pts, map, "#C9A227", 2.2);
    for (const [pos, col] of [[posA, "#7AB2DD"], [posB, "#C9A227"]]) {
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

    drawPath(ctx, pair.a.pts, map, "#7AB2DD", 2.2);
    drawPath(ctx, pair.b.pts, map, "#C9A227", 2.2);
    for (const [pos, col] of [[posA, "#7AB2DD"], [posB, "#C9A227"]]) {
      const q = map(pos);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/* ---------- 3D view ---------- */
async function initThree() {
  const [THREE, controlsMod] = await Promise.all([
    import("three"),
    import("three/addons/controls/OrbitControls.js"),
  ]);
  const { OrbitControls } = controlsMod;

  const canvas = $("c3");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(BG, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(20, 1, 0.2, 300);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 4;
  controls.maxDistance = 80;
  controls.enabled = false;

  const to3 = (x, y, z) => new THREE.Vector3(x, z, -y);

  scene.add(new THREE.AmbientLight(0xb8c8dc, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(12, 20, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7ab2dd, 0.25);
  fill.position.set(-10, 8, -6);
  scene.add(fill);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 40),
    new THREE.MeshStandardMaterial({ color: 0x123056, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.copy(to3(0, 30, 0));
  scene.add(ground);

  // Faint midline
  const mid = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([to3(0, -2, 0.01), to3(0, 66, 0.01)]),
    new THREE.LineBasicMaterial({ color: 0x1f3d66 })
  );
  scene.add(mid);

  // Mound + rubber
  const mound = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 9, 0.83, 48),
    new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1 })
  );
  mound.position.copy(to3(0, 59, 0.415));
  scene.add(mound);
  const rubber = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.06, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.6 })
  );
  rubber.position.copy(to3(0, 60.5, 0.86));
  scene.add(rubber);

  // Home plate pentagon
  const plateShape = new THREE.Shape();
  const pv = [
    [0, 0],
    [8.5 / 12, 8.5 / 12],
    [8.5 / 12, 17 / 12],
    [-8.5 / 12, 17 / 12],
    [-8.5 / 12, 8.5 / 12],
  ];
  plateShape.moveTo(pv[0][0], -pv[0][1]);
  for (let i = 1; i < pv.length; i++) plateShape.lineTo(pv[i][0], -pv[i][1]);
  plateShape.closePath();
  const plate = new THREE.Mesh(
    new THREE.ShapeGeometry(plateShape),
    new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = 0.02;
  scene.add(plate);

  const paths = new THREE.Group();
  const balls = new THREE.Group();
  const extras = new THREE.Group();
  scene.add(paths, balls, extras);

  // Telephoto catcher's-eye: back and slightly above the zone, narrow FOV so
  // the incoming paths, commit plane, and mound share the frame instead of
  // collapsing to a speck under a wide angle.
  const catcherPos = to3(0, -22, 5.1);
  const catcherTarget = to3(0, 18, 2.65);

  function setCatcherCam() {
    camera.position.copy(catcherPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(catcherTarget);
    controls.target.copy(catcherTarget);
    controls.update();
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Hold a ~30° horizontal FOV so a wide, short canvas zooms in on the
    // tunnel instead of leaving empty sky on both sides.
    const hfov = 30 * Math.PI / 180;
    camera.fov = (2 * Math.atan(Math.tan(hfov / 2) / Math.max(camera.aspect, 0.3))) * (180 / Math.PI);
    camera.updateProjectionMatrix();
  }

  function makeTube(pts, color) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => to3(p[0], p[1], p[2])));
    const geo = new THREE.TubeGeometry(curve, 80, 0.15, 10, false);
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.35, metalness: 0.1, emissive: color, emissiveIntensity: 0.35,
    });
    return new THREE.Mesh(geo, mat);
  }

  function makeBall(color) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 20, 16),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.05, emissive: color, emissiveIntensity: 0.15 })
    );
    return m;
  }

  function rebuild(pair) {
    while (paths.children.length) {
      const o = paths.children[0];
      paths.remove(o);
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    }
    while (balls.children.length) {
      const o = balls.children[0];
      balls.remove(o);
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    }
    while (extras.children.length) {
      const o = extras.children[0];
      extras.remove(o);
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    }

    const p = state.pitcher;
    const meta = state.data.meta;

    // Strike zone at plate front
    const hw = 8.5 / 12;
    const z0 = p.sz_bot, z1 = p.sz_top, yz = meta.plate_front_y_ft;
    const zc = [
      to3(-hw, yz, z0), to3(hw, yz, z0), to3(hw, yz, z1), to3(-hw, yz, z1), to3(-hw, yz, z0),
    ];
    extras.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(zc), new THREE.LineBasicMaterial({ color: 0xe8eef4 })));
    const zoneFill = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, z1 - z0),
      new THREE.MeshBasicMaterial({ color: 0xe8eef4, transparent: true, opacity: 0.08, side: THREE.DoubleSide })
    );
    zoneFill.position.copy(to3(0, yz, (z0 + z1) / 2));
    extras.add(zoneFill);

    // Commit plane
    const planeH = 6.2, planeW = 7;
    const cplane = new THREE.Mesh(
      new THREE.PlaneGeometry(planeW, planeH),
      new THREE.MeshBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.12, side: THREE.DoubleSide })
    );
    cplane.position.copy(to3(0, meta.commit_y_ft, planeH / 2));
    extras.add(cplane);
    const edge = [
      to3(-planeW / 2, meta.commit_y_ft, 0),
      to3(planeW / 2, meta.commit_y_ft, 0),
      to3(planeW / 2, meta.commit_y_ft, planeH),
      to3(-planeW / 2, meta.commit_y_ft, planeH),
      to3(-planeW / 2, meta.commit_y_ft, 0),
    ];
    extras.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge), new THREE.LineBasicMaterial({ color: 0xc9a227 })));

    // Connector lines at commit and plate
    extras.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        to3(pair.a.commit[0], pair.a.commit[1], pair.a.commit[2]),
        to3(pair.b.commit[0], pair.b.commit[1], pair.b.commit[2]),
      ]),
      new THREE.LineBasicMaterial({ color: 0xc5dcef })
    ));
    extras.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        to3(pair.a.plate[0], pair.a.plate[1], pair.a.plate[2]),
        to3(pair.b.plate[0], pair.b.plate[1], pair.b.plate[2]),
      ]),
      new THREE.LineBasicMaterial({ color: 0xc5dcef })
    ));

    paths.add(makeTube(pair.a.pts, COLOR_A));
    paths.add(makeTube(pair.b.pts, COLOR_B));
    balls.add(makeBall(COLOR_A));
    balls.add(makeBall(COLOR_B));
    sync();
  }

  function sync() {
    const pair = currentPair();
    if (!pair || balls.children.length < 2) return;
    const T = longerFlight(pair);
    const t = state.progress * T;
    const pa = pointAt(pair.a, t);
    const pb = pointAt(pair.b, t);
    balls.children[0].position.copy(to3(pa[0], pa[1], pa[2]));
    balls.children[1].position.copy(to3(pb[0], pb[1], pb[2]));
  }

  function frame() {
    resize();
    if (state.orbit) controls.update();
    renderer.render(scene, camera);
  }

  function setOrbit(on) {
    state.orbit = on;
    controls.enabled = on;
    $("orbitBtn").classList.toggle("on", on);
    $("orbitBtn").setAttribute("aria-pressed", on ? "true" : "false");
    $("orbitBtn").textContent = on ? "Catcher’s eye" : "Orbit view";
    if (!on) setCatcherCam();
  }

  window.addEventListener("resize", resize);
  setCatcherCam();
  resize();

  three = { rebuild, sync, frame, setOrbit, setCatcherCam };
}

function bind() {
  $("pitcher").addEventListener("change", (e) => setPitcher(e.target.value));
  $("pitchA").addEventListener("change", (e) => {
    state.typeA = e.target.value;
    onPairChange();
  });
  $("pitchB").addEventListener("change", (e) => {
    state.typeB = e.target.value;
    onPairChange();
  });
  $("playBtn").addEventListener("click", () => {
    if (state.progress >= 1) setProgress(0);
    state.playing = !state.playing;
    state.lastTs = 0;
    $("playBtn").textContent = state.playing ? "Pause" : "Play";
  });
  $("scrub").addEventListener("input", (e) => {
    state.playing = false;
    $("playBtn").textContent = "Play";
    setProgress(Number(e.target.value) / 1000);
  });
  $("orbitBtn").addEventListener("click", () => {
    if (!three) return;
    three.setOrbit(!state.orbit);
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.tagName !== "SELECT" && e.target.tagName !== "INPUT") {
      e.preventDefault();
      $("playBtn").click();
    }
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
    $("stage").innerHTML = `<p class="err">Could not load tunnel.json (${err.message}). Serve this folder over HTTP and rebuild with <span class="mono">python3 build_tunnel.py</span>.</p>`;
    return;
  }
  state.data = data;
  fillPitcherSelect();

  state.webgl = hasWebGL();
  if (state.webgl) {
    try {
      await initThree();
    } catch (err) {
      console.warn("WebGL init failed, using 2D fallback", err);
      state.webgl = false;
      three = null;
    }
  }
  if (!state.webgl) {
    $("c3").style.display = "none";
    $("fallback").classList.add("show");
    $("orbitBtn").disabled = true;
    $("orbitBtn").title = "Orbit needs WebGL";
  }

  setPitcher(data.meta.default_pitcher);
  // Start mid-flight so a still screenshot shows both paths, the commit plane, and the balls.
  setProgress(0.55);
  requestAnimationFrame(tick);
}

main();
