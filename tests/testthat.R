# Run with: Rscript tests/testthat.R   (from the repo root)
library(testthat)
test_dir("tests/testthat", reporter = c("progress", "fail"), stop_on_failure = TRUE)
