# 06_sequencing.R -- does the previous pitch help predict how the next pitch type will do?
# Unit: every pitch after the first of a plate appearance (same pitcher), 2026 regular season, league-wide.
# Context: previous pitch type, location and result + the count. Outcomes for the next pitch type:
#   CSW (called + swinging strike per pitch), whiff per swing, and expected run value per 100 (pitcher's view).
# Baseline ("no sequence"): count + next pitch type + batter/pitcher hand. Sequence model adds the previous pitch.
# Same xgboost settings for both; temporal holdout (train before the Stuff+ split date, test after), with
# early stopping on a slice of the training window only. Lift reported on the held-out games, with a
# game-level bootstrap interval. Reads the DuckDB file read-only. Writes site/data/sequencing.json.
suppressPackageStartupMessages({ library(DBI); library(duckdb); library(data.table); library(xgboost); library(jsonlite) })
set.seed(2026)
con <- dbConnect(duckdb(), dbdir = Sys.getenv("DB_PATH", "data/statcast.duckdb"), read_only = TRUE)
d <- as.data.table(dbGetQuery(con, "
  WITH p AS (
    SELECT game_pk, game_date, at_bat_number, pitch_number, pitcher, player_name, is_royals, pitch_team, p_throws, stand,
           balls, strikes, description, is_swing, is_whiff, is_called_strike, xrv,
           CASE WHEN pitch_type IN ('CU','KC','SV','CS') THEN 'CU' WHEN pitch_type IN ('FS','FO') THEN 'FS'
                WHEN pitch_type IN ('FF','SI','FC','SL','ST','CH') THEN pitch_type END AS pt,
           CASE WHEN plate_z_norm IS NULL THEN NULL
                WHEN in_zone AND plate_z_norm >= 0.5 THEN 'Zone up' WHEN in_zone THEN 'Zone down'
                WHEN plate_z_norm > 1 THEN 'Out above' WHEN plate_z_norm < 0 THEN 'Out below' ELSE 'Out side' END AS loc,
           CASE WHEN description IN ('ball','blocked_ball') THEN 'Ball' WHEN description = 'called_strike' THEN 'Called strike'
                WHEN description IN ('swinging_strike','swinging_strike_blocked','missed_bunt') THEN 'Whiff'
                WHEN description IN ('foul','foul_bunt','foul_tip','bunt_foul_tip') THEN 'Foul' END AS res
    FROM pitch_features)
  SELECT p.*, q.pt AS prev_pt, q.loc AS prev_loc, q.res AS prev_res
  FROM p JOIN p q ON q.game_pk = p.game_pk AND q.at_bat_number = p.at_bat_number
                 AND q.pitch_number = p.pitch_number - 1 AND q.pitcher = p.pitcher
  WHERE p.pt IS NOT NULL AND q.pt IS NOT NULL AND q.loc IS NOT NULL AND q.res IS NOT NULL AND p.xrv IS NOT NULL
  ORDER BY p.game_pk, p.at_bat_number, p.pitch_number"))  # fixed row order: seeded sampling is reproducible
split_date <- as.Date(fromJSON("data/out/stuff_validation.json")$split_date)
dbDisconnect(con, shutdown = TRUE)
PT <- c("FF", "SI", "FC", "SL", "ST", "CU", "CH", "FS")
LOC <- c("Zone up", "Zone down", "Out above", "Out below", "Out side")
RES <- c("Ball", "Called strike", "Whiff", "Foul")
d[, `:=`(csw = as.integer(is_called_strike | is_whiff), whiff = as.integer(is_whiff), same_hand = as.integer(stand == p_throws),
         rhp = as.integer(p_throws == "R"), holdout = as.Date(game_date) > split_date,
         pt = factor(pt, PT), prev_pt = factor(prev_pt, PT), prev_loc = factor(prev_loc, LOC), prev_res = factor(prev_res, RES))]
cat("pitches:", nrow(d), " holdout:", sum(d$holdout), "\n")

mm <- function(x, seq) {
  f <- if (seq) ~ balls + strikes + same_hand + rhp + pt + prev_pt + prev_loc + prev_res + I(as.integer(pt == prev_pt)) - 1
       else ~ balls + strikes + same_hand + rhp + pt - 1
  fv <- intersect(all.vars(f), c("pt", "prev_pt", "prev_loc", "prev_res"))
  model.matrix(f, x, contrasts.arg = lapply(x[, fv, with = FALSE], contrasts, contrasts = FALSE))
}
P <- list(eta = 0.1, max_depth = 5, min_child_weight = 100, subsample = 0.8, colsample_bytree = 0.8, nthread = 8)
fit <- function(x, y, seq, obj) {
  X <- mm(x, seq); idx <- sample(nrow(X), 0.85 * nrow(X))
  pr <- c(P, objective = obj)
  m0 <- xgb.train(pr, xgb.DMatrix(X[idx, ], label = y[idx]), nrounds = 1500,
                  evals = list(val = xgb.DMatrix(X[-idx, ], label = y[-idx])), early_stopping_rounds = 50, verbose = 0)
  nr <- as.integer(xgb.attr(m0, "best_iteration")) + 1L
  list(m = xgb.train(pr, xgb.DMatrix(X, label = y), nrounds = nr, verbose = 0), nr = nr, seq = seq)
}
prd <- function(f, x) predict(f$m, xgb.DMatrix(mm(x, f$seq)))
ll <- function(y, p) { p <- pmin(pmax(p, 1e-6), 1 - 1e-6); -(y * log(p) + (1 - y) * log(1 - p)) }
auc <- function(y, p) { r <- rank(p); n1 <- as.numeric(sum(y)); (sum(r[y == 1]) - n1 * (n1 + 1) / 2) / (n1 * (length(y) - n1)) }
boot_lift <- function(games, lb, ls, B = 500) { # game-level bootstrap of % loss reduction
  g <- data.table(games, lb, ls)[, .(lb = sum(lb), ls = sum(ls)), by = games]
  s <- replicate(B, { i <- sample(nrow(g), replace = TRUE); 100 * (1 - sum(g$ls[i]) / sum(g$lb[i])) })
  unname(quantile(s, c(.025, .975)))
}
OUT <- list(csw = list(y = "csw", obj = "binary:logistic", rows = function(x) rep(TRUE, nrow(x))),
            whiff = list(y = "whiff", obj = "binary:logistic", rows = function(x) x$is_swing),
            rv = list(y = "xrv", obj = "reg:squarederror", rows = function(x) rep(TRUE, nrow(x))))
val <- list(); final <- list(); final_base <- list()
for (o in names(OUT)) {
  sp <- OUT[[o]]; sub <- d[sp$rows(d)]
  tr <- sub[holdout == FALSE]; te <- sub[holdout == TRUE]
  fb <- fit(tr, tr[[sp$y]], FALSE, sp$obj); fs <- fit(tr, tr[[sp$y]], TRUE, sp$obj)
  pb <- prd(fb, te); ps <- prd(fs, te); y <- te[[sp$y]]
  if (sp$obj == "binary:logistic") {
    lb <- ll(y, pb); ls <- ll(y, ps)
    val[[o]] <- list(outcome = o, n_train = nrow(tr), n_test = nrow(te), metric = "log loss",
                     base = mean(lb), seq = mean(ls), lift_pct = 100 * (1 - mean(ls) / mean(lb)),
                     lift_ci = boot_lift(te$game_pk, lb, ls), auc_base = auc(y, pb), auc_seq = auc(y, ps),
                     brier_base = mean((y - pb)^2), brier_seq = mean((y - ps)^2), nrounds = c(fb$nr, fs$nr))
  } else {
    lb <- (y - pb)^2; ls <- (y - ps)^2; v0 <- mean((y - mean(tr[[sp$y]]))^2)
    val[[o]] <- list(outcome = o, n_train = nrow(tr), n_test = nrow(te), metric = "MSE",
                     base = mean(lb), seq = mean(ls), lift_pct = 100 * (1 - mean(ls) / mean(lb)),
                     lift_ci = boot_lift(te$game_pk, lb, ls), r2_base = 1 - mean(lb) / v0, r2_seq = 1 - mean(ls) / v0,
                     nrounds = c(fb$nr, fs$nr))
  }
  print(as.data.table(val[[o]][setdiff(names(val[[o]]), c("lift_ci", "nrounds"))]))
  # full-season sequence model for the published grid
  final[[o]] <- fit(sub, sub[[sp$y]], TRUE, sp$obj)
  final_base[[o]] <- fit(sub, sub[[sp$y]], FALSE, sp$obj)
}

# ---- grid: every previous-pitch context x count x next pitch type, averaged over the league mix of hands
hand_mix <- d[, .N, by = .(same_hand, rhp)][, w := N / sum(N)]
counts <- CJ(balls = 0:3, strikes = 0:2)[!(balls == 0 & strikes == 0)]
ctx <- CJ(prev_pt = PT, prev_loc = LOC, prev_res = RES, balls = 0:3, strikes = 0:2)
ctx <- ctx[!(balls == 0 & strikes == 0)][!(prev_res == "Ball" & balls == 0)][!(prev_res != "Ball" & strikes == 0)]
ctx[, key := paste(prev_pt, prev_loc, prev_res, paste0(balls, "-", strikes), sep = "|")]
g <- ctx[, .(pt = PT), by = .(key, prev_pt, prev_loc, prev_res, balls, strikes)]
g <- g[, .(same_hand = hand_mix$same_hand, rhp = hand_mix$rhp, w = hand_mix$w), by = names(g)]
lv <- list(pt = PT, prev_pt = PT, prev_loc = LOC, prev_res = RES)
for (v in names(lv)) set(g, j = v, value = factor(g[[v]], lv[[v]]))
for (o in names(OUT)) set(g, j = o, value = prd(final[[o]], g))
gs <- g[, .(csw = sum(w * csw), whiff = sum(w * whiff), rv = 100 * sum(w * rv)), by = .(key, pt)]
grid <- split(gs, by = "key", keep.by = FALSE)
grid <- lapply(grid, function(x) { x <- x[match(PT, x$pt)]; list(round(x$csw, 3), round(x$whiff, 3), round(x$rv, 2)) })

# no-sequence reference for the same counts (count + next type + hands only)
b <- CJ(balls = 0:3, strikes = 0:2, pt = factor(PT, PT))[!(balls == 0 & strikes == 0)]
b <- b[, .(same_hand = hand_mix$same_hand, rhp = hand_mix$rhp, w = hand_mix$w), by = names(b)]
for (o in names(OUT)) set(b, j = o, value = prd(final_base[[o]], b))
bs <- b[, .(csw = sum(w * csw), whiff = sum(w * whiff), rv = 100 * sum(w * rv)), by = .(key = paste0(balls, "-", strikes), pt)]
base_grid <- lapply(split(bs, by = "key", keep.by = FALSE), function(x) {
  x <- x[match(PT, x$pt)]
  list(round(x$csw, 3), round(x$whiff, 3), round(x$rv, 2))
})
# ---- empirical cells (league + Royals): n, csw, swings, whiffs, sum of xRV, per previous pitch (type|location|result)
#      x next type, pooled over counts (count-level cells are too thin to quote)
d[, key := paste(prev_pt, prev_loc, prev_res, sep = "|")]
emp <- function(x) {
  e <- x[, .(n = .N, csw = sum(csw), sw = sum(is_swing), wh = sum(whiff), rv = round(100 * sum(xrv), 2)), by = .(key, pt)]
  lapply(split(e, by = "key", keep.by = FALSE), function(z) {
    setNames(lapply(seq_len(nrow(z)), function(i) unname(unlist(z[i, -"pt"]))), as.character(z$pt))
  })
}
# ---- Royals: actual vs sequence-model expectation, by previous-pitch -> next-pitch type pair
d[, e_csw := prd(final$csw, d)]
d[(is_swing), e_whiff := prd(final$whiff, d[(is_swing)])]
d[, e_rv := prd(final$rv, d)]
wil <- function(k, n, z = 1.96) { # Wilson 95% interval
  p <- k / n; c0 <- (p + z^2 / (2 * n)) / (1 + z^2 / n)
  h <- z * sqrt(p * (1 - p) / n + z^2 / (4 * n^2)) / (1 + z^2 / n)
  c(c0 - h, c0 + h)
}
roy <- d[is_royals == TRUE]
pairs <- roy[, .(n = .N, csw = mean(csw), e_csw = mean(e_csw), sw = sum(is_swing), whiff = sum(whiff) / sum(is_swing),
                 e_whiff = mean(e_whiff, na.rm = TRUE)), by = .(prev_pt, pt)][n >= 200][order(-(csw - e_csw))]
print(pairs[, .(prev_pt, pt, n, csw = round(csw, 3), e_csw = round(e_csw, 3), sw, whiff = round(whiff, 3), e_whiff = round(e_whiff, 3))])
# Royals leads: residual vs the sequence model, minus the same pitcher's average residual on that pitch type
# (so a good pitcher's pitch doesn't look like a sequencing effect). Every pair with 200+ pitches is scanned.
roy[, rc := csw - e_csw]; roy[, rc := rc - mean(rc), by = .(pitcher, pt)]
roy[(is_swing), rw := whiff - e_whiff]; roy[(is_swing), rw := rw - mean(rw), by = .(pitcher, pt)]
scan <- roy[, .(n = .N, pitchers = uniqueN(pitcher), csw = mean(csw), csw_adj = mean(rc), se_c = sd(rc) / sqrt(.N),
                sw = sum(is_swing), wh = sum(whiff), whiff = sum(whiff) / sum(is_swing), wh_adj = mean(rw, na.rm = TRUE),
                se_w = sd(rw, na.rm = TRUE) / sqrt(sum(is_swing))), by = .(prev_pt, pt)][n >= 200]
n_tests <- 2 * nrow(scan); n_sig <- scan[, sum(abs(csw_adj / se_c) > 1.96) + sum(abs(wh_adj / se_w) > 1.96)]
lead <- function(a, b) {
  x <- scan[prev_pt == a & pt == b]; o <- roy[pt == b & prev_pt != a & (is_swing), .(sw = .N, wh = sum(whiff))]
  list(prev = a, next_pt = b, n = x$n, pitchers = x$pitchers, swings = x$sw, whiff = x$whiff, whiff_ci = wil(x$wh, x$sw),
       other_swings = o$sw, other_whiff = o$wh / o$sw, other_ci = wil(o$wh, o$sw),
       adj = x$wh_adj, adj_ci = x$wh_adj + c(-1.96, 1.96) * x$se_w)
}
findings <- list(n_pairs = nrow(scan), n_tests = n_tests, n_sig = n_sig, expected_by_chance = 0.05 * n_tests,
                 leads = list(lead("SI", "FF"), lead("SI", "SI")))
print(str(findings))
seq_out <- list(types = PT, locs = LOC, results = RES, split_date = as.character(split_date), validation = unname(val),
                hand_mix = hand_mix[, .(same_hand, rhp, w = round(w, 4))], grid = grid, base_grid = base_grid,
                league = emp(d), royals = emp(roy), findings = findings)
write_json(seq_out, "site/data/sequencing.json", auto_unbox = TRUE, digits = NA, na = "null")
# per-team empirical cells for the team view (lazy-loaded: site/data/seq/<TEAM>.json)
unlink("site/data/seq", recursive = TRUE); dir.create("site/data/seq", showWarnings = FALSE)
for (t in sort(unique(d$pitch_team))) {
  write_json(list(team = t, n = sum(d$pitch_team == t), cells = emp(d[pitch_team == t])), sprintf("site/data/seq/%s.json", t),
             auto_unbox = TRUE, digits = NA, na = "null")
}
cat("contexts:", length(grid), " team files:", uniqueN(d$pitch_team), "\n")
