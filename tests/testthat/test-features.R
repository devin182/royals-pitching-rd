test_that("shrinkage pulls small samples to the prior and leaves big ones alone", {
  expect_equal(shrink(0, 0, prior = 0.3, k = 100), 0.3)
  expect_equal(shrink(50, 100, prior = 0, k = 100), 0.25)
  expect_lt(abs(shrink(6000, 10000, prior = 0, k = 250) - 0.6), 0.02)
})

test_that("arm-side mirroring makes RHP and LHP comparable", {
  expect_equal(arm_side(c(-1, 1), c("R", "L")), c(1, 1))
  expect_equal(arm_side(0.5, "R"), -0.5)
})

test_that("VAA reference implementation gives sensible angles", {
  # typical four-seamer: ~94 mph, slight downward release
  v <- vaa_deg(vy0 = -137, vz0 = -5, ay = 28, az = -15)
  expect_true(v < -2 && v > -8)
  # a pitch thrown more downhill should have a steeper (more negative) VAA
  expect_lt(vaa_deg(-137, -9, 28, -15), v)
})

test_that("SQL VAA matches the R reference implementation", {
  d <- q("SELECT vy0, vz0, ay, az, vaa FROM pitch_features WHERE vy0 IS NOT NULL LIMIT 500")
  expect_equal(d$vaa, vaa_deg(d$vy0, d$vz0, d$ay, d$az), tolerance = 1e-9)
})

test_that("SQL movement features are in inches and mirrored", {
  d <- q("SELECT pfx_x, pfx_z, ivb, hb_arm, p_throws FROM pitch_features WHERE pfx_x IS NOT NULL")
  expect_equal(d$ivb, d$pfx_z * 12, tolerance = 1e-9)
  expect_equal(d$hb_arm, arm_side(d$pfx_x, d$p_throws) * 12, tolerance = 1e-9)
})

test_that("Stuff+ scaling is centred at 100 with 10 points per SD", {
  expect_equal(stuff_plus(0.01, 0.01, 0.002), 100)
  expect_equal(stuff_plus(0.012, 0.01, 0.002), 110)
  expect_equal(stuff_plus(0.006, 0.01, 0.002), 80)
})
