# R/lib/pipeline.R -- shared, testable helpers for the pipeline (sourced by R/0*.R and tests/testthat).

#' Run every sql/0N_*.sql file, in order, against a DuckDB connection.
#' Paths to the raw inputs are substituted so tests can point the same SQL at small fixtures.
run_sql_dir <- function(con, sql_dir = "sql",
                        raw_glob = Sys.getenv("RAW_GLOB", "data/raw/days/*.csv"),
                        players_csv = Sys.getenv("PLAYERS_CSV", "data/raw/players.csv"),
                        verbose = TRUE) {
  files <- sort(list.files(sql_dir, pattern = "^0[1-9].*\\.sql$", full.names = TRUE))
  for (f in files) {
    t0 <- Sys.time()
    sql <- paste(readLines(f, warn = FALSE), collapse = "\n")
    sql <- gsub("data/raw/days/*.csv", raw_glob, sql, fixed = TRUE)
    sql <- gsub("data/raw/players.csv", players_csv, sql, fixed = TRUE)
    stmts <- strsplit(sql, ";\\s*\n")[[1]]
    for (s in stmts) if (nzchar(trimws(gsub("--[^\n]*", "", s)))) DBI::dbExecute(con, s)
    if (verbose) message(sprintf("%-28s %5.1fs", basename(f), as.numeric(Sys.time() - t0, units = "secs")))
  }
  invisible(files)
}

#' Empirical-Bayes style shrinkage of a rate/mean toward a prior: (sum + k * prior) / (n + k)
shrink <- function(sum_x, n, prior, k) (sum_x + k * prior) / (n + k)

#' Vertical approach angle (degrees) at the front of the plate from the Statcast 9-parameter fit.
#' Reference implementation used to test the SQL version in sql/02_features.sql.
vaa_deg <- function(vy0, vz0, ay, az, y_plate = 17 / 12) {
  vyf <- -sqrt(vy0^2 - 2 * ay * (50 - y_plate))
  t <- (vyf - vy0) / ay
  vzf <- vz0 + az * t
  -atan(vzf / vyf) * 180 / pi
}

#' Horizontal value mirrored so the pitcher's arm side is positive (RHP x is negative in Statcast).
arm_side <- function(x, p_throws) ifelse(p_throws == "R", -x, x)

STUFF_FEATURES <- c("release_speed", "ivb", "hb_arm", "release_spin_rate", "spin_axis_arm",
                    "release_extension", "release_pos_z", "rel_side_arm", "arm_angle",
                    "velo_diff", "ivb_diff", "hb_diff")

STUFF_PARAMS <- list(objective = "reg:squarederror", eta = 0.03, max_depth = 5, min_child_weight = 200,
                     subsample = 0.8, colsample_bytree = 0.8, nthread = 8)

#' Fit one xgboost Stuff+ model (target = expected run value, pitcher view).
fit_stuff <- function(d, nrounds, params = STUFF_PARAMS, feats = STUFF_FEATURES) {
  dm <- xgboost::xgb.DMatrix(as.matrix(d[, feats, with = FALSE]), label = d$rv, missing = NA)
  xgboost::xgb.train(params, dm, nrounds = nrounds, verbose = 0)
}

predict_stuff <- function(model, d, feats = STUFF_FEATURES) {
  stats::predict(model, xgboost::xgb.DMatrix(as.matrix(d[, feats, with = FALSE]), missing = NA))
}

#' Scale mean predicted run value to Stuff+ (100 = league mean, 10 = 1 SD of reference pitch types).
stuff_plus <- function(pred_mean, league_mean, ref_sd) round(100 + 10 * (pred_mean - league_mean) / ref_sd)

KNOWN_PITCH_TYPES <- c("FF", "SI", "FC", "SL", "ST", "SV", "CU", "KC", "CH", "FS", "FO", "SC", "KN", "CS")
