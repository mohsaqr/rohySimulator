-- 0037: registration invites — a shareable link AND a typeable code.
--
-- ONE token, two delivery modes. The same string works pasted into
-- /register?invite=TOKEN and typed into the invite field on the register
-- screen, so there is no second artifact to keep in sync. It is stored in
-- plaintext (like cohorts.join_code) because an admin must be able to re-copy
-- the link later; anyone who can read this table can already read password
-- hashes and session token hashes.
--
-- The platform CANNOT send email (no mail transport exists anywhere in the
-- codebase), so an invite is deliberately a copy-paste artifact — exactly like
-- the cohort join codes teachers already share.
--
-- `uses` is claimed with a conditional UPDATE before the user row is created
-- (see server/routes/registration-routes.js), which is what makes a
-- max_uses-limited invite safe against two people redeeming it at once.
--
-- Strictly additive: two new tables, nothing on existing tables changes.
-- Behaviour is unchanged until an admin mints an invite.

CREATE TABLE IF NOT EXISTS registration_invites (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id     INTEGER NOT NULL DEFAULT 1,
    token         TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'student',
    cohort_id     INTEGER REFERENCES cohorts(id),   -- auto-enrol the redeemer
    max_uses      INTEGER,                          -- NULL = unlimited
    uses          INTEGER NOT NULL DEFAULT 0,
    expires_at    DATETIME,                         -- NULL = never expires
    email_pattern TEXT,                             -- NULL | 'uef.fi' (beats the global allowlist)
    note          TEXT,                             -- admin's own label, never shown publicly
    created_by    INTEGER NOT NULL REFERENCES users(id),
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at    DATETIME,
    revoked_by    INTEGER REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_invites_token
    ON registration_invites(token);

CREATE INDEX IF NOT EXISTS idx_registration_invites_tenant
    ON registration_invites(tenant_id, created_at);

-- The redemption ledger: who actually came in on which invite. Kept separate
-- from the counter so a revoked invite still tells you who it let in.
CREATE TABLE IF NOT EXISTS registration_invite_uses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_id  INTEGER NOT NULL REFERENCES registration_invites(id),
    user_id    INTEGER REFERENCES users(id),
    used_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_registration_invite_uses_invite
    ON registration_invite_uses(invite_id);
