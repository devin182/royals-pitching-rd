# 01_build_db.R -- run the SQL pipeline (sql/*.sql, in order) inside DuckDB from R.
suppressPackageStartupMessages({ library(DBI); library(duckdb) })
con <- dbConnect(duckdb(), dbdir = "data/statcast.duckdb")
for (f in sort(list.files("sql", pattern = "^0[1-9].*\\.sql$", full.names = TRUE))) {
  t0 <- Sys.time()
  stmts <- strsplit(paste(readLines(f), collapse = "\n"), ";\\s*\n")[[1]]
  for (s in stmts) if (nzchar(trimws(gsub("--[^\n]*", "", s)))) dbExecute(con, s)
  message(sprintf("%-28s %5.1fs", basename(f), as.numeric(Sys.time() - t0, units = "secs")))
}
print(dbGetQuery(con, "SELECT count(*) pitches, min(game_date) first_day, max(game_date) last_day,
                       count(*) FILTER (WHERE is_royals) royals_pitches FROM pitch_features"))
dbDisconnect(con, shutdown = TRUE)
