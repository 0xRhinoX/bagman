-- One owner per name. The 4-digit PIN lets the owner log in again on any device.
CREATE TABLE names (
  name TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  pin_hash TEXT NOT NULL,      -- HMAC of salt + name + PIN, keyed with the SALT secret
  pin_salt TEXT NOT NULL,
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX names_player ON names (player_id);

-- Login and claim attempts, for per-IP rate limiting.
CREATE TABLE login_attempts (
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX login_attempts_ip_time ON login_attempts (ip_hash, created_at);
