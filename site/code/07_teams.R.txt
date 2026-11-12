# 07_teams.R -- all 30 MLB teams: explorer, season tracker, coach-card and team-summary data.
# A pitcher is listed under a team using only the pitches he threw for that team (pitch_team), so a
# traded pitcher can appear under two clubs. Explorer / card pages need 300+ pitches for the team.
# Writes (lazy-loaded by the site, one small file per team and per pitcher):
#   site/data/teams.json                   30 teams: name, accent colour, staff summary (for ranks)
#   site/data/t/<TEAM>/index.json           pitchers (300+), arsenal table
#   site/data/t/<TEAM>/p/<id>.json          pitch sample, location grid, count usage, regions, coach-card inputs
#   site/data/t/<TEAM>/season.json          month-by-month team and pitcher trends (2026 game dates)
# Reads the DuckDB file read-only.
suppressPackageStartupMessages({ library(DBI); library(duckdb); library(data.table); library(jsonlite) })
source("R/lib/pipeline.R")
set.seed(2026)
con <- dbConnect(duckdb(), dbdir = Sys.getenv("DB_PATH", "data/statcast.duckdb"), read_only = TRUE)
# GROUP BY output order is not stable in DuckDB: sort unordered results so reruns write identical JSON
dbExecute(con, "SET threads TO 1")   # single-threaded sums: identical rounding on every rerun
q <- function(sql) {
  x <- as.data.table(dbGetQuery(con, sql))
  if (!grepl("ORDER BY", sql, fixed = TRUE)) setorderv(x, names(x))
  x
}
OUT <- "site/data"
MIN_PITCHES <- 300
wj <- function(x, f) {
  dir.create(dirname(f), recursive = TRUE, showWarnings = FALSE)
  write_json(x, f, auto_unbox = TRUE, digits = NA, na = "null", dataframe = "rows")
}
cols <- function(x) lapply(as.list(x), function(v) if (is.numeric(v)) v else as.character(v))  # columnar, smaller
teams_cfg <- fromJSON("config/teams.json"); teams_cfg <- teams_cfg[names(teams_cfg) != "_note"]
r <- function(x, d = 3) round(x, d)

# ---------- team-scoped pitcher list -----------------------------------------------------------
tp <- q("SELECT pitch_team AS team, pitcher, any_value(player_name) AS name, any_value(p_throws) AS throws,
                count(*) AS n, count(DISTINCT game_pk) AS games,
                count(DISTINCT CASE WHEN inning = 1 THEN game_pk END) AS starts, min(game_date) AS d0, max(game_date) AS d1
         FROM pitch_features GROUP BY 1, 2")
tp <- tp[n >= MIN_PITCHES][order(team, -n)]
cat("team-pitchers with", MIN_PITCHES, "+ pitches:", nrow(tp), "\n")

# ---------- arsenal per team x pitcher x type (same definitions as sql/03_arsenal.sql) -----------
ars <- q("WITH tot AS (SELECT pitch_team, pitcher, count(*) n_all FROM pitch_features GROUP BY 1, 2)
  SELECT p.pitch_team AS team, p.pitcher, p.pitch_type, any_value(pitch_name) AS pitch_name, count(*) AS n,
    round(count(*) / any_value(t.n_all), 4) AS usage, round(avg(release_speed), 1) AS velo, round(max(release_speed), 1) AS velo_max,
    round(avg(release_spin_rate)) AS spin, round(avg(ivb), 1) AS ivb, round(avg(hb_arm), 1) AS hb_arm,
    round(avg(release_extension), 2) AS extension, round(avg(arm_angle), 1) AS arm_angle,
    round(avg(release_pos_z), 2) AS rel_height, round(avg(rel_side_arm), 2) AS rel_side,
    round(avg(is_whiff::INT) FILTER (WHERE is_swing), 3) AS whiff_rate,
    round(avg(is_chase::INT) FILTER (WHERE NOT in_zone), 3) AS chase_rate,
    round(avg(in_zone::INT), 3) AS zone_rate, round(avg((is_whiff OR is_called_strike)::INT), 3) AS csw_rate,
    round(avg(xwoba_con) FILTER (WHERE type = 'X'), 3) AS xwoba_con, round(100 * sum(-delta_run_exp) / count(*), 2) AS rv100,
    round(avg(vaa), 2) AS vaa, count(*) FILTER (WHERE is_swing) AS swings, sum(xrv) AS xrv_sum
  FROM pitch_features p JOIN tot t USING (pitch_team, pitcher)
  GROUP BY 1, 2, 3 HAVING count(*) >= 25")
ars <- merge(ars, tp[, .(team, pitcher)], by = c("team", "pitcher"))
stuff <- q("SELECT pitcher, pitch_type, stuff_plus FROM stuff_plus")
ars <- merge(ars, stuff, by = c("pitcher", "pitch_type"), all.x = TRUE)
lg <- q("SELECT pitch_type, avg(xrv) AS lg_xrv FROM pitch_features GROUP BY 1")
ars <- merge(ars, lg, by = "pitch_type", all.x = TRUE)
ars[, `:=`(xrv100_raw = r(100 * xrv_sum / n, 2), xrv100 = r(100 * (xrv_sum + 250 * lg_xrv) / (n + 250), 2), xrv_sum = NULL, lg_xrv = NULL)]
fbref <- q("WITH c AS (SELECT pitch_team, pitcher, pitch_type, count(*) c, avg(release_pos_z) fz, avg(rel_side_arm) fx
                       FROM pitch_features WHERE pitch_type IN ('FF','SI','FC') GROUP BY 1, 2, 3
                       QUALIFY row_number() OVER (PARTITION BY pitch_team, pitcher ORDER BY count(*) DESC) = 1)
            SELECT pitch_team AS team, pitcher, pitch_type AS fb_type, fz, fx FROM c")
ars <- merge(ars, fbref, by = c("team", "pitcher"), all.x = TRUE)
ars[, `:=`(rel_dz_in = r(12 * (rel_height - fz), 1), rel_dx_in = r(12 * (rel_side - fx), 1), fz = NULL, fx = NULL, fb_type = NULL)]

# ---------- per-pitcher detail (explorer + coach card) -------------------------------------------
samp <- q("SELECT pitch_team AS team, pitcher, pitch_type, round(ivb,1) ivb, round(hb_arm,1) hb, round(release_speed,1) v,
                  round(plate_x,2) px, round(plate_z_norm,3) pz, round(rel_side_arm,2) rx, round(release_pos_z,2) rz,
                  is_whiff::INT w, is_swing::INT s,
                  CASE WHEN strikes = 2 THEN 'T' WHEN balls > strikes THEN 'B' WHEN balls = strikes THEN 'E' ELSE 'A' END AS c
           FROM pitch_features WHERE pfx_x IS NOT NULL ORDER BY game_pk, at_bat_number, pitch_number")
samp <- merge(samp, tp[, .(team, pitcher)], by = c("team", "pitcher"))
samp <- samp[, .SD[sample(.N, min(.N, 450))], by = .(team, pitcher)]
heat <- q("SELECT pitch_team AS team, pitcher, pitch_type, stand, floor(plate_x / 0.25) * 0.25 + 0.125 AS x_bin,
                  floor(plate_z_norm / 0.125) * 0.125 + 0.0625 AS z_bin, count(*) n, sum(is_swing::INT) swings, sum(is_whiff::INT) whiffs
           FROM pitch_features WHERE plate_x BETWEEN -2 AND 2 AND plate_z_norm BETWEEN -0.75 AND 1.75
           GROUP BY ALL ORDER BY ALL")
cus <- q("SELECT pitch_team AS team, pitcher, balls || '-' || strikes AS count_state, pitch_type, count(*) n FROM pitch_features
           GROUP BY ALL ORDER BY ALL")
reg <- q("WITH r AS (SELECT *, CASE WHEN in_zone AND plate_z_norm >= 0.67 THEN 'Zone-High'
                     WHEN in_zone AND plate_z_norm < 0.33 THEN 'Zone-Low'
                     WHEN in_zone THEN 'Zone-Middle' WHEN plate_z_norm > 1 THEN 'Chase-Above' WHEN plate_z_norm < 0 THEN 'Chase-Below'
                     ELSE 'Chase-Side' END AS region FROM pitch_features)
          SELECT pitch_team AS team, pitcher, pitch_type, region, count(*) n, round(avg(is_swing::INT), 4) swing_rate,
                 round(avg(is_whiff::INT) FILTER (WHERE is_swing), 4) whiff_rate FROM r GROUP BY ALL ORDER BY ALL")
# coach-card inputs (same rules as report/pitcher_card.Rmd, evaluated in the browser)
cg <- "CASE WHEN strikes = 2 THEN 'Two strikes' WHEN balls > strikes THEN 'Behind' WHEN balls = strikes THEN 'Even' ELSE 'Ahead' END"
bycnt <- q(sprintf("SELECT pitch_team AS team, pitcher, pitch_type, %s AS cnt, count(*) n, sum(is_swing::INT) sw, sum(is_whiff::INT) wh,
                           sum(in_zone::INT) iz FROM pitch_features GROUP BY ALL", cg))
fbhl <- q("SELECT pitch_team AS team, pitcher, pitch_type, count(*) FILTER (WHERE plate_z_norm IS NOT NULL) n,
                  count(*) FILTER (WHERE plate_z_norm >= 2/3) n_hi, sum(is_swing::INT) FILTER (WHERE plate_z_norm >= 2/3) sw_hi,
                  sum(is_whiff::INT) FILTER (WHERE plate_z_norm >= 2/3) wh_hi, count(*) FILTER (WHERE plate_z_norm < 1/3) n_lo,
                  sum(is_swing::INT) FILTER (WHERE plate_z_norm < 1/3) sw_lo, sum(is_whiff::INT) FILTER (WHERE plate_z_norm < 1/3) wh_lo,
                  count(*) FILTER (WHERE NOT in_zone) oz, sum(is_chase::INT) FILTER (WHERE NOT in_zone) ch
           FROM pitch_features GROUP BY ALL")
vh <- q("SELECT pitch_team AS team, pitcher, pitch_type, stand, count(*) n, sum(is_swing::INT) sw, sum(is_whiff::INT) wh,
                round(avg(xwoba_con) FILTER (WHERE type = 'X'), 3) xw FROM pitch_features GROUP BY ALL")
lg_up <- q("SELECT pitch_type, round(sum(is_whiff::INT) / sum(is_swing::INT), 4) w FROM pitch_features
             WHERE plate_z_norm >= 2/3 GROUP BY 1")

# ---------- season tracker: month by month (March folded into April: Mar 25-31 is a few games) ---
mon <- "CASE WHEN month(game_date) <= 4 THEN 4 ELSE month(game_date) END"
ps <- q(sprintf("SELECT s.game_pk, s.pitcher, s.pitch_type, sum(s.pred) pred_sum, count(*) n_pred, any_value(f.pitch_team) team,
                        any_value(%s) m FROM pitch_stuff s JOIN (SELECT DISTINCT game_pk, pitcher, pitch_team FROM pitch_features) f
                        USING (game_pk, pitcher) GROUP BY 1, 2, 3", sub("game_date", "s.game_date", mon)))
mu <- q("SELECT avg(pred) m FROM pitch_stuff")$m
sdv <- sd(q("SELECT pred FROM stuff_plus WHERE n >= 100")$pred)
sp <- function(pm) stuff_plus(pm, mu, sdv)
pm <- q(sprintf("SELECT pitch_team team, pitcher, pitch_type, %s m, count(*) n, avg(release_speed) velo, stddev_samp(release_speed) velo_sd,
                        avg(release_spin_rate) spin, avg(ivb) ivb, avg(hb_arm) hb, sum(is_swing::INT) sw, sum(is_whiff::INT) wh,
                        sum((is_whiff OR is_called_strike)::INT) csw, count(DISTINCT game_pk) g
                 FROM pitch_features GROUP BY ALL", mon))
pst <- ps[, .(pred = sum(pred_sum), np = sum(n_pred)), by = .(team, pitcher, pitch_type, m)]
pm <- merge(pm, pst, by = c("team", "pitcher", "pitch_type", "m"), all.x = TRUE)
tm <- q(sprintf("SELECT pitch_team team, %s m, count(*) n, sum(is_swing::INT) sw, sum(is_whiff::INT) wh,
                        sum((is_whiff OR is_called_strike)::INT) csw, count(*) FILTER (WHERE NOT in_zone) oz,
                        sum(is_chase::INT) FILTER (WHERE NOT in_zone) ch, avg(release_speed) FILTER (WHERE pitch_type = 'FF') ff_velo,
                        count(*) FILTER (WHERE pitch_type = 'FF') ff_n, stddev_samp(release_speed) FILTER (WHERE pitch_type = 'FF') ff_sd,
                        count(DISTINCT game_pk) g, round(100 * avg(-delta_run_exp), 3) rv100
                 FROM pitch_features GROUP BY ALL", mon))
tst <- ps[, .(pred = sum(pred_sum), np = sum(n_pred)), by = .(team, m)]
tm <- merge(tm, tst, by = c("team", "m"), all.x = TRUE)
tmt <- q(sprintf("SELECT pitch_team team, %s m, pitch_type, count(*) n, avg(release_speed) velo, sum(is_swing::INT) sw,
                         sum(is_whiff::INT) wh FROM pitch_features GROUP BY ALL", mon))
months <- 4:9
MLAB <- c("4" = "Mar–Apr", "5" = "May", "6" = "Jun", "7" = "Jul", "8" = "Aug", "9" = "Sep")
lgm <- tm[, .(n = sum(n), sw = sum(sw), wh = sum(wh), csw = sum(csw), oz = sum(oz), ch = sum(ch),
              ff_velo = sum(ff_velo * ff_n, na.rm = TRUE) / sum(ff_n), pred = sum(pred, na.rm = TRUE),
              np = sum(np, na.rm = TRUE)), by = m][order(m)]

# ---------- team summary for ranks ---------------------------------------------------------------
ts <- q("SELECT pitch_team team, count(*) n, count(DISTINCT pitcher) pitchers, sum(is_swing::INT) sw, sum(is_whiff::INT) wh,
                sum((is_whiff OR is_called_strike)::INT) csw, count(*) FILTER (WHERE NOT in_zone) oz,
                sum(is_chase::INT) FILTER (WHERE NOT in_zone) ch, avg(release_speed) FILTER (WHERE pitch_type = 'FF') ff_velo,
                round(100 * avg(-delta_run_exp), 3) rv100 FROM pitch_features GROUP BY 1")
tsp <- ps[, .(pred = sum(pred_sum) / sum(n_pred)), by = team]
ts <- merge(ts, tsp, by = "team")
ts <- merge(ts, tp[, .(listed = .N), by = team], by = "team", all.x = TRUE)
ts[, `:=`(whiff = r(wh / sw, 4), csw_rate = r(csw / n, 4), chase = r(ch / oz, 4), ff_velo = r(ff_velo, 2),
          stuff = r(100 + 10 * (pred - mu) / sdv, 1))]
teams <- lapply(sort(ts$team), function(t) {
  x <- ts[team == t]
  list(team = t, name = teams_cfg[[t]]$name, color = teams_cfg[[t]]$color, pitches = x$n, pitchers = x$pitchers,
       listed = x$listed, swings = x$sw, whiff = x$whiff, csw = x$csw_rate, chase = x$chase, ff_velo = x$ff_velo,
       stuff = x$stuff, rv100 = x$rv100)
})
stopifnot(length(teams) == 30, all(ts$team %in% names(teams_cfg)))
wj(list(default = "KC", months = unname(MLAB), teams = teams), file.path(OUT, "teams.json"))

# ---------- write per team / per pitcher ----------------------------------------------------------
unlink(file.path(OUT, "t"), recursive = TRUE)
pick <- function(d, t, id) d[team == t & pitcher == id, !c("team", "pitcher")]
for (t in sort(unique(tp$team))) {
  pl <- tp[team == t]
  idx <- lapply(seq_len(nrow(pl)), function(i) {
    id <- pl$pitcher[i]
    list(id = id, name = pl$name[i], throws = pl$throws[i], n = pl$n[i], games = pl$games[i], starts = pl$starts[i],
         d0 = as.character(pl$d0[i]), d1 = as.character(pl$d1[i]), arsenal = pick(ars, t, id)[order(-n)])
  })
  wj(list(team = t, min_pitches = MIN_PITCHES, pitchers = idx), file.path(OUT, "t", t, "index.json"))
  for (i in seq_len(nrow(pl))) {
    id <- pl$pitcher[i]
    fb <- fbref[team == t & pitcher == id]$fb_type
    wj(list(pitches = cols(pick(samp, t, id)), heat = cols(pick(heat, t, id)), counts = pick(cus, t, id),
            regions = pick(reg, t, id),
            card = list(bycnt = cols(pick(bycnt, t, id)), loc = pick(fbhl, t, id), vh = cols(pick(vh, t, id)),
                        fb = if (length(fb)) fb else NULL, lg_up = lg_up[pitch_type %in% fb]$w)),
       file.path(OUT, "t", t, "p", paste0(id, ".json")))
  }
  # season: staff months, staff x pitch type months, pitchers (300+) x pitch type months
  tmm <- tm[team == t][order(m)]
  pmt <- pm[team == t & pitcher %in% pl$pitcher]
  season <- list(team = t, months = unname(MLAB),
    staff = lapply(months, function(mm) {
      x <- tmm[m == mm]; l <- lgm[m == mm]
      list(m = MLAB[[as.character(mm)]], n = x$n, g = x$g, sw = x$sw, wh = x$wh, csw = x$csw, oz = x$oz, ch = x$ch,
           ff_velo = r(x$ff_velo, 2), ff_n = x$ff_n, ff_sd = r(x$ff_sd, 2), stuff = r(100 + 10 * (x$pred / x$np - mu) / sdv, 1),
           rv100 = x$rv100,
           lg = list(whiff = r(l$wh / l$sw, 4), csw = r(l$csw / l$n, 4), chase = r(l$ch / l$oz, 4), ff_velo = r(l$ff_velo, 2),
                     stuff = r(100 + 10 * (l$pred / l$np - mu) / sdv, 1)))
    }),
    mix = cols(tmt[team == t, .(m = MLAB[as.character(m)], pitch_type, n, velo = r(velo, 2), sw, wh)]),
    pitchers = lapply(seq_len(nrow(pl)), function(i) {
      x <- pmt[pitcher == pl$pitcher[i]][order(m, -n)]
      list(id = pl$pitcher[i], name = pl$name[i], throws = pl$throws[i], n = pl$n[i],
           rows = cols(x[, .(m = MLAB[as.character(m)], pitch_type, n, g, velo = r(velo, 2), velo_sd = r(velo_sd, 2),
                             spin = round(spin), ivb = r(ivb, 1), hb = r(hb, 1), sw, wh, csw,
                             stuff = ifelse(is.na(np) | np < 1, NA, sp(pred / np)))]))
    }))
  wj(season, file.path(OUT, "t", t, "season.json"))
}
dbDisconnect(con, shutdown = TRUE)
cat("teams:", length(unique(tp$team)), " pitcher files:", nrow(tp), " mu/sd:", mu, sdv, "\n")
