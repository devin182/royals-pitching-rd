# 02_stuff_model.R -- a simple, honest Stuff+ model.
`%||%` <- function(a, b) if (is.null(a)) b else a
# Target  : pitcher run value of each pitch (-delta_run_exp), league-wide.
# Features: physical traits only (velo, movement, spin, axis, extension, release, arm angle)
#           + differentials vs. the pitcher's primary fastball. No location, no outcome info.
# One xgboost model per pitch group (fastball / breaking / offspeed).
# Validation: temporal holdout (train early season, test late season) at pitch level AND
#             "does early-season Stuff+ predict late-season run value better than early-season results?"
suppressPackageStartupMessages({ library(DBI); library(duckdb); library(data.table); library(xgboost); library(jsonlite) })
set.seed(2026)
con <- dbConnect(duckdb(), dbdir = "data/statcast.duckdb")
d <- as.data.table(dbGetQuery(con, "
  SELECT game_pk, game_date, pitcher, player_name, pitch_type, pitch_group, is_royals,
         xrv AS rv, -delta_run_exp AS rv_actual, is_swing, is_whiff,
         release_speed, ivb, hb_arm, release_spin_rate,
         CASE WHEN p_throws = 'L' THEN 360 - spin_axis ELSE spin_axis END AS spin_axis_arm,
         release_extension, release_pos_z, rel_side_arm, arm_angle,
         velo_diff, ivb_diff, hb_diff
  FROM pitch_features
  WHERE xrv IS NOT NULL AND release_speed IS NOT NULL AND pfx_x IS NOT NULL"))
feats <- c("release_speed","ivb","hb_arm","release_spin_rate","spin_axis_arm","release_extension",
           "release_pos_z","rel_side_arm","arm_angle","velo_diff","ivb_diff","hb_diff")
# fastballs: differentials are ~0 for the primary FB, keep them (they identify secondary FBs, e.g. a cutter)
split_date <- quantile(as.numeric(d$game_date), 0.65, type = 1)
d[, holdout := as.numeric(game_date) > split_date]
params <- list(objective = "reg:squarederror", eta = 0.03, max_depth = 5, min_child_weight = 200,
               subsample = 0.8, colsample_bytree = 0.8, nthread = 8)
metrics <- list(); importance <- list()
d[, pred_hold := NA_real_]; d[, pred := NA_real_]
for (g in c("Fastball","Breaking","Offspeed")) {
  tr <- d[pitch_group == g & !holdout]; te <- d[pitch_group == g & holdout]
  dtr <- xgb.DMatrix(as.matrix(tr[, feats, with = FALSE]), label = tr$rv, missing = NA)
  dte <- xgb.DMatrix(as.matrix(te[, feats, with = FALSE]), label = te$rv, missing = NA)
  # inner early-stopping split from the training window only (no peeking at holdout)
  idx <- sample(nrow(tr), 0.85 * nrow(tr))
  din <- xgb.DMatrix(as.matrix(tr[idx, feats, with = FALSE]), label = tr$rv[idx], missing = NA)
  dva <- xgb.DMatrix(as.matrix(tr[-idx, feats, with = FALSE]), label = tr$rv[-idx], missing = NA)
  m0 <- xgb.train(params, din, nrounds = 2000, evals = list(val = dva),
                  early_stopping_rounds = 100, verbose = 0)
  nr <- m0$best_iteration %||% xgb.attr(m0, "best_iteration")
  nr <- as.integer(nr) + 1L
  m  <- xgb.train(params, dtr, nrounds = nr, verbose = 0)
  p  <- predict(m, dte)
  d[pitch_group == g & holdout, pred_hold := p]
  base_mse <- mean((te$rv - mean(tr$rv))^2); mse <- mean((te$rv - p)^2)
  metrics[[g]] <- list(group = g, n_train = nrow(tr), n_test = nrow(te), nrounds = nr,
                       r2_pitch = 1 - mse / base_mse,
                       cor_pitch = cor(p, te$rv),
                       # does predicted quality rank whiffs? (on swings, held-out)
                       cor_whiff = cor(p[te$is_swing], as.numeric(te$is_whiff[te$is_swing])))
  # final model on the full season for the published grades
  mf <- xgb.train(params, xgb.DMatrix(as.matrix(d[pitch_group == g, feats, with = FALSE]),
                                      label = d[pitch_group == g]$rv, missing = NA), nrounds = nr, verbose = 0)
  d[pitch_group == g, pred := predict(mf, xgb.DMatrix(as.matrix(d[pitch_group == g, feats, with = FALSE]), missing = NA))]
  imp <- as.data.table(xgb.importance(feats, model = mf)); imp[, group := g]
  importance[[g]] <- imp[, .(group, feature = Feature, gain = round(Gain, 4))]
}
# ---- scale to Stuff+ (100 = league average pitch, 10 = 1 SD across pitcher-pitch types, min 100 pitches)
agg <- d[, .(n = .N, pred = mean(pred), rv100 = 100 * mean(rv_actual), xrv100 = 100 * mean(rv), player_name = first(player_name),
             is_royals = any(is_royals)), by = .(pitcher, pitch_type, pitch_group)]
ref <- agg[n >= 100]
mu <- weighted.mean(d$pred); sdv <- sd(ref$pred)
agg[, stuff_plus := round(100 + 10 * (pred - mu) / sdv)]
# ---- predictive validity: early-season grades vs late-season results (same pitcher & pitch type)
fit_half <- function(h) d[holdout == h, .(n = .N, rv100 = 100 * mean(rv_actual)), by = .(pitcher, pitch_type)]
# early-season "stuff": average of holdout-free predictions = predictions from models trained on early data.
# Re-score early pitches with the early-trained models' cousins: use full-season model only for publishing,
# and for validation use the early-window model's in-sample prediction (no late info used).
early <- d[holdout == FALSE]
early_pred <- rbindlist(lapply(c("Fastball","Breaking","Offspeed"), function(g) {
  tr <- early[pitch_group == g]
  m <- xgb.train(params, xgb.DMatrix(as.matrix(tr[, feats, with = FALSE]), label = tr$rv, missing = NA),
                 nrounds = metrics[[g]]$nrounds, verbose = 0)
  tr[, .(pitcher, pitch_type, p = predict(m, xgb.DMatrix(as.matrix(tr[, feats, with = FALSE]), missing = NA)), rv, rv_actual)]
}))
e <- early_pred[, .(n_e = .N, stuff_e = mean(p), rv_e = 100 * mean(rv_actual), xrv_e = 100 * mean(rv)), by = .(pitcher, pitch_type)]
l <- fit_half(TRUE); setnames(l, c("n", "rv100"), c("n_l", "rv_l"))
v <- merge(e, l, by = c("pitcher", "pitch_type"))[n_e >= 100 & n_l >= 100]
validation <- list(
  split_date = as.character(as.Date(split_date, origin = "1970-01-01")),
  n_pitch_types = nrow(v),
  cor_stuff_early_vs_rv_late = cor(v$stuff_e, v$rv_l),
  cor_rv_early_vs_rv_late    = cor(v$rv_e, v$rv_l),
  cor_xrv_early_vs_rv_late   = cor(v$xrv_e, v$rv_l),
  pitch_level = unname(metrics))
dir.create("data/out", showWarnings = FALSE)
fwrite(agg, "data/out/stuff_plus.csv")
fwrite(rbindlist(importance), "data/out/stuff_importance.csv")
write_json(validation, "data/out/stuff_validation.json", auto_unbox = TRUE, digits = 4, pretty = TRUE)
dbWriteTable(con, "stuff_plus", agg, overwrite = TRUE)
dbWriteTable(con, "pitch_stuff", d[, .(game_pk, pitcher, pitch_type, game_date, pred)], overwrite = TRUE)
dbDisconnect(con, shutdown = TRUE)
print(validation[1:4]); print(rbindlist(metrics))
print(agg[is_royals == TRUE & n >= 50][order(-stuff_plus)][1:15])
