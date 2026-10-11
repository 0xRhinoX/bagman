-- Every submitted score, kept for rate limiting and spotting cheaters.
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  level INTEGER NOT NULL,
  duration INTEGER NOT NULL,   -- seconds of actual play
  day TEXT NOT NULL,           -- UTC date, YYYY-MM-DD
  ip_hash TEXT NOT NULL,       -- salted hash, never the raw IP
  created_at INTEGER NOT NULL  -- unix ms
);
CREATE INDEX scores_ip_time ON scores (ip_hash, created_at);

-- Each player's best score per board. board = 'all' or a UTC date (the daily board).
CREATE TABLE best (
  board TEXT NOT NULL,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  level INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (board, player_id)
);
CREATE INDEX best_board_score ON best (board, score DESC, updated_at);
