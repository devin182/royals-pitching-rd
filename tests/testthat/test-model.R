test_that("Stuff+ model trains and predicts on fixture data", {
  d <- frozen_training_data()
  expect_gt(nrow(d), 1000)
  m <- fit_stuff(d, nrounds = 10, params = modifyList(STUFF_PARAMS, list(nthread = 1, min_child_weight = 20)))
  p <- predict_stuff(m, d)
  expect_length(p, nrow(d))
  expect_true(all(is.finite(p)))
  expect_lt(sd(p), 0.1)                     # predictions are shrunk run values, not raw outcomes
})

test_that("model output matches the frozen fixture", {
  skip_if_not(file.exists(FROZEN_CSV), "frozen fixture not generated")
  d <- frozen_training_data()
  m <- fit_stuff(d, nrounds = FROZEN_ROUNDS, params = FROZEN_PARAMS)
  p <- predict_stuff(m, d)
  frozen <- fread(FROZEN_CSV)
  got <- data.table(game_pk = d$game_pk, at_bat_number = d$at_bat_number, pitch_number = d$pitch_number, pred = p)
  chk <- merge(frozen, got, by = c("game_pk", "at_bat_number", "pitch_number"), suffixes = c("_frozen", ""))
  expect_equal(nrow(chk), nrow(frozen))
  expect_lt(max(abs(chk$pred - chk$pred_frozen)), 5e-4)   # absolute; preds are run values (~±0.05)
  expect_gt(cor(chk$pred, chk$pred_frozen), 0.999)
})
