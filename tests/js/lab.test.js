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

// Stuff+ for every Royals pitcher-pitch sample shipped to the browser must match R exactly
let mismatches = 0, maxMean = 0;
for (const r of fx.royals) {
  const f = JSON.parse(fs.readFileSync(path.join(root, `site/data/lab/p/${r.pitcher}_${r.pitch_type}.json`)));
  const g = JSON.parse(fs.readFileSync(path.join(root, "site/data/lab/royals.json"))).find(
    (q) => q.pitcher === r.pitcher && q.pitch_type === r.pitch_type).group;
  const n = f.rows[0].length;
  let s = 0;
  for (let i = 0; i < n; i++) s += XGB.predictOne(model.groups[g], f.rows.map((col) => col[i]));
  const mean = s / n;
  maxMean = Math.max(maxMean, Math.abs(mean - r.r_pred_mean));
  if (XGB.stuffPlus(mean, model.mu, model.sd) !== r.r_stuff) mismatches++;
}
assert.strictEqual(mismatches, 0, `${mismatches} Royals Stuff+ values differ from R`);
console.log(`ok: ${fx.rows.length} pitches, max |JS-R| = ${maxDiff.toExponential(2)}; ` +
  `${fx.royals.length} Royals pitch types, max mean diff = ${maxMean.toExponential(2)}, Stuff+ mismatches = 0`);
