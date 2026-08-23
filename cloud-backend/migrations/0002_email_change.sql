CREATE TABLE IF NOT EXISTS email_change_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    new_email TEXT NOT NULL COLLATE NOCASE,
    code_hash TEXT NOT NULL,
    confirmation_token_hash TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    verified_at INTEGER,
    confirmed_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    request_ip TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_change_user
ON email_change_requests(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_change_target
ON email_change_requests(new_email, created_at DESC);
