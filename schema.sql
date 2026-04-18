-- Schema for the Enigma leaderboard service.
-- Tables are also auto-created on startup via SQLAlchemy (create_all);
-- this file is provided for manual setups and for reference.

-- Ratings table: every /add writes one row here.
-- BIGSERIAL id, indexed on `rating` for leaderboard queries.
CREATE TABLE IF NOT EXISTS ratings (
    id          BIGSERIAL PRIMARY KEY,
    player_name TEXT NOT NULL,
    rating      INTEGER NOT NULL,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ratings_rating ON ratings(rating DESC);

-- Audit log: every /add and /remove is appended here. Source of truth for /history
-- and for the in-memory store's startup replay.
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    player_name TEXT NOT NULL,
    rating      INTEGER NOT NULL,
    operation   TEXT NOT NULL CHECK (operation IN ('add', 'remove')),
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_player_name ON audit_log(player_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp   ON audit_log(timestamp DESC);
