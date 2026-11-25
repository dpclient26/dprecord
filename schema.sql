-- =====================================================
-- DeG - Data Purity Operations Portal
-- Role-Based Access Control (RBAC) & Audit Logs Schema
-- Run against Cloudflare D1:
--   wrangler d1 execute <YOUR_DB_NAME> --file=schema.sql --remote
-- =====================================================

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username_hash TEXT    UNIQUE,                  -- HMAC-SHA256 blind index for lookup
    username      TEXT    NOT NULL UNIQUE,         -- AES-256-GCM encrypted username
    password      TEXT    NOT NULL,                -- Peppered PBKDF2-SHA256 hash
    display_name  TEXT    NOT NULL,                -- AES-256-GCM encrypted display name
    role          TEXT    NOT NULL DEFAULT 'user', -- 'admin' or 'user'
    status        TEXT    NOT NULL DEFAULT 'active', -- 'active' or 'inactive'
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_hash ON users(username_hash);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL DEFAULT 0,
    username    TEXT    NOT NULL, -- AES-256-GCM encrypted
    action      TEXT    NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    details     TEXT,             -- AES-256-GCM encrypted
    ip_address  TEXT,             -- AES-256-GCM encrypted
    timestamp   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
