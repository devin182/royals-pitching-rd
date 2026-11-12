-- 03_arsenal.sql : pitcher x pitch-type arsenal summary (Royals pitchers, min 25 pitches of a type)
CREATE OR REPLACE TABLE arsenal AS
WITH tot AS (SELECT pitcher, count(*) n_all FROM pitch_features WHERE is_royals GROUP BY pitcher)
SELECT p.pitcher, any_value(player_name) AS player_name, any_value(p_throws) AS p_throws,
  pitch_type, any_value(pitch_name) AS pitch_name,
  count(*)                                   AS n,
  round(count(*) / any_value(t.n_all), 4)    AS usage,
  round(avg(release_speed), 1)               AS velo,
  round(max(release_speed), 1)               AS velo_max,
  round(avg(release_spin_rate))              AS spin,
  round(avg(ivb), 1)                         AS ivb,
  round(avg(hb_arm), 1)                      AS hb_arm,
  round(avg(release_extension), 2)           AS extension,
  round(avg(arm_angle), 1)                   AS arm_angle,
  round(avg(release_pos_z), 2)               AS rel_height,
  round(avg(rel_side_arm), 2)                AS rel_side,
  -- release consistency: pooled SD (inches) of release point
  round(12 * sqrt(var_samp(release_pos_z) + var_samp(rel_side_arm)), 2) AS rel_sd_in,
  round(avg(is_whiff::INT) FILTER (WHERE is_swing) , 3)   AS whiff_rate,
  round(avg(is_chase::INT) FILTER (WHERE NOT in_zone), 3) AS chase_rate,
  round(avg(in_zone::INT), 3)                             AS zone_rate,
  round(avg((is_whiff OR is_called_strike)::INT), 3)      AS csw_rate,
  round(avg(xwoba_con) FILTER (WHERE type = 'X'), 3)      AS xwoba_con,
  round(100 * sum(-delta_run_exp) / count(*), 2)          AS rv100      -- pitcher run value per 100 (+ = good)
FROM pitch_features p JOIN tot t USING (pitcher)
WHERE is_royals
GROUP BY p.pitcher, pitch_type
HAVING count(*) >= 25;
