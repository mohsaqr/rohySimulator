// Help & Support API (Stage 4 — P3/P4).
//
// Two endpoints, both authenticated and in-app only:
//
//   GET /api/help/diagnostics    — a SUPPORT BUNDLE the user can attach to a
//                                  support request. It contains only
//                                  non-sensitive primitives (version, node,
//                                  uptime, request id, boolean feature/health
//                                  flags). It is still passed through
//                                  server/redaction.js as defence-in-depth so
//                                  the redaction policy is the single place
//                                  that decides what may leave the server —
//                                  per CLAUDE.md, we do not hand-pick at the
//                                  call site and we never add raw env values.
//
//   GET /api/help/release-notes  — parsed CHANGELOG.md (Keep a Changelog
//                                  format) so the in-app "what's new" surface
//                                  has one source of truth.
import express from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { authenticateToken, requireAuth } from '../middleware/auth.js';
import { redactRow } from '../redaction.js';
import dbAdapter from '../dbAdapter.js';

const router = express.Router();

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Cheap in-process cache for the parsed changelog — it only changes on
// deploy, so re-reading + re-parsing on every request is wasted work.
let changelogCache = null;

/**
 * Parse a Keep-a-Changelog markdown body into structured releases.
 * Exported for unit testing — the parser is the part with real branches.
 *
 * @param {string} md raw CHANGELOG.md contents
 * @returns {{version:string,date:string,summary:string,
 *            sections:Object<string,string[]>}[]}
 */
export function parseChangelog(md) {
  if (typeof md !== 'string' || md.length === 0) return [];
  const releases = [];
  let current = null;
  let currentSection = null;

  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    // "## [2.1.0] — 2026-05-14"  (em dash or hyphen, date optional)
    const head = line.match(/^##\s+\[([^\]]+)\]\s*[—-]?\s*(.*)$/);
    if (head) {
      if (current) releases.push(current);
      current = {
        version: head[1].trim(),
        date: head[2].trim(),
        summary: '',
        sections: {},
      };
      currentSection = null;
      continue;
    }
    if (!current) continue;

    // "### Added" / "### Changed" / ...
    const sec = line.match(/^###\s+(.+)$/);
    if (sec) {
      currentSection = sec[1].trim();
      current.sections[currentSection] = [];
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet && currentSection) {
      current.sections[currentSection].push(bullet[1].trim());
    } else if (line && !currentSection && !line.startsWith('#')) {
      current.summary = current.summary
        ? `${current.summary} ${line}`.trim()
        : line.trim();
    }
  }
  if (current) releases.push(current);
  return releases;
}

router.get('/help/release-notes', authenticateToken, requireAuth, async (req, res) => {
  try {
    if (!changelogCache) {
      const md = await readFile(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
      changelogCache = parseChangelog(md);
    }
    res.json({ releases: changelogCache, latest: changelogCache[0]?.version ?? null });
  } catch (err) {
    res.status(500).json({ error: 'release_notes_unavailable', message: err.message });
  }
});

router.get('/help/diagnostics', authenticateToken, requireAuth, async (req, res) => {
  let dbReachable = false;
  try {
    await dbAdapter.get('SELECT 1 AS ok');
    dbReachable = true;
  } catch {
    dbReachable = false;
  }

  // Only non-sensitive primitives. No env VALUES — booleans only.
  const bundle = {
    generatedAt: new Date().toISOString(),
    requestId: req.id || req.headers['x-request-id'] || null,
    app: { name: 'rohy', version: process.env.npm_package_version || null },
    runtime: {
      node: process.version,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
    },
    health: {
      dbReachable,
      nodeEnv: process.env.NODE_ENV || 'development',
      oyonEnabled: process.env.OYON_ENABLED === '1',
      tlsConfigured: Boolean(process.env.TLS_CERT_PATH && process.env.TLS_KEY_PATH),
    },
    user: { id: req.user?.id ?? null, role: req.user?.role ?? null },
  };

  // Defence-in-depth: the redaction policy is the single authority on what
  // leaves the server. Nothing here is registered sensitive, so this is a
  // no-op today — but if a future edit adds a sensitive key, redaction
  // catches it instead of it silently shipping.
  res.json(redactRow(bundle));
});

export default router;
