-- 02_features.sql : derived pitch-level features used by every downstream report.
-- Movement in inches; horizontal break & release side are mirrored for LHP so
-- "arm side" is always positive (makes RHP/LHP comparable in one model).
CREATE OR REPLACE TABLE pitch_features AS
WITH base AS (
  SELECT *,
    pfx_z * 12                                                    AS ivb,
    CASE WHEN p_throws = 'R' THEN -pfx_x ELSE pfx_x END * 12      AS hb_arm,
    CASE WHEN p_throws = 'R' THEN -release_pos_x ELSE release_pos_x END AS rel_side_arm,
    description IN ('swinging_strike','swinging_strike_blocked','foul_tip','foul','foul_bunt',
                    'hit_into_play','missed_bunt','bunt_foul_tip')               AS is_swing,
    description IN ('swinging_strike','swinging_strike_blocked','foul_tip','missed_bunt') AS is_whiff,
    description = 'called_strike'                                                AS is_called_strike,
    zone BETWEEN 1 AND 9                                                         AS in_zone,
    CASE WHEN pitch_type IN ('FF','SI','FC') THEN 'Fastball'
         WHEN pitch_type IN ('SL','ST','CU','KC','SV','CS') THEN 'Breaking'
         ELSE 'Offspeed' END                                                     AS pitch_group
  FROM pitches
),
-- each pitcher's primary fastball (most-thrown of FF/SI/FC) = reference for "off-speed differential"
primary_fb AS (
  SELECT pitcher, pitch_type AS fb_type, avg(release_speed) AS fb_velo,
         avg(ivb) AS fb_ivb, avg(hb_arm) AS fb_hb
  FROM base WHERE pitch_type IN ('FF','SI','FC')
  GROUP BY pitcher, pitch_type
  QUALIFY row_number() OVER (PARTITION BY pitcher ORDER BY count(*) DESC) = 1
)
SELECT b.*,
  b.release_speed - f.fb_velo AS velo_diff,
  b.ivb - f.fb_ivb            AS ivb_diff,
  b.hb_arm - f.fb_hb          AS hb_diff,
  (b.plate_z - b.sz_bot) / NULLIF(b.sz_top - b.sz_bot, 0) AS plate_z_norm,
  -- Vertical approach angle at the front of the plate (y = 17/12 ft), from the 9-parameter fit
  degrees(-atan(
     (b.vz0 + b.az * ((-sqrt(b.vy0*b.vy0 - 2*b.ay*(50 - 17/12.0)) - b.vy0) / b.ay))
     / (-sqrt(b.vy0*b.vy0 - 2*b.ay*(50 - 17/12.0))))) AS vaa,
  -- position at the tunnel / decision point (23.8 ft in front of the plate), back-solved from plate location
  b.plate_x - (b.vx0 * t.tp + 0.5*b.ax*t.tp*t.tp) + (b.vx0 * t.tt + 0.5*b.ax*t.tt*t.tt) AS tun_x,
  b.plate_z - (b.vz0 * t.tp + 0.5*b.az*t.tp*t.tp) + (b.vz0 * t.tt + 0.5*b.az*t.tt*t.tt) AS tun_z,
  b.is_swing AND NOT b.in_zone AS is_chase,
  CASE WHEN b.pitch_team = 'KC' THEN TRUE ELSE FALSE END AS is_royals
FROM base b LEFT JOIN primary_fb f USING (pitcher)
CROSS JOIN LATERAL (SELECT
   (-b.vy0 - sqrt(b.vy0*b.vy0 - 2*b.ay*(50 - 17/12.0)))        / b.ay AS tp,   -- time to front of plate
   (-b.vy0 - sqrt(b.vy0*b.vy0 - 2*b.ay*(50 - 17/12.0 - 23.8))) / b.ay AS tt    -- time to tunnel point
) t;

-- Expected run value ("xRV"): de-noised target for the Stuff+ model.
-- Balls in play take the league-average run value for their exit-velo / launch-angle / count bucket,
-- so a 105-mph liner caught at the wall and a bloop single are valued by contact quality, not luck.
CREATE OR REPLACE TABLE bip_value AS
SELECT balls, strikes, floor(launch_speed / 3) AS ev_bin, floor(launch_angle / 4) AS la_bin,
       avg(delta_run_exp) AS bip_rv, count(*) AS n
FROM pitch_features
WHERE type = 'X' AND launch_speed IS NOT NULL AND launch_angle IS NOT NULL
GROUP BY ALL;

CREATE OR REPLACE TABLE pitch_features AS
SELECT p.*,
  CASE WHEN p.type = 'X' AND v.n >= 20 THEN -v.bip_rv ELSE -p.delta_run_exp END AS xrv  -- pitcher perspective
FROM pitch_features p
LEFT JOIN bip_value v
  ON p.type = 'X' AND v.balls = p.balls AND v.strikes = p.strikes
 AND v.ev_bin = floor(p.launch_speed / 3) AND v.la_bin = floor(p.launch_angle / 4);
