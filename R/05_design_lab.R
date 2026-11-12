# 05_design_lab.R -- export the Stuff+ models for the in-browser Pitch Design Lab.
# Refits the three full-season Stuff+ models exactly as R/02 does (same features, params, nrounds from
# data/out/stuff_validation.json), then writes:
#   site/data/lab/model.json   flattened xgboost trees + base_score, Stuff+ scale (mu, sd), training ranges
#   site/data/lab/teams/<TEAM>.json  per-team index of pitcher-pitches (50+ of the type for that team, pitcher 100+
#                              pitches for the team); p/<id>_<type>.json holds up to 100 of his real pitches of
#                              that type (all teams; the slider baseline), fetched on demand
#   site/data/lab/comps.json   every MLB pitcher-pitch type (n >= 100): mean shape + published Stuff+
#   tests/fixtures/lab_vectors.json  R predictions the JS evaluator must reproduce (tests/js/lab.test.js)
# Reads the DuckDB file read-only.
suppressPackageStartupMessages({ library(DBI); library(duckdb); library(data.table); library(xgboost); library(jsonlite) })
source("R/lib/pipeline.R")
set.seed(2026)
con <- dbConnect(duckdb(), dbdir = Sys.getenv("DB_PATH", "data/statcast.duckdb"), read_only = TRUE)
d <- as.data.table(dbGetQuery(con, "
  SELECT pitcher, player_name, pitch_type, pitch_group, is_royals, pitch_team, p_throws, xrv AS rv,
         release_speed, ivb, hb_arm, release_spin_rate,
         CASE WHEN p_throws = 'L' THEN 360 - spin_axis ELSE spin_axis END AS spin_axis_arm,
         release_extension, release_pos_z, rel_side_arm, arm_angle,
         velo_diff, ivb_diff, hb_diff
  FROM pitch_features
  WHERE xrv IS NOT NULL AND release_speed IS NOT NULL AND pfx_x IS NOT NULL
  ORDER BY game_pk, at_bat_number, pitch_number"))  # fixed row order: seeded sampling is reproducible
prim <- as.data.table(dbGetQuery(con, "
  SELECT pitcher, pitch_type AS fb_type FROM pitch_features WHERE pitch_type IN ('FF','SI','FC')
  GROUP BY pitcher, pitch_type QUALIFY row_number() OVER (PARTITION BY pitcher ORDER BY count(*) DESC) = 1"))
dbDisconnect(con, shutdown = TRUE)
feats <- STUFF_FEATURES
val <- fromJSON("data/out/stuff_validation.json")
nr <- setNames(val$pitch_level$nrounds, val$pitch_level$group)
groups <- c("Fastball", "Breaking", "Offspeed")

flatten_tree <- function(node, acc) {
  i <- node$nodeid + 1
  if (!is.null(node$leaf)) {
    acc$f[i] <- -1L; acc$t[i] <- 0; acc$y[i] <- 0L; acc$n[i] <- 0L; acc$m[i] <- 0L; acc$v[i] <- node$leaf
  } else {
    acc$f[i] <- match(node$split, feats) - 1L; acc$t[i] <- node$split_condition
    acc$y[i] <- node$yes; acc$n[i] <- node$no; acc$m[i] <- node$missing; acc$v[i] <- 0
    for (ch in node$children) acc <- flatten_tree(ch, acc)
  }
  acc
}
models <- list(); ranges <- list(); d[, pred := NA_real_]
for (g in groups) {
  X <- as.matrix(d[pitch_group == g, feats, with = FALSE])
  m <- xgb.train(STUFF_PARAMS, xgb.DMatrix(X, label = d[pitch_group == g]$rv, missing = NA), nrounds = nr[[g]], verbose = 0)
  d[pitch_group == g, pred := predict(m, xgb.DMatrix(X, missing = NA))]
  trees <- fromJSON(paste(xgb.dump(m, dump_format = "json"), collapse = ""), simplifyVector = FALSE)
  flat <- lapply(trees, function(t) flatten_tree(t, list(f = integer(), t = numeric(), y = integer(), n = integer(),
                                                           m = integer(), v = numeric())))
  bs <- as.numeric(gsub("[^0-9eE.+-]", "", xgb.config(m)$learner$learner_model_param$base_score))
  models[[g]] <- list(base_score = bs, trees = flat, model = m)
  ranges[[g]] <- lapply(setNames(feats, feats), function(f) unname(quantile(X[, f], c(.01, .99), na.rm = TRUE)))
}
# Stuff+ scale, same definition as R/02 (league pitch mean; SD across pitcher-pitch types with n >= 100)
agg <- d[, .(n = .N, pred = mean(pred), player_name = first(player_name), is_royals = any(is_royals), p_throws = first(p_throws)),
         by = .(pitcher, pitch_type, pitch_group)]
mu <- weighted.mean(d$pred); sdv <- sd(agg[n >= 100]$pred)
agg[, stuff_lab := stuff_plus(pred, mu, sdv)]
pub <- fread("data/out/stuff_plus.csv")[, .(pitcher, pitch_type, stuff_pub = stuff_plus)]
agg <- merge(agg, pub, by = c("pitcher", "pitch_type"))
agree <- agg[n >= 100, .(n_types = .N, cor = cor(stuff_lab, stuff_pub), mean_abs_diff = mean(abs(stuff_lab - stuff_pub)),
                         share_within_1 = mean(abs(stuff_lab - stuff_pub) <= 1), max_abs_diff = max(abs(stuff_lab - stuff_pub)))]
print(agree)

rnd <- c(release_speed = 1, ivb = 2, hb_arm = 2, release_spin_rate = 0, spin_axis_arm = 0, release_extension = 2,
         release_pos_z = 2, rel_side_arm = 2, arm_angle = 1, velo_diff = 2, ivb_diff = 2, hb_diff = 2)
round_feats <- function(x) { for (f in feats) set(x, j = f, value = round(x[[f]], rnd[[f]])); x }
pred_g <- function(x, g) predict(models[[g]]$model, xgb.DMatrix(as.matrix(x[, feats, with = FALSE]), missing = NA))

# ---- baselines for every team: up to 100 real pitches per pitcher-pitch type, features rounded for size
tt <- d[, .(n_team = .N), by = .(pitch_team, pitcher, pitch_type)]
tt <- tt[n_team >= 50][d[, .(np = .N), by = .(pitch_team, pitcher)][np >= 100], on = .(pitch_team, pitcher), nomatch = 0]
keys <- merge(unique(tt[, .(pitcher, pitch_type)]), merge(agg, prim, by = "pitcher", all.x = TRUE), by = c("pitcher", "pitch_type"))
setkey(d, pitcher, pitch_type)
base <- lapply(seq_len(nrow(keys)), function(i) {
  r <- keys[i]
  s <- d[.(r$pitcher, r$pitch_type)]
  s <- round_feats(copy(s[sample(.N, min(.N, 100))]))
  p <- pred_g(s, r$pitch_group)
  list(pitcher = r$pitcher, name = r$player_name, throws = r$p_throws, pitch_type = r$pitch_type, group = r$pitch_group,
       n_all = r$n, primary_fb = identical(r$fb_type, r$pitch_type), stuff_pub = r$stuff_pub, stuff_lab_full = r$stuff_lab,
       r_pred_mean = mean(p), r_stuff_sample = stuff_plus(mean(p), mu, sdv), rows = lapply(feats, function(f) s[[f]]))
})
bkey <- paste(keys$pitcher, keys$pitch_type)
team_of <- d[, .N, by = .(pitcher, pitch_team)][order(-N)][, .(team = first(pitch_team)), by = pitcher]

# ---- comparables: every MLB pitcher-pitch type with n >= 100 (mean shape + published Stuff+)
shape <- d[, .(release_speed = mean(release_speed), ivb = mean(ivb), hb_arm = mean(hb_arm),
               release_spin_rate = mean(release_spin_rate, na.rm = TRUE), release_pos_z = mean(release_pos_z),
               rel_side_arm = mean(rel_side_arm), release_extension = mean(release_extension, na.rm = TRUE)),
           by = .(pitcher, pitch_type)]
comps <- merge(merge(agg[n >= 100, .(pitcher, pitch_type, n, name = player_name, throws = p_throws, stuff = stuff_pub)],
                     team_of, by = "pitcher"),
               shape, by = c("pitcher", "pitch_type"))
num <- c("release_speed", "ivb", "hb_arm", "release_spin_rate", "release_pos_z", "rel_side_arm", "release_extension")
for (f in num) set(comps, j = f, value = round(comps[[f]], if (f == "release_spin_rate") 0 else 2))

# ---- test vectors: random league pitches per group, plus perturbed copies (slider-like shifts, some far
#      outside the training range, some missing values) -> JS must match R predictions
vec <- rbindlist(lapply(groups, function(g) {
  s <- round_feats(copy(d[pitch_group == g][sample(.N, 300)]))
  p <- copy(s[1:200])
  p[, release_speed := release_speed + round(runif(.N, -6, 6), 1)]
  p[, ivb := ivb + round(runif(.N, -10, 10), 2)]; p[, hb_arm := hb_arm + round(runif(.N, -10, 10), 2)]
  p[, release_spin_rate := release_spin_rate + round(runif(.N, -600, 600))]
  p[1:20, release_spin_rate := NA]; p[21:30, spin_axis_arm := NA]
  x <- rbind(s, p); x[, group := g]; x[, r_pred := pred_g(x, g)]; x
}))
fixtures <- list(features = feats, mu = mu, sd = sdv,
                 rows = lapply(seq_len(nrow(vec)), function(i) list(group = vec$group[i],
                                 x = unname(as.list(unlist(vec[i, feats, with = FALSE]))), r_pred = vec$r_pred[i])),
                 baselines = lapply(base, function(r) list(pitcher = r$pitcher, pitch_type = r$pitch_type, group = r$group,
                                                           r_pred_mean = r$r_pred_mean, r_stuff = r$r_stuff_sample)))

out <- "site/data/lab"; dir.create(out, showWarnings = FALSE, recursive = TRUE)
model_json <- list(features = feats, mu = mu, sd = sdv, nrounds = as.list(nr),
                   groups = lapply(models[groups], function(x) list(base_score = x$base_score, trees = x$trees)),
                   ranges = ranges[groups], agreement_with_published = as.list(agree),
                   note = "Full-season xgboost Stuff+ models refit with R/02's features, params and nrounds (R/05_design_lab.R).")
write_json(model_json, file.path(out, "model.json"), auto_unbox = TRUE, digits = NA, na = "null")
# per-team index (no rows) + one small file per pitcher-pitch, fetched only when the user picks it
unlink(file.path(out, c("royals.json", "p", "teams")), recursive = TRUE)
dir.create(file.path(out, "p"), showWarnings = FALSE); dir.create(file.path(out, "teams"), showWarnings = FALSE)
for (t in sort(unique(tt$pitch_team))) {
  x <- tt[pitch_team == t][order(-np, -n_team)]
  idx <- lapply(seq_len(nrow(x)), function(i) {
    b <- base[[match(paste(x$pitcher[i], x$pitch_type[i]), bkey)]]
    c(b[names(b) != "rows"], list(n = x$n_team[i]))
  })
  write_json(idx, file.path(out, "teams", paste0(t, ".json")), auto_unbox = TRUE, digits = NA, na = "null")
}
for (b in base) write_json(list(features = feats, rows = b$rows), file.path(out, "p", sprintf("%s_%s.json", b$pitcher, b$pitch_type)),
                           auto_unbox = TRUE, digits = NA, na = "null")
write_json(comps, file.path(out, "comps.json"), auto_unbox = TRUE, digits = NA, na = "null", dataframe = "columns")
write_json(fixtures, "tests/fixtures/lab_vectors.json", auto_unbox = TRUE, digits = NA, na = "null")
cat("pitcher-pitch baselines:", length(base), " teams:", uniqueN(tt$pitch_team), " comps:", nrow(comps), " test rows:", nrow(vec), "\n")
