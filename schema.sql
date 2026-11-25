-- =====================================================
-- DeG - Data Purity Operations Portal
-- Role-Based Access Control (RBAC) & Audit Logs Schema
-- Run against Cloudflare D1:
--   wrangler d1 execute <YOUR_DB_NAME> --file=schema.sql --remote
-- =====================================================

CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT    NOT NULL UNIQUE,
    password     TEXT    NOT NULL,
    display_name TEXT    NOT NULL,
    role         TEXT    NOT NULL DEFAULT 'user',   -- 'admin' or 'user'
    status       TEXT    NOT NULL DEFAULT 'active', -- 'active' or 'inactive'
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);

CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL DEFAULT 0,
    username    TEXT    NOT NULL,
    action      TEXT    NOT NULL, -- 'login', 'login_failed', 'add_record', 'update_record', 'create_user', 'update_user', 'delete_user'
    target_type TEXT,             -- 'record', 'user', or NULL
    target_id   TEXT,             -- ref_id or user id
    details     TEXT,             -- JSON or human-readable summary
    ip_address  TEXT,
    timestamp   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

