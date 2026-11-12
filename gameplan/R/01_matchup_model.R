# 01_matchup_model.R -- pitch-level matchup model: expected run value of a pitch given
#   pitch traits (velo, movement, spin, extension, arm angle, VAA, off-speed differentials),
#   location (hitter-relative), count, platoon, and a SHRUNK hitter profile
#   (bat speed, swing length, attack angle, chase, zone-swing, whiff by pitch group, xwOBA on contact).
# + a hitter-specific residual layer (pitch group x location band), shrunk toward 0.
# Validation: train on games before 2026-08-01, test on Aug 1 - end of season.
# Run from gameplan/:  Rscript R/01_matchup_model.R
suppressPackageStartupMessages({ library(DBI); library(duckdb); library(data.table); library(xgboost); library(jsonlite) })
set.seed(2027)
source("R/lib.R")
con <- dbConnect(duckdb(), dbdir = "work/gameplan.duckdb", read_only = TRUE)
d <- as.data.table(dbGetQuery(con, "
  SELECT game_pk, game_date, pitcher, batter, bat_team, stand, p_throws, pitch_type, pitch_group,
         balls, strikes, count_state, region, x_in, z, same_side, in_zone, is_swing, is_whiff, is_chase, type,
         release_speed, ivb, hb_arm, release_spin_rate, release_extension, arm_angle, release_pos_z, vaa,
         velo_diff, ivb_diff, hb_diff, bat_speed, swing_length, attack_angle, xwoba_con, xrv
  FROM mp"))
dbDisconnect(con, shutdown = TRUE)
d[, `:=`(game_date = as.Date(game_date), pg = match(pitch_group, c("Fastball","Breaking","Offspeed")) - 1L,
         stand_l = as.integer(stand == "L"), band = loc_band(region, z))]
SPLIT <- as.Date("2026-08-01")
d[, holdout := game_date >= SPLIT]
cat(sprintf("pitches %d | train %d | test %d\n", nrow(d), sum(!d$holdout), sum(d$holdout)))

# ---------- validation run: profiles from the TRAIN window only ----------
prof_tr <- hitter_profiles(d[holdout == FALSE])
dv <- attach_profiles(d, prof_tr)
tr <- dv[holdout == FALSE]; te <- dv[holdout == TRUE]
mat <- function(x, f) xgb.DMatrix(as.matrix(x[, f, with = FALSE]), label = x$xrv, missing = NA)

fit_es <- function(x, f) {            # early stopping on an inner split of the training window (by game)
  g <- unique(x$game_pk); vg <- sample(g, 0.15 * length(g)); iv <- x$game_pk %in% vg
  m <- xgb.train(XGB_PARAMS, mat(x[!iv], f), nrounds = 3000, evals = list(val = mat(x[iv], f)),
                 early_stopping_rounds = 100, verbose = 0)
  nr <- as.integer(xgb.attr(m, "best_iteration")) + 1L
  list(nrounds = nr, model = xgb.train(XGB_PARAMS, mat(x, f), nrounds = nr, verbose = 0))
}
t0 <- Sys.time()
m_base <- fit_es(tr, PITCH_FEATS)                         # pitch + location + count + platoon only
m_full <- fit_es(tr, c(PITCH_FEATS, HITTER_FEATS))        # + shrunk hitter profile
message("validation models: ", round(as.numeric(Sys.time() - t0, units = "mins"), 1), " min; nrounds ",
        m_base$nrounds, " / ", m_full$nrounds)
te[, p_base := predict(m_base$model, mat(te, PITCH_FEATS))]
te[, p_full := predict(m_full$model, mat(te, c(PITCH_FEATS, HITTER_FEATS)))]
cnt_mean <- tr[, .(p_cnt = mean(xrv)), by = .(balls, strikes)]
te <- merge(te, cnt_mean, by = c("balls", "strikes"), all.x = TRUE)

# hitter residual layer, fit on out-of-fold training predictions (2 folds by game) so it isn't in-sample
oof <- function(x, f, nr) {
  g <- unique(x$game_pk); fa <- x$game_pk %in% sample(g, length(g) / 2); p <- numeric(nrow(x))
  for (k in c(TRUE, FALSE)) {
    m <- xgb.train(XGB_PARAMS, mat(x[fa == k], f), nrounds = nr, verbose = 0)
    p[fa != k] <- predict(m, mat(x[fa != k], f))
  }
  p
}
tr[, p_oof := oof(tr, c(PITCH_FEATS, HITTER_FEATS), m_full$nrounds)]
res_tr <- tr[, .(res_sum = sum(xrv - p_oof), n = .N), by = .(batter, pitch_group, band)]

r2 <- function(y, p, p0) 1 - sum((y - p)^2) / sum((y - p0)^2)
lift <- list()
for (k in RES_K_GRID) {
  rr <- res_tr[, .(batter, pitch_group, band, adj = res_sum / (n + k))]
  tt <- merge(te[, .(i = .I, batter, pitch_group, band)], rr, by = c("batter","pitch_group","band"), all.x = TRUE)
  setorder(tt, i); adj <- fifelse(is.na(tt$adj), 0, tt$adj)
  lift[[as.character(k)]] <- list(k = k, r2_vs_count = r2(te$xrv, te$p_full + adj, te$p_cnt))
}
RES_K <- RES_K_DEFAULT
rr <- res_tr[, .(batter, pitch_group, band, adj = res_sum / (n + RES_K))]
te <- merge(te, rr, by = c("batter","pitch_group","band"), all.x = TRUE); te[is.na(adj), adj := 0]
te[, p_res := p_full + adj]

# ---- metrics ----
pitch_metrics <- list(
  n_train = nrow(tr), n_test = nrow(te), split_date = as.character(SPLIT),
  rmse_count_only = sqrt(mean((te$xrv - te$p_cnt)^2)),
  rmse_pitch_model = sqrt(mean((te$xrv - te$p_base)^2)),
  rmse_matchup = sqrt(mean((te$xrv - te$p_full)^2)),
  rmse_matchup_res = sqrt(mean((te$xrv - te$p_res)^2)),
  r2_pitch_model_vs_count = r2(te$xrv, te$p_base, te$p_cnt),
  r2_matchup_vs_count = r2(te$xrv, te$p_full, te$p_cnt),
  r2_matchup_res_vs_count = r2(te$xrv, te$p_res, te$p_cnt),
  r2_hitter_gain_over_pitch_model = r2(te$xrv, te$p_full, te$p_base),
  res_k = RES_K, res_k_sensitivity = unname(lift))

# cell level: hitter x pitch group x location band with 40+ test pitches.
# Compare (a) the model's test-period prediction, vs (b) the hitter's RAW train-period split in that cell.
raw_tr <- tr[, .(raw = mean(xrv), n_tr = .N), by = .(batter, pitch_group, band)]
cell <- te[, .(n = .N, actual = mean(xrv), pred = mean(p_res), pred_nohit = mean(p_base), cnt = mean(p_cnt)),
           by = .(batter, pitch_group, band)][n >= 40]
cell <- merge(cell, raw_tr, by = c("batter","pitch_group","band"), all.x = TRUE)
cell_ok <- cell[!is.na(raw) & n_tr >= 20]
# remove the count mix (cells differ in count mix); compare count-adjusted values
cm <- function(a, b) cor(a, b)
cell_metrics <- list(
  n_cells = nrow(cell_ok), min_test_pitches = 40L,
  cor_model = cm(cell_ok$pred - cell_ok$cnt, cell_ok$actual - cell_ok$cnt),
  cor_model_no_hitter = cm(cell_ok$pred_nohit - cell_ok$cnt, cell_ok$actual - cell_ok$cnt),
  cor_raw_split = cm(cell_ok$raw, cell_ok$actual - cell_ok$cnt),
  rmse_model_per100 = 100 * sqrt(mean(((cell_ok$pred) - (cell_ok$actual))^2)),
  rmse_raw_split_per100 = 100 * sqrt(mean(((cell_ok$raw - mean(tr$xrv) + cell_ok$cnt) - cell_ok$actual)^2)))

# does the HITTER part carry signal? Across cells, correlate the model's hitter adjustment (matchup - no-hitter
# prediction) with what actually happened relative to the no-hitter prediction. Same for the raw train split.
lg_band <- tr[, .(lg = mean(xrv)), by = .(pitch_group, band)]
cell_ok <- merge(cell_ok, lg_band, by = c("pitch_group","band"))
cell_metrics$cor_hitter_adjustment_model <- cor(cell_ok$pred - cell_ok$pred_nohit, cell_ok$actual - cell_ok$pred_nohit)
cell_metrics$cor_hitter_adjustment_raw_split <- cor(cell_ok$raw - cell_ok$lg, cell_ok$actual - cell_ok$pred_nohit)

# within-hitter ranking: for hitters with >= 6 qualifying cells, does the model order their cells right?
rk <- cell[, if (.N >= 6) .(rho_model = cor(pred - cnt, actual - cnt, method = "spearman"),
                            rho_nohit = cor(pred_nohit - cnt, actual - cnt, method = "spearman")), by = batter]
cell_metrics$within_hitter_spearman_model <- mean(rk$rho_model, na.rm = TRUE)
cell_metrics$within_hitter_spearman_no_hitter <- mean(rk$rho_nohit, na.rm = TRUE)
cell_metrics$n_hitters_ranked <- nrow(rk)

# calibration on test (deciles of predicted, count-adjusted)
te[, dec := cut(p_res - p_cnt, quantile(p_res - p_cnt, 0:10 / 10), include.lowest = TRUE, labels = FALSE)]
calib <- te[, .(pred100 = 100 * mean(p_res - p_cnt), actual100 = 100 * mean(xrv - p_cnt), n = .N), by = dec][order(dec)]

# a sharper, interpretable check: whiffs. Among TEST swings, does the model rank whiff probability?
# (xrv on a swing-and-miss is high; AUC of predicted value for whiff vs contact)
auc <- function(score, y) { r <- rank(score); n1 <- as.numeric(sum(y)); n0 <- length(y) - n1; (sum(r[y == 1]) - n1 * (n1 + 1) / 2) / (n1 * n0) }
sw <- te[is_swing == TRUE]
pitch_metrics$auc_whiff_on_swings_matchup <- auc(sw$p_full - sw$p_cnt, as.integer(sw$is_whiff))
pitch_metrics$auc_whiff_on_swings_pitch_model <- auc(sw$p_base - sw$p_cnt, as.integer(sw$is_whiff))

val <- list(pitch_level = pitch_metrics, cell_level = cell_metrics, calibration = calib,
            nrounds = list(pitch_model = m_base$nrounds, matchup = m_full$nrounds))
dir.create("out", showWarnings = FALSE)
write_json(val, "out/validation.json", auto_unbox = TRUE, digits = 5, pretty = TRUE)
print(str(val[1:2]))

# ---------- final model: full-season profiles, full-season fit ----------
prof <- hitter_profiles(d)
df <- attach_profiles(d, prof)
NR <- m_full$nrounds
m_final <- xgb.train(XGB_PARAMS, mat(df, c(PITCH_FEATS, HITTER_FEATS)), nrounds = NR, verbose = 0)
df[, p_oof := oof(df, c(PITCH_FEATS, HITTER_FEATS), NR)]
res <- df[, .(n = .N, adj = sum(xrv - p_oof) / (.N + RES_K)), by = .(batter, pitch_group, band)]
imp <- as.data.table(xgb.importance(c(PITCH_FEATS, HITTER_FEATS), model = m_final))[, .(feature = Feature, gain = round(Gain, 4))]
xgb.save(m_final, "work/matchup_xgb.ubj")
saveRDS(list(prof = prof, res = res, imp = imp, NR = NR), "work/matchup_final.rds")
fwrite(imp, "out/feature_importance.csv")
print(imp[1:15])
