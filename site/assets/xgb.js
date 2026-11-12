// Minimal xgboost evaluator for the Pitch Design Lab. Trees are the flattened xgb.dump() of the R Stuff+ models
// (R/05_design_lab.R): per node f = feature index (-1 = leaf), t = split threshold, y/n/m = yes/no/missing child,
// v = leaf value. xgboost compares in float32 (x < split -> yes), and missing values follow the "missing" branch.
(function (root) {
  const f32 = Math.fround;
  function predictOne(group, x) {
    let s = 0;
    for (const t of group.trees) {
      let i = 0;
      while (t.f[i] !== -1) {
        const v = x[t.f[i]];
        i = v === null || v === undefined || Number.isNaN(v) ? t.m[i] : f32(v) < f32(t.t[i]) ? t.y[i] : t.n[i];
      }
      s += t.v[i];
    }
    return group.base_score + s;
  }
  const stuffPlus = (predMean, mu, sd) => Math.round(100 + (10 * (predMean - mu)) / sd);
  const api = { predictOne, stuffPlus };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.XGB = api;
})(typeof self !== "undefined" ? self : this);
