# 04_reports.R -- render the daily report + one printable card per Royals pitcher (R Markdown + SQL chunks)
suppressPackageStartupMessages({ library(DBI); library(duckdb); library(rmarkdown) })
if (!pandoc_available()) Sys.setenv(RSTUDIO_PANDOC = normalizePath(file.path(R.home(), "..", "..", "bin")))  # conda-style installs
dir.create("site/reports/cards", recursive = TRUE, showWarnings = FALSE)
render("report/daily_report.Rmd", output_file = "daily_report.html", output_dir = "site/reports", quiet = TRUE)
con <- dbConnect(duckdb(), dbdir = "data/statcast.duckdb", read_only = TRUE)
ids <- dbGetQuery(con, "SELECT pitcher FROM pitch_features WHERE is_royals GROUP BY 1 HAVING count(*) >= 300 ORDER BY count(*) DESC")$pitcher
dbDisconnect(con, shutdown = TRUE)
for (id in ids) render("report/pitcher_card.Rmd", params = list(pitcher = id),
                       output_file = paste0(id, ".html"), output_dir = "site/reports/cards", quiet = TRUE,
                       intermediates_dir = tempdir())
message(length(ids), " pitcher cards rendered")
