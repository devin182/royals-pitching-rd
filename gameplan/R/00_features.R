# 00_features.R -- run gameplan/sql/*.sql in a scratch DuckDB with the project DB attached READ_ONLY.
# Run from gameplan/:  Rscript R/00_features.R
suppressPackageStartupMessages({ library(DBI); library(duckdb) })
dir.create("work", showWarnings = FALSE)
con <- dbConnect(duckdb(), dbdir = "work/gameplan.duckdb")
dbExecute(con, "ATTACH '../data/statcast.duckdb' AS sc (READ_ONLY)")
for (f in sort(list.files("sql", pattern = "\\.sql$", full.names = TRUE))) {
  t0 <- Sys.time()
  stmts <- strsplit(paste(readLines(f), collapse = "\n"), ";\\s*\n")[[1]]
  for (s in stmts) if (nzchar(trimws(gsub("--[^\n]*", "", s)))) dbExecute(con, s)
  message(sprintf("%-28s %5.1fs", basename(f), as.numeric(Sys.time() - t0, units = "secs")))
}
print(dbGetQuery(con, "SELECT count(*) n, count(bat_speed) n_bat_speed, count(DISTINCT batter) hitters FROM mp"))
print(dbGetQuery(con, "SELECT region, count(*) n FROM mp GROUP BY 1 ORDER BY 2 DESC"))
print(dbGetQuery(con, "SELECT * FROM royals_starters ORDER BY starts DESC LIMIT 10"))
dbDisconnect(con, shutdown = TRUE)
