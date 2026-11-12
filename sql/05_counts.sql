-- 05_counts.sql : count-state usage and results (Royals) + league baseline by count & pitch group
CREATE OR REPLACE TABLE count_usage AS
SELECT pitcher, balls || '-' || strikes AS count_state, pitch_type, count(*) n,
  CASE WHEN balls > strikes THEN 'Behind' WHEN strikes > balls THEN 'Ahead' ELSE 'Even' END AS leverage
FROM pitch_features WHERE is_royals GROUP BY ALL;

CREATE OR REPLACE TABLE league_count_group AS
SELECT balls || '-' || strikes AS count_state, pitch_group,
  count(*) n, avg(is_whiff::INT) FILTER (WHERE is_swing) whiff_rate,
  100*avg(-delta_run_exp) rv100
FROM pitch_features GROUP BY ALL;

-- Sequencing: what follows what within a PA, and how the 2nd pitch performs
CREATE OR REPLACE TABLE sequences AS
WITH s AS (
  SELECT pitcher, is_royals, game_pk, at_bat_number, pitch_number, pitch_type,
         lag(pitch_type) OVER (PARTITION BY game_pk, at_bat_number ORDER BY pitch_number) AS prev_type,
         is_swing, is_whiff, is_chase, in_zone, delta_run_exp,
         sqrt(power(tun_x - lag(tun_x) OVER w, 2) + power(tun_z - lag(tun_z) OVER w, 2)) * 12 AS tunnel_dist_in,
         sqrt(power(plate_x - lag(plate_x) OVER w, 2) + power(plate_z - lag(plate_z) OVER w, 2)) * 12 AS plate_dist_in
  FROM pitch_features
  WINDOW w AS (PARTITION BY game_pk, at_bat_number ORDER BY pitch_number))
SELECT pitcher, is_royals, prev_type, pitch_type, count(*) n,
  avg(is_whiff::INT) FILTER (WHERE is_swing) whiff_rate,
  avg(is_chase::INT) FILTER (WHERE NOT in_zone) chase_rate,
  avg(tunnel_dist_in) tunnel_in, avg(plate_dist_in) plate_in,
  100*avg(-delta_run_exp) rv100
FROM s WHERE prev_type IS NOT NULL GROUP BY ALL;
