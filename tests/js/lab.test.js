// JS Stuff+ evaluator must reproduce R's xgboost predictions (tests/fixtures/lab_vectors.json, from R/05_design_lab.R).
// Run: node tests/js/lab.test.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const XGB = require("../../site/assets/xgb.js");
const root = path.join(__dirname, "..", "..");
const model = JSON.parse(fs.readFileSync(path.join(root, "site/data/lab/model.json")));
const fx = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/lab_vectors.json")));
const TOL = 1e-6; // run-value units; leaf sums differ from xgboost only by float rounding

let maxDiff = 0;
for (const r of fx.rows) {
  const p = XGB.predictOne(model.groups[r.group], r.x);
  maxDiff = Math.max(maxDiff, Math.abs(p - r.r_pred));
}
assert.ok(maxDiff < TOL, `pitch-level max |JS - R| = ${maxDiff}`);

// Stuff+ for every shipped pitcher-pitch baseline (all 30 teams) must match R exactly
let mismatches = 0, maxMean = 0;
for (const r of fx.baselines) {
  const f = JSON.parse(fs.readFileSync(path.join(root, `site/data/lab/p/${r.pitcher}_${r.pitch_type}.json`)));
  const n = f.rows[0].length;
  let s = 0;
  for (let i = 0; i < n; i++) s += XGB.predictOne(model.groups[r.group], f.rows.map((col) => col[i]));
  const mean = s / n;
  maxMean = Math.max(maxMean, Math.abs(mean - r.r_pred_mean));
  if (XGB.stuffPlus(mean, model.mu, model.sd) !== r.r_stuff) mismatches++;
}
assert.strictEqual(mismatches, 0, `${mismatches} baseline Stuff+ values differ from R`);
// every team has a lab index, and every indexed pitch has its baseline file
const teams = fs.readdirSync(path.join(root, "site/data/lab/teams"));
assert.strictEqual(teams.length, 30, `expected 30 team indexes, found ${teams.length}`);
let indexed = 0;
for (const t of teams) {
  const idx = JSON.parse(fs.readFileSync(path.join(root, "site/data/lab/teams", t)));
  assert.ok(idx.length > 0, `${t} has no pitches`);
  for (const r of idx) {
    assert.ok(fs.existsSync(path.join(root, `site/data/lab/p/${r.pitcher}_${r.pitch_type}.json`)), `missing ${r.pitcher}_${r.pitch_type}`);
    indexed++;
  }
}
console.log(`ok: ${fx.rows.length} pitches, max |JS-R| = ${maxDiff.toExponential(2)}; ` +
  `${fx.baselines.length} pitcher-pitch baselines (30 teams, ${indexed} team entries), max mean diff = ${maxMean.toExponential(2)}, Stuff+ mismatches = 0`);
