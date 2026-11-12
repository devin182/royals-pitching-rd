# 01_build_db.R -- run the SQL pipeline (sql/*.sql, in order) inside DuckDB from R.
suppressPackageStartupMessages({ library(DBI); library(duckdb) })
source("R/lib/pipeline.R")
db <- Sys.getenv("DB_PATH", "data/statcast.duckdb")
con <- dbConnect(duckdb(), dbdir = db)
run_sql_dir(con)
print(dbGetQuery(con, "SELECT count(*) pitches, min(game_date) first_day, max(game_date) last_day,
                       count(*) FILTER (WHERE is_royals) royals_pitches FROM pitch_features"))
dbDisconnect(con, shutdown = TRUE)
