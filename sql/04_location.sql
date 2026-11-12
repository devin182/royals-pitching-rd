-- 04_location.sql : location grids (0.25 ft bins across the plate) per Royals pitcher x pitch type
CREATE OR REPLACE TABLE location_grid AS
SELECT pitcher, pitch_type, stand,
  floor(plate_x / 0.25) * 0.25 + 0.125           AS x_bin,
  floor(plate_z_norm / 0.125) * 0.125 + 0.0625   AS z_bin,   -- z normalised to batter's zone (0=bottom,1=top)
  count(*) AS n,
  sum(is_swing::INT) AS swings, sum(is_whiff::INT) AS whiffs
FROM pitch_features
WHERE is_royals AND plate_x BETWEEN -2 AND 2 AND plate_z_norm BETWEEN -0.75 AND 1.75
GROUP BY ALL;

-- whiff / chase by zone region relative to league (same pitch type & batter side)
CREATE OR REPLACE TABLE zone_region AS
WITH r AS (
  SELECT *, CASE
     WHEN in_zone AND plate_z_norm >= 0.67 THEN 'Zone-High'
     WHEN in_zone AND plate_z_norm <  0.33 THEN 'Zone-Low'
     WHEN in_zone THEN 'Zone-Middle'
     WHEN plate_z_norm > 1 THEN 'Chase-Above'
     WHEN plate_z_norm < 0 THEN 'Chase-Below'
     ELSE 'Chase-Side' END AS region
  FROM pitch_features)
SELECT pitch_type, region, is_royals, pitcher,
  count(*) n, avg(is_swing::INT) swing_rate,
  avg(is_whiff::INT) FILTER (WHERE is_swing) whiff_rate,
  sum(-delta_run_exp) rv
FROM r GROUP BY ALL;
