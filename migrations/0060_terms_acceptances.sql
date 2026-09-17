-- Terms of use: who accepted which version of the agreement, and what it said.
--
-- The agreement itself (required flag, title, body, version) lives in
-- platform_settings under terms_* keys, edited by an administrator; the default
-- text ships in server/shared/terms.js. This table records each acceptance.
--
-- The accepted title and body are SNAPSHOTTED on the row. Without that, a later
-- edit to the agreement would silently rewrite what every past acceptance
-- appears to have been for — which is precisely the property an acceptance
-- record exists to provide. Modelled on chatoyon+'s LicenseAcceptance.
CREATE TABLE IF NOT EXISTS terms_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- One acceptance per person per version; re-accepting is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_acceptances_user_version
  ON terms_acceptances(user_id, version);

CREATE INDEX IF NOT EXISTS idx_terms_acceptances_tenant_version
  ON terms_acceptances(tenant_id, version);
