-- The rohy knowledge base.
--
-- One queryable record of what this repository knows about itself: every
-- commit, every release, every triaged bug, every recorded learning, every
-- migration, and the design documents that explain them — in one SQLite file
-- with full-text search across all of it.
--
-- ## This database is DERIVED, and that is the whole design
--
-- Nothing here is authored. Every row is parsed out of something that already
-- exists in the repo — git history, CHANGELOG.md, reports/, LEARNINGS.md,
-- migrations/MANIFEST.md, docs/. `npm run kb:build` drops and rebuilds it from
-- scratch, deterministically. Two consequences, both deliberate:
--
--   * **There is no second source of truth to keep in sync.** A knowledge base
--     you have to remember to update is a knowledge base that is wrong. To
--     record something new, write it where it belongs — a commit message, a
--     CHANGELOG entry, a LEARNINGS bullet — and rebuild.
--   * **The file is never committed.** Carm's equivalent (`data/knowledge.db`)
--     was re-committed on every update and now accounts for 6.24 GB of that
--     repo's history, with the website copies adding another 2.6 GB — recorded
--     in its own AGENT-NOTE-git-bloat.md. A regenerable artifact belongs in
--     .gitignore. Ours rebuilds in seconds from sources that are already
--     versioned.
--
-- Provenance is therefore a path, not a chain of custody: every derived row
-- carries `source_path` (and `source_line` where the parser can be precise) so
-- any claim can be traced back to the file it was read from.
--
-- Timestamps follow the rohy time contract (RPS-1 §17): UTC ISO-8601 with an
-- explicit Z and milliseconds. `strftime('%Y-%m-%dT%H:%M:%fZ','now')` is the
-- SQL spelling of it.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE kb_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Modules — the areas a commit, bug or learning can be *about*.
--
-- Derived from path prefixes rather than declared by hand, so a new directory
-- cannot silently fall outside the map: anything unmatched lands in 'other',
-- and a growing 'other' is the signal to add a row here.
-- ---------------------------------------------------------------------------
CREATE TABLE module (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN
                ('server','client','plugin','shared','migrations','docs','tests','build','other')),
  path_prefix TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Releases and the individual changes inside them — "the news".
--
-- A release is one `## [x.y.z]` section of CHANGELOG.md. A change is one
-- bullet inside it, kept separately so a search can land on the specific
-- statement rather than on a 200-line release note.
-- ---------------------------------------------------------------------------
CREATE TABLE release (
  version      TEXT PRIMARY KEY,
  released_on  TEXT,
  body         TEXT NOT NULL,
  commit_sha   TEXT,
  source_path  TEXT NOT NULL,
  source_line  INTEGER
);
CREATE INDEX idx_release_date ON release(released_on DESC);

CREATE TABLE change (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     TEXT NOT NULL REFERENCES release(version) ON DELETE CASCADE,
  kind        TEXT NOT NULL,        -- Added / Fixed / Changed / Removed / Security
  headline    TEXT NOT NULL,        -- the bolded lead of the bullet, when it has one
  body        TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_line INTEGER
);
CREATE INDEX idx_change_version ON change(version);
CREATE INDEX idx_change_kind    ON change(kind);

-- ---------------------------------------------------------------------------
-- Commits — the full history, parsed.
--
-- `version`, `type` and `scope` are pulled out of the subject line because this
-- repo's convention writes them there (`fix(logs): … (v2.9.93)`), which makes
-- "every commit that touched auth" and "what shipped in 2.9.40" answerable
-- without a full-text scan.
-- ---------------------------------------------------------------------------
CREATE TABLE commit_log (
  sha           TEXT PRIMARY KEY,
  short_sha     TEXT NOT NULL,
  parent_sha    TEXT,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  author_name   TEXT,
  author_email  TEXT,
  authored_at   TEXT NOT NULL,      -- ISO-8601 UTC, contract shape
  version       TEXT,               -- from a trailing '(vX.Y.Z)'
  type          TEXT,               -- conventional-commit type
  scope         TEXT,               -- conventional-commit scope
  files_changed INTEGER NOT NULL DEFAULT 0,
  insertions    INTEGER NOT NULL DEFAULT 0,
  deletions     INTEGER NOT NULL DEFAULT 0,
  files         TEXT NOT NULL DEFAULT '[]',   -- JSON array of paths
  modules       TEXT NOT NULL DEFAULT '[]'    -- JSON array of module.id
);
CREATE INDEX idx_commit_authored ON commit_log(authored_at DESC);
CREATE INDEX idx_commit_version  ON commit_log(version);
CREATE INDEX idx_commit_type     ON commit_log(type);
CREATE INDEX idx_commit_scope    ON commit_log(scope);

-- ---------------------------------------------------------------------------
-- Bugs — from the triage reports under reports/.
--
-- `verdict` is the triage author's own judgement and is preserved verbatim:
-- MISUNDERSTANDING and CANNOT VERIFY are findings, not absences, and a base
-- that silently dropped them would make the same wrong claim get re-filed.
-- ---------------------------------------------------------------------------
CREATE TABLE bug (
  id               TEXT PRIMARY KEY,
  report           TEXT NOT NULL,      -- which triage document
  number           TEXT,               -- its number within that report
  report_version   TEXT,               -- the release the report was written against
  title            TEXT NOT NULL,
  verdict          TEXT,
  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','fixed','invalid','deferred','unknown')),
  root_cause       TEXT,
  refs             TEXT NOT NULL DEFAULT '[]',   -- JSON array of file:line strings
  modules          TEXT NOT NULL DEFAULT '[]',
  fixed_in_version TEXT,
  reported_on      TEXT,
  source_path      TEXT NOT NULL,
  source_line      INTEGER
);
CREATE INDEX idx_bug_status  ON bug(status);
CREATE INDEX idx_bug_verdict ON bug(verdict);
CREATE INDEX idx_bug_report  ON bug(report);

-- ---------------------------------------------------------------------------
-- Learnings — one row per bullet in LEARNINGS.md.
--
-- Bullet granularity, not section: these are independent claims that happen to
-- share a date, and a search for "tenant scoping" should return the sentence
-- about it rather than the day it was written.
-- ---------------------------------------------------------------------------
CREATE TABLE learning (
  id          TEXT PRIMARY KEY,        -- 'L-0001'
  recorded_on TEXT,
  topic       TEXT,                    -- the section heading's parenthetical
  headline    TEXT,                    -- the bolded lead, when the bullet has one
  body        TEXT NOT NULL,
  refs        TEXT NOT NULL DEFAULT '[]',
  modules     TEXT NOT NULL DEFAULT '[]',
  source_path TEXT NOT NULL,
  source_line INTEGER
);
CREATE INDEX idx_learning_date ON learning(recorded_on DESC);

-- ---------------------------------------------------------------------------
-- Insights — durable notes that are not release notes and not learnings:
-- the agent notes and the per-project memory files.
-- ---------------------------------------------------------------------------
CREATE TABLE insight (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('agent-note','memory','handoff','design')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  recorded_on TEXT,
  modules     TEXT NOT NULL DEFAULT '[]',
  source_path TEXT NOT NULL
);
CREATE INDEX idx_insight_kind ON insight(kind);

-- ---------------------------------------------------------------------------
-- Migrations — the schema's own history, from migrations/MANIFEST.md.
--
-- `type` carries the additive/destructive metadata that `bin/rohy-update` and
-- reviewers read, so "has anything destructive ever shipped" is one query.
-- ---------------------------------------------------------------------------
CREATE TABLE migration (
  id          TEXT PRIMARY KEY,        -- '0050'
  file        TEXT NOT NULL,
  type        TEXT NOT NULL,           -- additive | destructive | …
  notes       TEXT NOT NULL,
  source_path TEXT NOT NULL
);
CREATE INDEX idx_migration_type ON migration(type);

-- ---------------------------------------------------------------------------
-- Documents — design docs, feature reports and guides, indexed whole so a
-- search can point at the document that already answers the question.
-- ---------------------------------------------------------------------------
CREATE TABLE doc (
  path        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL,           -- design | report | admin | integrator | …
  headings    TEXT NOT NULL DEFAULT '[]',
  words       INTEGER NOT NULL DEFAULT 0,
  body        TEXT NOT NULL
);
CREATE INDEX idx_doc_kind ON doc(kind);

-- ---------------------------------------------------------------------------
-- One search index across every entity above.
--
-- `porter unicode61` so "ordering" finds "ordered"; entity_id is UNINDEXED
-- because it is a key to join on, never a term to match.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  entity_kind,
  entity_id UNINDEXED,
  title,
  body,
  tokenize = 'porter unicode61'
);

-- Triggers rather than a build-time population pass: the index cannot drift
-- from the table even if a future ingester forgets, which is the failure a
-- separate pass invites.
CREATE TRIGGER release_ai AFTER INSERT ON release BEGIN
  INSERT INTO knowledge_fts(entity_kind, entity_id, title, body)
  VALUES ('release', new.version, 'v' || new.version, new.body);
END;
CREATE TRIGGER change_ai AFTER INSERT ON change BEGIN
  INSERT INTO knowledge_fts(entity_kind, entity_id, title, body)
  VALUES ('change', new.id, new.headline, new.body);
END;
CREATE TRIGGER commit_ai AFTER INSERT ON commit_log BEGIN
  INSERT INTO knowledge_fts(entity_kind, entity_id, title, body)
  VALUES ('commit', new.sha, new.subject, new.body || ' ' || new.files);
END;
CREATE TRIGGER bug_ai AFTER INSERT ON bug BEGIN
  INSERT INTO knowledge_fts(entity_kind, entity_id, title, body)
  VALUES ('bug', new.id, new.title, COALESCE(new.root_cause,'') || ' ' || COALESCE(new.verdict,''));
END;
CREATE TRIGGER learning_ai AFTER INSERT ON learning BEGIN
  INSERT INTO knowledge_fts(entity_kind, entity_id, title, body)
  VALUES ('learning', new.id, COALESCE(new.headline, substr(new.body,1,80)), new.body);
END;
CREATE TRIGGER insight_ai AFTER INSERT ON insight BEGIN
  INSERT INTO knowledge_fts(entity_kind, entity_id, title, body)
  VALUES ('insight', new.id, new.title, new.body);
END;
CREATE TRIGGER migration_ai AFTER INSERT ON migration BEGIN
  INSERT INTO knowledge_fts(entity_kind, entity_id, title, body)
  VALUES ('migration', new.id, new.file, new.notes);
END;
CREATE TRIGGER doc_ai AFTER INSERT ON doc BEGIN
  INSERT INTO knowledge_fts(entity_kind, entity_id, title, body)
  VALUES ('doc', new.path, new.title, new.body);
END;
