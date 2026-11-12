# 02_gameplan.R -- series game-plan generator.
# For each Royals starter (8+ starts in 2026) x each opponent lineup, score every pitch in his real arsenal
# in each of 13 locations and 12 counts against each hitter with the matchup model (+ shrunk hitter residual),
# then express it as runs per 100 pitches BETTER/WORSE THAN HIS USUAL MIX in that count vs that hitter.
# Output: site/gameplan_data.json (+ .js wrapper so the page also works from file://).
# Run from gameplan/:  Rscript R/02_gameplan.R
suppressPackageStartupMessages({ library(DBI); library(duckdb); library(data.table); library(xgboost); library(jsonlite) })
source("R/lib.R")
OPPONENTS <- list(   # 2027 Royals schedule, first four series (AP / Royals release, July 2026)
  list(team = "MIN", name = "Minnesota Twins",    series = "Mar 25, 27-28, 2027 · vs MIN at Kauffman Stadium (Opening Day)", opener = TRUE),
  list(team = "CWS", name = "Chicago White Sox",  series = "Mar 29-31, 2027 · vs CWS at Kauffman Stadium", opener = FALSE),
  list(team = "STL", name = "St. Louis Cardinals", series = "Apr 1, 3-4, 2027 · at STL", opener = FALSE),
  list(team = "LAA", name = "Los Angeles Angels", series = "Apr 5-7, 2027 · at LAA", opener = FALSE))
FEATURED <- 608379L   # Michael Wacha: tied for most 2026 starts; the printable plan is built for him
MIN_STARTS <- 8; MIN_TYPE_SHARE <- 0.04; MIN_TYPE_N <- 25; FEASIBLE <- 0.06; HABIT <- 0.10

con <- dbConnect(duckdb(), dbdir = "work/gameplan.duckdb", read_only = TRUE)
starters <- as.data.table(dbGetQuery(con, sprintf("SELECT * FROM royals_starters WHERE starts >= %d ORDER BY pitcher = %d DESC, starts DESC, player_name", MIN_STARTS, FEATURED)))
kc <- as.data.table(dbGetQuery(con, sprintf("
  SELECT pitcher, stand, pitch_type, pitch_group, count_state, region, z, balls, strikes, release_speed, ivb, hb_arm,
         release_spin_rate, release_extension, arm_angle, release_pos_z, vaa, velo_diff, ivb_diff, hb_diff, xrv
  FROM mp WHERE pitch_team = 'KC' AND pitcher IN (%s)", paste(starters$pitcher, collapse = ","))))
cnt_w <- as.data.table(dbGetQuery(con, "SELECT balls, strikes, count_state, count(*) n FROM mp GROUP BY ALL"))
state_w <- cnt_w[, .(w = sum(n)), by = count_state][, w := w / sum(w)]
cnt_w[, w := n / sum(n), by = count_state]
cent <- as.data.table(dbGetQuery(con, "SELECT * FROM region_centroid"))
bpa <- as.data.table(dbGetQuery(con, "SELECT * FROM batter_team_pa"))
dbDisconnect(con, shutdown = TRUE)
players <- fread("../data/raw/players.csv", encoding = "UTF-8")
pname <- function(id) { n <- players$full_name[match(id, players$id)]; ifelse(is.na(n), paste0("#", id), n) }

fin <- readRDS("work/matchup_final.rds"); prof <- fin$prof; res <- fin$res
model <- xgb.load("work/matchup_xgb.ubj")
qual <- prof[pitches >= 1000]                                # percentile reference: regulars
pctl <- function(f, v) round(100 * ecdf(qual[[f]])(v))

# ---------- lineups: top 9 by 2026 PA with that team, ordered by median batting-order slot ----------
lineups <- rbindlist(lapply(OPPONENTS, function(o) {
  b <- bpa[bat_team == o$team][order(-pa)][1:9]
  b[order(med_slot, -pa)][, .(team = o$team, batter, pa, games, med_slot, pa_as_lhh, pa_as_rhh, order = .I)]
}))
lineups[, name := pname(batter)]
lineups[, switch := pa_as_lhh > 0.1 * pa & pa_as_rhh > 0.1 * pa]

# ---------- each starter's arsenal vs each batter side ----------
TRAITS <- c("release_speed","ivb","hb_arm","release_spin_rate","release_extension","arm_angle","release_pos_z","velo_diff","ivb_diff","hb_diff")
ars <- kc[, c(list(n = .N), lapply(.SD, mean, na.rm = TRUE)), by = .(pitcher, stand, pitch_type, pitch_group), .SDcols = TRAITS]
ars[, share := n / sum(n), by = .(pitcher, stand)]
ars <- ars[share >= MIN_TYPE_SHARE & n >= MIN_TYPE_N]
# VAA depends on pitch height: per pitcher x pitch type x side, vaa = a + b * z  (z = height in zone units)
vfit <- kc[, { f <- coef(lm(vaa ~ z)); .(va = f[1], vb = f[2]) }, by = .(pitcher, stand, pitch_type)]
ars <- merge(ars, vfit, by = c("pitcher","stand","pitch_type"))
regf <- kc[, .N, by = .(pitcher, stand, pitch_type, region)][, freq := N / sum(N), by = .(pitcher, stand, pitch_type)]
use_state <- kc[, .N, by = .(pitcher, stand, count_state, pitch_type)][, u := N / sum(N), by = .(pitcher, stand, count_state)]

# ---------- scoring grid ----------
hit <- unique(lineups[, .(batter, switch, pa_as_lhh, pa_as_rhh)])
grid <- rbindlist(lapply(seq_len(nrow(starters)), function(i) {
  s <- starters[i]
  h <- copy(hit)[, stand := fifelse(switch, fifelse(s$p_throws == "R", "L", "R"), fifelse(pa_as_lhh > pa_as_rhh, "L", "R"))]
  g <- merge(h[, .(batter, stand)], ars[pitcher == s$pitcher], by = "stand", allow.cartesian = TRUE)
  g <- g[, .(region = ZONE_REGIONS), by = names(g)]
  g <- merge(g, cent[, .(region, x_in, z)], by = "region")
  g[, .(balls = cnt_w$balls, strikes = cnt_w$strikes, count_state = cnt_w$count_state, cw = cnt_w$w), by = names(g)]
}))
grid[, p_throws := starters$p_throws[match(pitcher, starters$pitcher)]]
grid[, `:=`(vaa = va + vb * z, same_side = as.integer(p_throws == stand), stand_l = as.integer(stand == "L"),
            pg = match(pitch_group, c("Fastball","Breaking","Offspeed")) - 1L, band = loc_band(region, z))]
grid <- attach_profiles(grid, prof)
grid[, pred := predict(model, xgb.DMatrix(as.matrix(grid[, c(PITCH_FEATS, HITTER_FEATS), with = FALSE]), missing = NA))]
grid <- merge(grid, res[, .(batter, pitch_group, band, adj)], by = c("batter","pitch_group","band"), all.x = TRUE)
grid[is.na(adj), adj := 0]
grid[, v := pred + adj]
message("scored ", nrow(grid), " pitch x location x count x hitter x pitcher rows")

# value per count state, then relative to his usual mix in that state vs this hitter
st <- grid[, .(v = sum(v * cw) / sum(cw)), by = .(pitcher, batter, stand, pitch_type, pitch_group, region, count_state)]
st <- merge(st, regf[, .(pitcher, stand, pitch_type, region, freq)], by = c("pitcher","stand","pitch_type","region"), all.x = TRUE)
st[is.na(freq), freq := 0]
st <- merge(st, use_state[, .(pitcher, stand, count_state, pitch_type, u)], by = c("pitcher","stand","count_state","pitch_type"), all.x = TRUE)
st[is.na(u), u := 0]
base <- st[, .(base = sum(v * u * freq) / sum(u * freq)), by = .(pitcher, batter, count_state)]
st <- merge(st, base, by = c("pitcher","batter","count_state"))
st[, rel := 100 * (v - base)]                               # runs / 100 pitches vs his usual mix (pitcher's view, + good)
st <- merge(st, state_w, by = "count_state")
allc <- st[, .(rel = sum(rel * w), freq = first(freq)), by = .(pitcher, batter, stand, pitch_type, pitch_group, region)]

# ---------- hitter profile cards ----------
PF <- list(c("h_bat_speed","Bat speed","mph",1), c("h_swing_length","Swing length","ft",1), c("h_attack_angle","Attack angle","°",0),
           c("h_chase","Chase","%",0), c("h_zone_whiff","Zone whiff","%",0), c("h_whiff_fb","Whiff vs FB","%",0),
           c("h_whiff_br","Whiff vs BRK","%",0), c("h_whiff_os","Whiff vs OFF","%",0), c("h_xwobacon","xwOBAcon","",3))
hprof <- function(b) { r <- prof[batter == b]
  lapply(PF, function(p) { v <- r[[p[1]]]; list(key = p[1], label = p[2], value = if (p[3] == "%") round(100 * v, 1) else round(v, as.integer(p[4])),
                                             unit = p[3], pctl = pctl(p[1], v)) }) }

REG_SHORT <- c("Up-In"="up and in","Up-Middle"="up, middle","Up-Away"="up and away","Mid-In"="middle-in","Mid-Middle"="middle-middle",
               "Mid-Away"="middle-away","Low-In"="low and in","Low-Middle"="low, middle","Low-Away"="low and away","Above zone"="above the zone",
               "Off plate in"="off the plate in","Off plate away"="off the plate away","Below zone"="below the zone")
PNAME <- c(FF="4-seamer",SI="sinker",FC="cutter",SL="slider",ST="sweeper",SV="slurve",CU="curveball",KC="knuckle curve",CH="changeup",FS="splitter",FO="forkball",KN="knuckleball")
lbl <- function(pt, rg) paste(PNAME[pt], REG_SHORT[rg])
r1 <- function(x) round(x, 1)

plans <- list()
for (i in seq_len(nrow(starters))) for (o in OPPONENTS) {
  s <- starters[i]; L <- lineups[team == o$team]
  hitters <- lapply(seq_len(nrow(L)), function(j) {
    b <- L$batter[j]; a <- allc[pitcher == s$pitcher & batter == b]; ss <- st[pitcher == s$pitcher & batter == b]
    feas <- a[freq >= FEASIBLE][order(-rel)]
    leverage <- lapply(c("First pitch","Ahead","Even","Behind"), function(cs) {
      x <- ss[count_state == cs & freq >= FEASIBLE & u >= 0.05][order(-rel)][1]
      list(state = cs, pitch = x$pitch_type, region = x$region, rel = r1(x$rel)) })
    habits <- a[freq >= HABIT][order(rel)]
    list(batter = b, name = L$name[j], order = L$order[j], pa = L$pa[j], stand = a$stand[1], switch = L$switch[j],
         profile = hprof(b),
         attack = lapply(1:min(3, nrow(feas)), function(k) list(pitch = feas$pitch_type[k], region = feas$region[k], rel = r1(feas$rel[k]), freq = round(feas$freq[k], 3))),
         avoid  = lapply(1:min(2, nrow(habits)), function(k) list(pitch = habits$pitch_type[k], region = habits$region[k], rel = r1(habits$rel[k]), freq = round(habits$freq[k], 3))),
         leverage = leverage,
         grid = lapply(split(a, by = "pitch_type"), function(x) { x <- x[match(ZONE_REGIONS, region)]; list(rel = r1(x$rel), freq = round(x$freq, 3)) }))
  })
  # ---- headline takeaways (lineup-wide) ----
  a <- allc[pitcher == s$pitcher & batter %in% L$batter]
  lw <- a[freq >= FEASIBLE, .(rel = mean(rel), n_h = .N, best = paste(pname(batter[order(-rel)][1:2]), collapse = " and ")), by = .(pitch_type, region)][n_h >= 5][order(-rel)]
  hb <- a[freq >= HABIT, .(rel = mean(rel), n_h = .N, freq = mean(freq), worst = paste(pname(batter[order(rel)][1:2]), collapse = " and ")), by = .(pitch_type, region)][n_h >= 5][order(rel)]
  ah <- st[pitcher == s$pitcher & batter %in% L$batter & count_state == "Ahead" & freq >= FEASIBLE & u >= 0.05]
  pa <- ah[, .SD[which.max(rel)], by = batter][, .(n = .N, rel = mean(rel)), by = .(pitch_type, region)][order(-n, -rel)]
  t1 <- sprintf("Attack: %s is his best option across this lineup, worth %+.1f runs per 100 pitches over his usual mix, and it plays best against %s.",
                 lbl(lw$pitch_type[1], lw$region[1]), lw$rel[1], lw$best[1])
  t2 <- sprintf("Avoid: his most costly habit against this group is the %s (%.0f%% of his %ss go there), at %+.1f runs per 100 pitches. It hurts most against %s.",
                 lbl(hb$pitch_type[1], hb$region[1]), 100 * hb$freq[1], PNAME[hb$pitch_type[1]], hb$rel[1], hb$worst[1])
  t3 <- sprintf("Put-away: when he's ahead in the count, the %s is the model's best finisher for %d of 9 hitters (%+.1f runs per 100 pitches vs his usual mix when ahead).",
                 lbl(pa$pitch_type[1], pa$region[1]), pa$n[1], pa$rel[1])
  plans[[length(plans) + 1]] <- list(pitcher = s$pitcher, team = o$team, takeaways = c(t1, t2, t3),
    lineup_best = lapply(1:min(5, nrow(lw)), function(k) list(pitch = lw$pitch_type[k], region = lw$region[k], rel = r1(lw$rel[k]))),
    lineup_avoid = lapply(1:min(3, nrow(hb)), function(k) list(pitch = hb$pitch_type[k], region = hb$region[k], rel = r1(hb$rel[k]), freq = round(hb$freq[k], 3))),
    hitters = hitters)
}

# ---------- what the model learned: partial dependence on single hitter traits ----------
pd_sets <- list(
  list(id = "ff_up",  label = "4-seamers in the upper third or just above the zone", filt = quote(pitch_type == "FF" & region %in% c("Up-In","Up-Middle","Up-Away","Above zone"))),
  list(id = "brk_low", label = "Breaking balls below the zone", filt = quote(pitch_group == "Breaking" & region == "Below zone")),
  list(id = "fb_low", label = "Fastballs (4-seam/sinker) in the lower third", filt = quote(pitch_type %in% c("FF","SI") & region %in% c("Low-In","Low-Middle","Low-Away"))),
  list(id = "os_below", label = "Changeups/splitters below the zone", filt = quote(pitch_type %in% c("CH","FS") & region == "Below zone")))
pd_feats <- list(c("h_swing_length","Swing length"), c("h_bat_speed","Bat speed"), c("h_chase","Chase rate"), c("h_attack_angle","Attack angle"))
con <- dbConnect(duckdb(), dbdir = "work/gameplan.duckdb", read_only = TRUE)
lg <- as.data.table(dbGetQuery(con, "SELECT * FROM mp USING SAMPLE 25%"))
dbDisconnect(con, shutdown = TRUE)
lg[, `:=`(pg = match(pitch_group, c("Fastball","Breaking","Offspeed")) - 1L, stand_l = as.integer(stand == "L"))]
lp <- league_profile(prof)
set.seed(7)
learned <- list()
for (ps in pd_sets) {
  x <- lg[eval(ps$filt)]; x <- x[sample(.N, min(.N, 12000))]
  xe <- attach_profiles(lg[eval(ps$filt)], prof)          # empirical check uses all pitches in the 25% sample
  for (pf in pd_feats) {
    q <- quantile(qual[[pf[1]]], c(.125, .875))            # median of bottom / top quartile of regulars
    vals <- sapply(q, function(qv) { y <- copy(x); for (f in HITTER_FEATS) set(y, NULL, f, lp[[f]]); set(y, NULL, pf[1], qv)
      100 * mean(predict(model, xgb.DMatrix(as.matrix(y[, c(PITCH_FEATS, HITTER_FEATS), with = FALSE]), missing = NA))) })
    cut <- quantile(qual[[pf[1]]], c(.25, .75))
    emp <- c(100 * mean(xe[get(pf[1]) <= cut[1]]$xrv), 100 * mean(xe[get(pf[1]) >= cut[2]]$xrv))
    learned[[length(learned) + 1]] <- list(set = ps$id, set_label = ps$label, feature = pf[1], feature_label = pf[2],
      low_q = signif(q[[1]], 3), high_q = signif(q[[2]], 3), model_low = round(vals[[1]], 2), model_high = round(vals[[2]], 2),
      emp_low = round(emp[1], 2), emp_high = round(emp[2], 2), n_emp_low = nrow(xe[get(pf[1]) <= cut[1]]), n_emp_high = nrow(xe[get(pf[1]) >= cut[2]]))
  }
}

val <- fromJSON("out/validation.json")
pit <- lapply(seq_len(nrow(starters)), function(i) { s <- starters[i]
  list(id = s$pitcher, name = sub("^(.*), (.*)$", "\\2 \\1", s$player_name), throws = s$p_throws, starts = s$starts,
       arsenal = lapply(split(ars[pitcher == s$pitcher], by = "stand"), function(x) { x <- x[order(-share)]
         lapply(seq_len(nrow(x)), function(k) list(pitch = x$pitch_type[k], share = round(x$share[k], 3), velo = r1(x$release_speed[k]),
                ivb = r1(x$ivb[k]), hb = r1(x$hb_arm[k]))) })) })
out <- list(
  generated = format(Sys.time(), "%Y-%m-%d"), season = 2026L, featured = FEATURED,
  opponents = OPPONENTS, pitchers = pit, regions = ZONE_REGIONS, region_centroids = cent[match(ZONE_REGIONS, region), .(region, x_in = round(x_in, 2), z = round(z, 2))],
  lineups = lapply(split(lineups, by = "team"), function(x) x[, .(batter, name, order, pa, games, med_slot, switch)]),
  plans = plans, learned = learned, validation = val,
  importance = fin$imp[1:min(.N, 28)],
  method = list(lineup = "Top 9 hitters by 2026 plate appearances for that club (Statcast pitch-level data), ordered by their median batting-order slot. Rosters will change before 2027.",
                feasible = FEASIBLE, habit = HABIT, res_k = val$pitch_level$res_k, min_starts = MIN_STARTS))
dir.create("site", showWarnings = FALSE)
write_json(out, "site/gameplan_data.json", auto_unbox = TRUE, digits = NA, na = "null", null = "null")
writeLines(paste0("window.GAMEPLAN = ", paste(readLines("site/gameplan_data.json", warn = FALSE), collapse = ""), ";"), "site/gameplan_data.js")
message(sprintf("wrote site/gameplan_data.json (%.0f KB)", file.size("site/gameplan_data.json") / 1024))
for (p in plans) if (p$team == "MIN") { cat("\n==", p$pitcher, p$team, "\n"); cat(p$takeaways, sep = "\n") }
