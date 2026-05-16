// Stage 4 (P3/P4) — Help & Support API.
//
// Locks two contracts:
//  1. parseChangelog correctly structures Keep-a-Changelog markdown.
//  2. The endpoints require auth and the diagnostics bundle contains NO
//     secrets/PII (only version/runtime/boolean health flags).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import { startTestServer } from '../utils/startTestServer.js';
import { parseChangelog } from '../../server/routes/help-routes.js';

const PASSWORD = 'HelpT3sts!';

function openDb(dbPath) {
  const sqlite = sqlite3.verbose();
  return new Promise((resolve, reject) => {
    const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
  });
}
function closeDb(db) {
  return new Promise((r) => db.close(() => r()));
}
function pRun(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function done(err) {
      err ? reject(err) : resolve(this);
    }),
  );
}
async function seedAdmin(db, username) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pRun(
    db,
    `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
     VALUES (?, ?, ?, ?, 'admin', 1, 'active')`,
    [username, username, `${username}@example.com`, hash],
  );
}

describe('parseChangelog', () => {
  it('parses version, date, summary and sections', () => {
    const md = [
      '# Changelog',
      '',
      '## [2.1.0] — 2026-05-14',
      '',
      'Minor release. Version badge.',
      '',
      '### Added',
      '- **Feature.** Did a thing.',
      '- Another thing.',
      '',
      '### Fixed',
      '- A bug.',
      '',
      '## [2.0.0] — 2026-01-01',
      '',
      '### Added',
      '- Initial.',
    ].join('\n');
    const out = parseChangelog(md);
    expect(out).toHaveLength(2);
    expect(out[0].version).toBe('2.1.0');
    expect(out[0].date).toBe('2026-05-14');
    expect(out[0].summary).toBe('Minor release. Version badge.');
    expect(out[0].sections.Added).toEqual(['**Feature.** Did a thing.', 'Another thing.']);
    expect(out[0].sections.Fixed).toEqual(['A bug.']);
    expect(out[1].version).toBe('2.0.0');
  });

  it('is defensive against empty / non-string input', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog(null)).toEqual([]);
    expect(parseChangelog(undefined)).toEqual([]);
  });
});

describe('Help & Support API', () => {
  let server;
  let token;

  beforeAll(async () => {
    server = await startTestServer({ seed: false });
    const db = await openDb(server.dbPath);
    try {
      await seedAdmin(db, 'help-admin');
    } finally {
      await closeDb(db);
    }
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'help-admin', password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login → ${res.status}`);
    token = (await res.json()).token;
  });

  afterAll(async () => {
    await server?.close();
  });

  it('rejects unauthenticated diagnostics', async () => {
    const r = await fetch(`${server.baseUrl}/api/help/diagnostics`);
    expect(r.status).toBe(401);
  });

  it('returns a diagnostics bundle with no secrets/PII', async () => {
    const r = await fetch(`${server.baseUrl}/api/help/diagnostics`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.health).toMatchObject({
      dbReachable: true,
      oyonEnabled: expect.any(Boolean),
      tlsConfigured: expect.any(Boolean),
    });
    expect(body.runtime.node).toMatch(/^v\d/);
    // No env values / secrets must appear anywhere in the serialized bundle.
    const flat = JSON.stringify(body).toLowerCase();
    expect(flat).not.toContain('rohy-tests-secret');
    expect(flat).not.toMatch(/secret|password|api_key|apikey|token"/);
  });

  it('returns parsed release notes', async () => {
    const r = await fetch(`${server.baseUrl}/api/help/release-notes`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.releases)).toBe(true);
    expect(body.releases.length).toBeGreaterThan(0);
    expect(body.latest).toBe(body.releases[0].version);
  });
});
