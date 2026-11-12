# 03_analysis.R -- research analyses + JSON exports for the static site.
# Every number written here is computed from data/statcast.duckdb (Baseball Savant pitch-level data).
suppressPackageStartupMessages({ library(DBI); library(duckdb); library(data.table); library(jsonlite) })
con <- dbConnect(duckdb(), dbdir = Sys.getenv("DB_PATH", "data/statcast.duckdb"), read_only = TRUE)
q <- function(sql) as.data.table(dbGetQuery(con, sql))
out <- "site/data"; dir.create(out, recursive = TRUE, showWarnings = FALSE)
wj <- function(x, f) write_json(x, file.path(out, f), auto_unbox = TRUE, digits = 4, na = "null", dataframe = "rows")
MIN_PITCHES <- 300   # Royals pitchers shown in the explorer

meta <- q("SELECT min(game_date) first_day, max(game_date) last_day, count(*) n_pitches,
                  count(DISTINCT game_pk) n_games, count(*) FILTER (WHERE is_royals) n_royals,
                  count(DISTINCT pitcher) FILTER (WHERE is_royals) n_royals_pitchers
           FROM pitch_features")
meta[, built := format(Sys.time(), "%Y-%m-%d")]

# ---------- 1. Location-adjusted VAA (four-seamers) --------------------------------------
ff <- q("SELECT pitcher, player_name, is_royals, vaa, plate_z_norm, release_pos_z, release_extension,
                is_swing, is_whiff, xrv FROM pitch_features
         WHERE pitch_type = 'FF' AND vaa IS NOT NULL AND plate_z_norm BETWEEN -0.5 AND 1.5")
vaa_fit <- lm(vaa ~ plate_z_norm, data = ff)          # VAA mostly reflects where the pitch is located
ff[, vaa_adj := resid(vaa_fit)]                        # + = flatter than expected for that height
pit_vaa <- ff[, .(n = .N, vaa = mean(vaa), vaa_adj = mean(vaa_adj), rel_z = mean(release_pos_z),
                  ext = mean(release_extension),
                  high_n = sum(plate_z_norm >= 0.67),
                  high_share = mean(plate_z_norm >= 0.67),
                  high_whiff = sum(is_whiff & plate_z_norm >= 0.67) / pmax(1, sum(is_swing & plate_z_norm >= 0.67)),
                  low_whiff  = sum(is_whiff & plate_z_norm < 0.33) / pmax(1, sum(is_swing & plate_z_norm < 0.33))),
              by = .(pitcher, player_name, is_royals)][n >= 200]
# league evidence: high-zone FF whiff% by VAA-adj quintile
ff[, vaa_q := cut(vaa_adj, quantile(vaa_adj, 0:5 / 5), include.lowest = TRUE, labels = paste0("Q", 1:5))]
vaa_league <- ff[plate_z_norm >= 0.67, .(swings = sum(is_swing), whiff = sum(is_whiff) / sum(is_swing),
                                          vaa_adj_mid = median(vaa_adj)), by = vaa_q][order(vaa_q)]
vaa_league_low <- ff[plate_z_norm < 0.33, .(whiff = sum(is_whiff) / sum(is_swing)), by = vaa_q][order(vaa_q)]
vaa_league[, low_whiff := vaa_league_low$whiff]
wj(list(coef = coef(vaa_fit), r2 = summary(vaa_fit)$r.squared, league_quintiles = vaa_league,
        pitchers = pit_vaa), "vaa.json")

# ---------- 2. Stuff+ (from 02_stuff_model.R) -------------------------------------------
stuff <- fread("data/out/stuff_plus.csv")
val <- fromJSON("data/out/stuff_validation.json")
imp <- fread("data/out/stuff_importance.csv")
# sanity: does Stuff+ line up with whiff rate at the pitcher-pitch level? (min 100 pitches)
wh <- q("SELECT pitcher, pitch_type, count(*) n, avg(is_whiff::INT) FILTER (WHERE is_swing) whiff,
                avg((is_whiff OR is_called_strike)::INT) csw
         FROM pitch_features GROUP BY ALL HAVING count(*) >= 100")
sw <- merge(stuff, wh, by = c("pitcher", "pitch_type", "n"))
val$cor_stuff_whiff <- cor(sw$stuff_plus, sw$whiff); val$cor_stuff_csw <- cor(sw$stuff_plus, sw$csw)
val$n_pitch_types_whiff <- nrow(sw)
scatter_lg <- sw[, .(pitch_type, pitch_group, stuff_plus, whiff, n, royals = is_royals, name = player_name)]
wj(list(validation = val, importance = imp, league = scatter_lg), "stuff.json")

# ---------- 3. Tunneling: consecutive-pitch pairs -----------------------------------------
pairs_lg <- q("SELECT prev_type, pitch_type, sum(n) n,
                 sum(tunnel_in*n)/sum(n) tunnel_in, sum(plate_in*n)/sum(n) plate_in
               FROM sequences GROUP BY ALL HAVING sum(n) > 2000")
tun_bins <- q("WITH s AS (
     SELECT p.pitch_type, p.is_swing, p.is_whiff, p.is_chase, p.in_zone,
       sqrt(power(p.tun_x - lag(p.tun_x) OVER w, 2) + power(p.tun_z - lag(p.tun_z) OVER w, 2)) * 12 AS tun,
       lag(p.pitch_group) OVER w AS prev_group, p.pitch_group
     FROM pitch_features p WINDOW w AS (PARTITION BY game_pk, at_bat_number ORDER BY pitch_number))
   SELECT least(floor(tun / 2) * 2, 20) AS tunnel_bin, count(*) n,
          avg(is_whiff::INT) FILTER (WHERE is_swing) whiff, avg(is_chase::INT) FILTER (WHERE NOT in_zone) chase
   FROM s WHERE prev_group = 'Fastball' AND pitch_group = 'Breaking' AND tun IS NOT NULL
   GROUP BY 1 ORDER BY 1")
roy_pairs <- q("SELECT s.pitcher, a.player_name, prev_type, s.pitch_type, n, whiff_rate, chase_rate, tunnel_in, plate_in,
                       plate_in / NULLIF(tunnel_in, 0) AS split_ratio, rv100
                FROM sequences s
                JOIN (SELECT pitcher, any_value(player_name) player_name
                      FROM pitch_features WHERE is_royals GROUP BY 1) a USING (pitcher)
                WHERE is_royals AND n >= 40 AND prev_type <> s.pitch_type")
wj(list(league_bins = tun_bins, league_pairs = pairs_lg, royals = roy_pairs), "tunnel.json")

# ---------- 4. Count leverage usage with empirical-Bayes shrinkage ------------------------
K_RV <- 250  # prior weight (pitches) toward league average for the same pitch type & count group
cu <- q("SELECT pitcher, any_value(player_name) player_name, pitch_type,
           CASE WHEN strikes = 2 THEN 'Two strikes' WHEN balls > strikes THEN 'Behind'
                WHEN balls = strikes THEN 'Even' ELSE 'Ahead' END AS cnt,
           count(*) n, sum(xrv) xrv_sum, sum(is_whiff::INT) whiffs, sum(is_swing::INT) swings
         FROM pitch_features WHERE is_royals GROUP BY ALL")
lg <- q("SELECT pitch_type, CASE WHEN strikes = 2 THEN 'Two strikes' WHEN balls > strikes THEN 'Behind'
                WHEN balls = strikes THEN 'Even' ELSE 'Ahead' END AS cnt,
           avg(xrv) lg_xrv FROM pitch_features GROUP BY ALL")
cu <- merge(cu, lg, by = c("pitch_type", "cnt"), all.x = TRUE)
cu[, `:=`(xrv100_raw = 100 * xrv_sum / n,
          xrv100_shrunk = 100 * (xrv_sum + K_RV * lg_xrv) / (n + K_RV),
          lg_xrv100 = 100 * lg_xrv)]
cu[, usage := n / sum(n), by = .(pitcher, cnt)]
wj(cu[, .(pitcher, player_name, pitch_type, cnt, n, usage, xrv100_raw, xrv100_shrunk, lg_xrv100, whiffs, swings)], "counts.json")

# ---------- 5. Fatigue: four-seam velo by pitch count (starters) -------------------------
fat <- q("WITH g AS (
     SELECT pitcher, game_pk, row_number() OVER (PARTITION BY pitcher, game_pk ORDER BY at_bat_number, pitch_number) pc,
            pitch_type, release_speed, player_name, count(*) OVER (PARTITION BY pitcher, game_pk) game_n
     FROM pitch_features WHERE is_royals),
   base AS (SELECT pitcher, game_pk, avg(release_speed) b FROM g WHERE pc <= 25 AND pitch_type IN ('FF','SI') GROUP BY ALL)
   SELECT g.pitcher, any_value(player_name) player_name, least(floor((pc - 1) / 15) * 15 + 1, 106) AS pc_bin,
          count(*) n, avg(release_speed - b) velo_delta
   FROM g JOIN base USING (pitcher, game_pk)
   WHERE game_n >= 70 AND pitch_type IN ('FF','SI') GROUP BY ALL HAVING count(*) >= 20 ORDER BY 1, 3")
wj(fat, "fatigue.json")

# ---------- 6. Explorer payload: per-pitcher arsenal + samples ---------------------------
ars <- q("SELECT * FROM arsenal")
ars <- merge(ars, stuff[, .(pitcher, pitch_type, stuff_plus)], by = c("pitcher", "pitch_type"), all.x = TRUE)
vaa_pt <- q("SELECT pitcher, pitch_type, avg(vaa) vaa FROM pitch_features WHERE is_royals GROUP BY ALL")
ars <- merge(ars, vaa_pt, by = c("pitcher", "pitch_type"), all.x = TRUE)
# release offset of each pitch vs that pitcher's primary fastball (inches)
fbref <- q("SELECT pitcher, avg(release_pos_z) fz, avg(rel_side_arm) fx FROM pitch_features p
            WHERE is_royals AND pitch_type = (SELECT fb_type FROM (SELECT pitch_type fb_type, count(*) c FROM pitch_features q
              WHERE q.pitcher = p.pitcher AND pitch_type IN ('FF','SI','FC') GROUP BY 1 ORDER BY c DESC LIMIT 1)) GROUP BY 1")
ars <- merge(ars, fbref, by = "pitcher", all.x = TRUE)
ars[, `:=`(rel_dz_in = round(12 * (rel_height - fz), 1), rel_dx_in = round(12 * (rel_side - fx), 1), fz = NULL, fx = NULL)]
tot <- ars[, .(n = sum(n)), by = .(pitcher, player_name, p_throws)][n >= MIN_PITCHES][order(-n)]
samp <- q(sprintf("SELECT pitcher, pitch_type, round(ivb,1) ivb, round(hb_arm,1) hb, round(release_speed,1) v,
                   round(plate_x,2) px, round(plate_z_norm,3) pz, round(rel_side_arm,2) rx, round(release_pos_z,2) rz,
                   is_whiff::INT w, is_swing::INT s
                   FROM pitch_features WHERE is_royals AND pitcher IN (%s) AND pfx_x IS NOT NULL
                   USING SAMPLE reservoir(100000 ROWS) REPEATABLE (7)", paste(tot$pitcher, collapse = ",")))
samp <- samp[, .SD[sample(.N, min(.N, 450))], by = pitcher]
heat <- q(sprintf("SELECT pitcher, pitch_type, x_bin, z_bin, sum(n) n, sum(swings) swings, sum(whiffs) whiffs
                   FROM location_grid WHERE pitcher IN (%s) GROUP BY ALL", paste(tot$pitcher, collapse = ",")))
reg <- q("SELECT pitcher, pitch_type, region, n, swing_rate, whiff_rate FROM zone_region WHERE is_royals")
lgreg <- q("SELECT pitch_type, region, sum(n) n, sum(swing_rate*n)/sum(n) swing_rate FROM zone_region GROUP BY ALL")
cus <- q("SELECT pitcher, count_state, pitch_type, n FROM count_usage")
games <- q("SELECT pitcher, count(DISTINCT game_pk) g FROM pitch_features WHERE is_royals GROUP BY 1")
tot <- merge(tot, games, by = "pitcher")[order(-n)]
explorer <- lapply(seq_len(nrow(tot)), function(i) {
  pid <- tot$pitcher[i]
  list(id = pid, name = tot$player_name[i], throws = tot$p_throws[i], n = tot$n[i], games = tot$g[i],
       arsenal = ars[pitcher == pid][order(-n)],
       pitches = samp[pitcher == pid, -"pitcher"],
       heat = heat[pitcher == pid, -"pitcher"],
       counts = cus[pitcher == pid, -"pitcher"],
       regions = reg[pitcher == pid, -"pitcher"])
})
wj(explorer, "explorer.json")
wj(list(meta = meta, league_regions = lgreg), "meta.json")

# ---------- 7. Platoon by pitch (shrunk) + case-study series used by the recommendations ----
K_PL <- 250
plat <- q(sprintf("WITH lg AS (SELECT pitch_type, stand, avg(xrv) l FROM pitch_features GROUP BY ALL)
  SELECT f.pitcher, any_value(player_name) player_name, f.pitch_type, f.stand, count(*) n,
         100 * avg(xrv) xrv100, 100 * (sum(xrv) + %d * any_value(l)) / (count(*) + %d) xrv100_shrunk,
         avg(is_whiff::INT) FILTER (WHERE is_swing) whiff, count(*) FILTER (WHERE is_swing) swings,
         avg(xwoba_con) FILTER (WHERE type = 'X') xwoba_con, count(*) FILTER (WHERE type = 'X') bip
  FROM pitch_features f JOIN lg USING (pitch_type, stand) WHERE is_royals GROUP BY ALL HAVING count(*) >= 30", K_PL, K_PL))
monthly <- q("SELECT pitcher, any_value(player_name) player_name, pitch_type, date_trunc('month', game_date) AS month, count(*) n,
         avg((plate_z_norm < 0)::INT) below_share, avg((in_zone AND plate_z_norm BETWEEN 0.33 AND 0.67)::INT) middle_share,
         avg((plate_z_norm >= 0.67)::INT) high_share,
         100 * avg(xrv) xrv100, avg(is_whiff::INT) FILTER (WHERE is_swing) whiff
  FROM pitch_features WHERE is_royals GROUP BY ALL HAVING count(*) >= 15 ORDER BY 1, 3, 4")
halves <- q("SELECT pitcher, pitch_type, game_date >= DATE '2026-07-01' AS second_half, count(*) n,
         avg((plate_z_norm < 0)::INT) below_share, avg((in_zone AND plate_z_norm BETWEEN 0.33 AND 0.67)::INT) middle_share,
         100 * avg(xrv) xrv100 FROM pitch_features WHERE is_royals GROUP BY ALL")
regions_r <- q("SELECT pitcher, any_value(player_name) player_name, pitch_type, region, count(*) n, avg(is_swing::INT) swing_rate,
         avg(is_whiff::INT) FILTER (WHERE is_swing) whiff, count(*) FILTER (WHERE is_swing) swings, 100 * avg(xrv) xrv100
  FROM (SELECT *, CASE WHEN in_zone AND plate_z_norm >= 0.67 THEN 'Zone-High' WHEN in_zone AND plate_z_norm < 0.33 THEN 'Zone-Low'
                       WHEN in_zone THEN 'Zone-Middle' WHEN plate_z_norm > 1 THEN 'Chase-Above' WHEN plate_z_norm < 0 THEN 'Chase-Below'
                       ELSE 'Chase-Side' END region FROM pitch_features WHERE is_royals) GROUP BY ALL")
leader <- stuff[is_royals == TRUE & n >= 100][order(-stuff_plus)]
wj(list(platoon = plat, monthly = monthly, halves = halves, regions = regions_r, k_platoon = K_PL, k_counts = K_RV,
        stuff_leader = leader[, .(pitcher, player_name, pitch_type, n, stuff_plus, rv100, xrv100)]), "cases.json")
dbDisconnect(con, shutdown = TRUE)
message("exported: ", paste(list.files(out), collapse = ", "))
