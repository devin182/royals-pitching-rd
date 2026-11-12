-- 01_load.sql : raw Baseball Savant CSVs -> typed pitch table (all MLB, regular season)
CREATE OR REPLACE TABLE pitches AS
SELECT
  game_pk, CAST(game_date AS DATE) AS game_date, game_year,
  pitcher, player_name, p_throws, batter, stand,
  home_team, away_team,
  CASE WHEN inning_topbot = 'Top' THEN home_team ELSE away_team END AS pitch_team,
  pitch_type, pitch_name, at_bat_number, pitch_number, inning, outs_when_up,
  balls, strikes, n_thruorder_pitcher,
  release_speed, release_spin_rate, spin_axis, release_extension,
  release_pos_x, release_pos_z, arm_angle,
  pfx_x, pfx_z, plate_x, plate_z, sz_top, sz_bot, zone,
  vx0, vy0, vz0, ax, ay, az,
  description, events, type, bb_type, launch_speed, launch_angle,
  estimated_woba_using_speedangle AS xwoba_con, woba_value, woba_denom,
  delta_run_exp, delta_pitcher_run_exp
FROM read_csv('data/raw/days/*.csv', header = true, union_by_name = true,
              sample_size = -1, ignore_errors = true)
WHERE pitch_type IS NOT NULL AND pitch_type NOT IN ('PO', 'IN', 'AB', 'EP', 'CS', 'FA', 'UN');
