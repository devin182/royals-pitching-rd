# Regenerate tests/fixtures/model_frozen.csv (run only when the model or features change on purpose).
testthat::source_test_helpers("tests/testthat", env = globalenv())
d <- frozen_training_data()
m <- fit_stuff(d, nrounds = FROZEN_ROUNDS, params = FROZEN_PARAMS)
out <- data.table(game_pk = d$game_pk, at_bat_number = d$at_bat_number, pitch_number = d$pitch_number,
                  pred = round(predict_stuff(m, d), 8))[seq(1, .N, by = 10)]
fwrite(out, FROZEN_CSV)
message(nrow(out), " frozen predictions -> ", FROZEN_CSV)
