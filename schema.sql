-- Run this in your Supabase SQL Editor
-- Dashboard > SQL Editor > New Query > paste & run

-- Drop existing type if re-running
DROP TYPE IF EXISTS userrole CASCADE;
CREATE TYPE userrole AS ENUM ('admin', 'user');

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE NOT NULL,
    full_name   TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role        userrole NOT NULL DEFAULT 'user',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Ratings table (leaderboard)
-- id is BIGSERIAL (auto-increment integer); UUIDs are not used for this table.
-- User.id uses UUID v7 (time-ordered), generated in Python via the uuid6 package.
CREATE TABLE IF NOT EXISTS ratings (
    id          BIGSERIAL PRIMARY KEY,
    player_name TEXT NOT NULL,
    rating      INTEGER NOT NULL,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on rating for fast leaderboard queries
CREATE INDEX IF NOT EXISTS idx_ratings_rating ON ratings(rating DESC);

-- Audit log (every /add and /remove is appended here; source of truth for /history)
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    player_name TEXT NOT NULL,
    rating      INTEGER NOT NULL,
    operation   TEXT NOT NULL CHECK (operation IN ('add', 'remove')),
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_player_name ON audit_log(player_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp   ON audit_log(timestamp DESC);
