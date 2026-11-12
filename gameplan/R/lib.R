# lib.R -- shared definitions for the matchup model and the game-plan generator.
XGB_PARAMS <- list(objective = "reg:squarederror", eta = 0.05, max_depth = 6, min_child_weight = 200,
                   subsample = 0.8, colsample_bytree = 0.8, lambda = 5, nthread = 8, tree_method = "hist")
PITCH_FEATS <- c("pg", "release_speed", "ivb", "hb_arm", "release_spin_rate", "release_extension", "arm_angle",
                 "release_pos_z", "vaa", "velo_diff", "ivb_diff", "hb_diff",
                 "x_in", "z", "balls", "strikes", "same_side", "stand_l")
HITTER_FEATS <- c("h_bat_speed", "h_swing_length", "h_attack_angle", "h_chase", "h_zone_swing",
                  "h_zone_whiff", "h_whiff_fb", "h_whiff_br", "h_whiff_os", "h_xwobacon")
RES_K_GRID <- c(50, 150, 300, 600, 1200)
RES_K_DEFAULT <- 300   # fixed a priori (pitches) -- the grid above is reported as sensitivity only
ZONE_REGIONS <- c("Up-In","Up-Middle","Up-Away","Mid-In","Mid-Middle","Mid-Away","Low-In","Low-Middle","Low-Away",
                  "Above zone","Off plate in","Off plate away","Below zone")
# coarse location band for the hitter-specific residual layer (keeps cells big enough to learn from)
loc_band <- function(region, z) data.table::fcase(
  region %in% c("Up-In","Up-Middle","Up-Away"), "Up",
  region %in% c("Mid-In","Mid-Middle","Mid-Away"), "Middle",
  region %in% c("Low-In","Low-Middle","Low-Away"), "Low",
  region == "Above zone", "Above",
  region %in% c("Below zone"), "Below",
  region %in% c("Off plate in","Off plate away"), "Off plate",
  default = "Waste")

# Empirical-Bayes shrinkage: (sum + k * league_mean) / (n + k). k = pseudo-sample in the stat's own units.
shrink <- function(sum, n, mu, k) (sum + k * mu) / (n + k)
hitter_profiles <- function(x) {
  lg <- x[, .(bs = mean(bat_speed, na.rm = TRUE), sl = mean(swing_length, na.rm = TRUE), aa = mean(attack_angle, na.rm = TRUE),
              ch = mean(is_swing[!in_zone]), zs = mean(is_swing[in_zone]), zw = mean(is_whiff[in_zone & is_swing]),
              wf = mean(is_whiff[is_swing & pitch_group == "Fastball"]), wb = mean(is_whiff[is_swing & pitch_group == "Breaking"]),
              wo = mean(is_whiff[is_swing & pitch_group == "Offspeed"]), xw = mean(xwoba_con[type == "X"], na.rm = TRUE))]
  x[, .(pitches = .N,
        swings_tracked = sum(!is.na(bat_speed)),
        h_bat_speed    = shrink(sum(bat_speed, na.rm = TRUE), sum(!is.na(bat_speed)), lg$bs, 40),
        h_swing_length = shrink(sum(swing_length, na.rm = TRUE), sum(!is.na(swing_length)), lg$sl, 40),
        h_attack_angle = shrink(sum(attack_angle, na.rm = TRUE), sum(!is.na(attack_angle)), lg$aa, 40),
        h_chase        = shrink(sum(is_swing & !in_zone), sum(!in_zone), lg$ch, 150),
        h_zone_swing   = shrink(sum(is_swing & in_zone), sum(in_zone), lg$zs, 100),
        h_zone_whiff   = shrink(sum(is_whiff & in_zone), sum(is_swing & in_zone), lg$zw, 80),
        h_whiff_fb     = shrink(sum(is_whiff & pitch_group == "Fastball"), sum(is_swing & pitch_group == "Fastball"), lg$wf, 60),
        h_whiff_br     = shrink(sum(is_whiff & pitch_group == "Breaking"), sum(is_swing & pitch_group == "Breaking"), lg$wb, 60),
        h_whiff_os     = shrink(sum(is_whiff & pitch_group == "Offspeed"), sum(is_swing & pitch_group == "Offspeed"), lg$wo, 60),
        h_xwobacon     = shrink(sum(xwoba_con[type == "X"], na.rm = TRUE), sum(type == "X" & !is.na(xwoba_con)), lg$xw, 80)),
    by = batter]
}
league_profile <- function(prof) prof[, lapply(.SD, function(v) weighted.mean(v, pitches)), .SDcols = HITTER_FEATS]
attach_profiles <- function(x, prof) {
  out <- merge(x, prof[, c("batter", HITTER_FEATS), with = FALSE], by = "batter", all.x = TRUE)
  lp <- league_profile(prof)
  for (f in HITTER_FEATS) set(out, which(is.na(out[[f]])), f, lp[[f]])   # unseen hitter -> league average
  out
}
