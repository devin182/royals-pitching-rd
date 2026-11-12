-- 01_matchup_features.sql : feature prep for the matchup model (runs in gameplan/work/gameplan.duckdb,
-- with the main project DB attached READ_ONLY as `sc`). Bat-tracking fields are not in sc.pitches, so they
-- are re-read from the raw Savant CSVs and joined on (game_pk, at_bat_number, pitch_number).
CREATE OR REPLACE TABLE bat_tracking AS
SELECT game_pk, at_bat_number, pitch_number,
       bat_speed, swing_length, attack_angle,
       inning_topbot
FROM read_csv('../data/raw/days/*.csv', header = true, union_by_name = true, sample_size = -1, ignore_errors = true)
WHERE game_type = 'R';

-- Pitch-level table, hitter-relative coordinates.
--   x_in : horizontal location in feet, + = toward the hitter (inside), - = away
--   z    : height scaled to the hitter's zone (0 = bottom, 1 = top)
--   region: 13 coach-readable regions (9 in-zone cells + 4 edges) + Waste
CREATE OR REPLACE TABLE mp AS
WITH b AS (
  SELECT f.*, t.bat_speed, t.swing_length, t.attack_angle,
         CASE WHEN t.inning_topbot = 'Top' THEN f.away_team ELSE f.home_team END AS bat_team,
         CASE WHEN f.stand = 'R' THEN -f.plate_x ELSE f.plate_x END AS x_in,
         f.plate_z_norm AS z,
         (f.p_throws = f.stand)::INT AS same_side
  FROM sc.pitch_features f
  JOIN bat_tracking t USING (game_pk, at_bat_number, pitch_number)
  WHERE f.plate_x IS NOT NULL AND f.plate_z_norm IS NOT NULL AND f.release_speed IS NOT NULL AND f.xrv IS NOT NULL
)
SELECT *,
  CASE
    WHEN z > 1.45 OR z < -0.55 OR abs(x_in) > 1.45 THEN 'Waste'
    WHEN z > 1.0  THEN 'Above zone'
    WHEN z < 0.0  THEN 'Below zone'
    WHEN x_in >  0.83 THEN 'Off plate in'
    WHEN x_in < -0.83 THEN 'Off plate away'
    ELSE (CASE WHEN z > 2/3.0 THEN 'Up' WHEN z < 1/3.0 THEN 'Low' ELSE 'Mid' END) || '-' ||
         (CASE WHEN x_in > 0.28 THEN 'In' WHEN x_in < -0.28 THEN 'Away' ELSE 'Middle' END)
  END AS region,
  CASE WHEN balls = 0 AND strikes = 0 THEN 'First pitch'
       WHEN strikes > balls THEN 'Ahead'          -- 0-1, 0-2, 1-2 (pitcher ahead: put-away counts)
       WHEN balls = strikes THEN 'Even'           -- 1-1, 2-2
       ELSE 'Behind' END AS count_state
FROM b;

-- League centroid of each region (used to place a pitcher's average pitch shape in a region when scoring plans)
CREATE OR REPLACE TABLE region_centroid AS
SELECT region, avg(x_in) AS x_in, avg(z) AS z, count(*) AS n
FROM mp WHERE region <> 'Waste' GROUP BY region;

-- PA count + batting slot per (batter, team): who actually played
CREATE OR REPLACE TABLE batter_team_pa AS
WITH pa AS (
  SELECT DISTINCT game_pk, at_bat_number, batter, bat_team, stand, p_throws FROM mp
), slot AS (
  SELECT game_pk, bat_team, batter,
         row_number() OVER (PARTITION BY game_pk, bat_team ORDER BY min(at_bat_number)) AS slot
  FROM pa GROUP BY game_pk, bat_team, batter
)
SELECT p.batter, p.bat_team, count(*) AS pa,
       count(DISTINCT p.game_pk) AS games,
       (SELECT median(s.slot) FROM slot s WHERE s.batter = p.batter AND s.bat_team = p.bat_team AND s.slot <= 9) AS med_slot,
       count(*) FILTER (WHERE p.stand = 'L') AS pa_as_lhh,
       count(*) FILTER (WHERE p.stand = 'R') AS pa_as_rhh,
       count(*) FILTER (WHERE p.stand = 'L' AND p.p_throws = 'R') AS l_vs_rhp,
       count(*) FILTER (WHERE p.stand = 'R' AND p.p_throws = 'L') AS r_vs_lhp
FROM pa p GROUP BY p.batter, p.bat_team;

-- Royals starters (first KC pitcher of each game)
CREATE OR REPLACE TABLE royals_starters AS
WITH first_p AS (
  SELECT game_pk, arg_min(pitcher, at_bat_number * 100 + pitch_number) AS pitcher
  FROM sc.pitch_features WHERE pitch_team = 'KC' GROUP BY game_pk
)
SELECT f.pitcher, any_value(p.player_name) AS player_name, any_value(p.p_throws) AS p_throws,
       count(DISTINCT f.game_pk) AS starts
FROM first_p f JOIN sc.pitch_features p ON p.pitcher = f.pitcher AND p.game_pk = f.game_pk
GROUP BY f.pitcher;
