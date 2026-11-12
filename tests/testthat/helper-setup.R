# Shared test setup: build a DuckDB from the small committed fixture (30 games, ~8.6k pitches).
suppressPackageStartupMessages({ library(DBI); library(duckdb); library(data.table) })
find_root <- function(d = getwd()) {
  while (!file.exists(file.path(d, "sql", "02_features.sql"))) {
    p <- dirname(d)
    if (p == d) stop("repo root not found")
    d <- p
  }
  d
}
ROOT <- find_root()
source(file.path(ROOT, "R", "lib", "pipeline.R"))
FIXTURE_CSV <- file.path(ROOT, "tests", "fixtures", "statcast_sample.csv.gz")
PLAYERS_CSV <- file.path(ROOT, "tests", "fixtures", "players_sample.csv")
FROZEN_CSV  <- file.path(ROOT, "tests", "fixtures", "model_frozen.csv")

.fixture_env <- new.env()
fixture_con <- function() {
  if (is.null(.fixture_env$con)) {
    con <- dbConnect(duckdb(), dbdir = ":memory:")
    dbExecute(con, "SET threads = 1")   # deterministic float aggregation order
    run_sql_dir(con, sql_dir = file.path(ROOT, "sql"), raw_glob = FIXTURE_CSV, players_csv = PLAYERS_CSV, verbose = FALSE)
    .fixture_env$con <- con
  }
  .fixture_env$con
}
q <- function(sql) as.data.table(dbGetQuery(fixture_con(), sql))

# Deterministic settings for the frozen model check (single thread, no row/column sampling).
FROZEN_PARAMS <- list(objective = "reg:squarederror", eta = 0.1, max_depth = 3, min_child_weight = 20,
                      subsample = 1, colsample_bytree = 1, nthread = 1, tree_method = "exact")
FROZEN_ROUNDS <- 25
frozen_training_data <- function() {
  q(paste0("SELECT game_pk, at_bat_number, pitch_number, xrv AS rv, ", paste(STUFF_FEATURES, collapse = ", "),
           " FROM (SELECT *, CASE WHEN p_throws = 'L' THEN 360 - spin_axis ELSE spin_axis END AS spin_axis_arm FROM pitch_features)",
           " WHERE pitch_group = 'Fastball' AND xrv IS NOT NULL AND release_speed IS NOT NULL",
           " ORDER BY game_pk, at_bat_number, pitch_number"))
}
