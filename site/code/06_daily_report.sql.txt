-- 06_daily_report.sql : "daily report" slice - every Royals pitcher's line for the most recent game date,
-- compared with his own season baseline (velocity / movement / whiff drift flags).
CREATE OR REPLACE TABLE daily_report AS
WITH last_day AS (SELECT max(game_date) d FROM pitch_features WHERE is_royals),
game AS (
  SELECT pitcher, any_value(player_name) player_name, pitch_type, count(*) n,
    avg(release_speed) velo, avg(ivb) ivb, avg(hb_arm) hb, avg(release_spin_rate) spin,
    sum(is_whiff::INT) whiffs, sum(is_swing::INT) swings, avg(release_extension) ext
  FROM pitch_features, last_day WHERE is_royals AND game_date = last_day.d GROUP BY ALL),
season AS (
  SELECT pitcher, pitch_type, avg(release_speed) velo, avg(ivb) ivb, avg(hb_arm) hb,
         avg(release_spin_rate) spin, stddev_samp(release_speed) velo_sd
  FROM pitch_features, last_day WHERE is_royals AND game_date < last_day.d GROUP BY ALL)
SELECT (SELECT d FROM last_day) AS game_date, g.player_name, g.pitcher, g.pitch_type, g.n,
  round(g.velo,1) velo, round(g.velo - s.velo,1) velo_delta,
  round(g.ivb,1) ivb, round(g.ivb - s.ivb,1) ivb_delta,
  round(g.hb,1) hb, round(g.hb - s.hb,1) hb_delta,
  round(g.spin) spin, round(g.spin - s.spin) spin_delta, g.whiffs, g.swings,
  CASE WHEN g.velo - s.velo <= -1.5 THEN 'VELO DOWN'
       WHEN abs(g.ivb - s.ivb) >= 2 OR abs(g.hb - s.hb) >= 2 THEN 'SHAPE CHANGE'
       ELSE '' END AS flag
FROM game g LEFT JOIN season s USING (pitcher, pitch_type)
ORDER BY g.player_name, g.n DESC;
