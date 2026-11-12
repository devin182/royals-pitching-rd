-- 07_players.sql : player-name lookup (MLB Stats API) for batter ids
CREATE OR REPLACE TABLE players AS SELECT * FROM read_csv('data/raw/players.csv', header = true);
