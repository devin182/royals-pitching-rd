# Data assertions on the DuckDB transforms, run against the committed fixture.
test_that("load keeps every classified pitch and drops non-competitive ones", {
  raw <- as.data.table(dbGetQuery(fixture_con(), sprintf(
    "SELECT count(*) FILTER (WHERE pitch_type IS NOT NULL AND pitch_type NOT IN ('PO','IN','AB','EP','CS','FA','UN')) n
     FROM read_csv('%s', header = true)", FIXTURE_CSV)))
  expect_equal(q("SELECT count(*) n FROM pitches")$n, raw$n)
  expect_equal(q("SELECT count(*) n FROM pitch_features")$n, raw$n)       # features never duplicate rows
  expect_equal(q("SELECT count(DISTINCT game_pk) n FROM pitches")$n, 30)
})

test_that("key columns are populated", {
  nulls <- q("SELECT count(*) FILTER (WHERE pitch_type IS NULL) pt, count(*) FILTER (WHERE pitcher IS NULL) p,
                     count(*) FILTER (WHERE game_date IS NULL) gd, count(*) FILTER (WHERE xrv IS NULL) xrv,
                     avg((release_speed IS NULL)::INT) rs, avg((pfx_x IS NULL)::INT) pfx FROM pitch_features")
  expect_equal(nulls$pt, 0); expect_equal(nulls$p, 0); expect_equal(nulls$gd, 0)
  expect_lt(nulls$rs, 0.01); expect_lt(nulls$pfx, 0.01)
  expect_lt(nulls$xrv / q("SELECT count(*) n FROM pitch_features")$n, 0.01)
})

test_that("values are in physically plausible ranges", {
  r <- q("SELECT min(release_speed) vmin, max(release_speed) vmax, min(ivb) imin, max(ivb) imax,
                 min(hb_arm) hmin, max(hb_arm) hmax, min(vaa) amin, max(vaa) amax,
                 min(release_extension) emin, max(release_extension) emax, min(balls) bmin, max(balls) bmax,
                 min(strikes) smin, max(strikes) smax FROM pitch_features")
  expect_gte(r$vmin, 30); expect_lte(r$vmax, 106)
  expect_gte(r$imin, -35); expect_lte(r$imax, 35)
  expect_gte(r$hmin, -35); expect_lte(r$hmax, 35)
  expect_gte(r$amin, -20); expect_lte(r$amax, 2)
  expect_gte(r$emin, 3); expect_lte(r$emax, 9)
  expect_equal(c(r$bmin, r$bmax, r$smin, r$smax), c(0, 3, 0, 2))
})

test_that("pitch types and groups are covered", {
  pt <- q("SELECT DISTINCT pitch_type FROM pitch_features")$pitch_type
  expect_true(all(pt %in% KNOWN_PITCH_TYPES))
  expect_true(all(c("FF", "SI", "SL", "CH") %in% pt))
  expect_setequal(q("SELECT DISTINCT pitch_group FROM pitch_features")$pitch_group, c("Fastball", "Breaking", "Offspeed"))
})

test_that("flags are internally consistent", {
  f <- q("SELECT count(*) FILTER (WHERE is_whiff AND NOT is_swing) a, count(*) FILTER (WHERE is_chase AND in_zone) b,
                 count(*) FILTER (WHERE is_royals AND pitch_team <> 'KC') c FROM pitch_features")
  expect_equal(c(f$a, f$b, f$c), c(0, 0, 0))
  expect_gt(q("SELECT count(*) n FROM pitch_features WHERE is_royals")$n, 1000)
})

test_that("arsenal aggregates are coherent", {
  a <- q("SELECT pitcher, sum(usage) u, min(n) n FROM arsenal GROUP BY 1")
  expect_true(all(a$u <= 1 + 1e-6)); expect_true(all(a$n >= 25))
  r <- q("SELECT * FROM arsenal")
  expect_true(all(r$whiff_rate >= 0 & r$whiff_rate <= 1, na.rm = TRUE))
})

test_that("tunnel / sequence features are finite and non-negative", {
  s <- q("SELECT min(tunnel_in) tmin, max(tunnel_in) tmax, min(plate_in) pmin FROM sequences")
  expect_gte(s$tmin, 0); expect_lt(s$tmax, 60); expect_gte(s$pmin, 0)
})

test_that("daily report slice covers only the last Royals game date", {
  d <- q("SELECT count(DISTINCT game_date) n, max(game_date) d FROM daily_report")
  expect_equal(d$n, 1)
  expect_equal(d$d, q("SELECT max(game_date) d FROM pitch_features WHERE is_royals")$d)
})

test_that("player lookup resolves names for fixture batters", {
  m <- q("SELECT avg((p.full_name IS NOT NULL)::INT) hit
          FROM (SELECT DISTINCT batter FROM pitches) b LEFT JOIN players p ON p.id = b.batter")
  expect_gt(m$hit, 0.95)
})
