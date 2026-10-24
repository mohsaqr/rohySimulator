#!/usr/bin/env node
/**
 * DEPRECATED — use scripts/sweep-retention.js.
 *
 * This script used to delete rows from system_audit_log by age and then insert
 * an unhashed "retention_sweep" row. Both break the tamper-evident audit chain
 * (server/audit-chain.js: every row carries prev_hash/entry_hash, so a gap or
 * an unhashed row makes `node scripts/verify-audit-chain.js` report tampering).
 * sweep-retention.js never touches the audit table, so this file now only
 * delegates to it, preserving the command line.
 *
 * Differences a caller must know:
 *   - sweep-retention.js is a DRY RUN unless `--apply` is passed. Nothing is
 *     deleted by `node scripts/retention-sweep.js` alone any more.
 *   - The horizon is `--days N`. ROHY_RETENTION_DAYS / RETENTION_DAYS are
 *     mapped onto it when no --days is given; the *_SECONDS variables are not
 *     (the new script works in whole days), so a caller relying on them gets
 *     the 365-day default and a warning here.
 *   - system_audit_log is never swept. Audit retention needs a checkpoint-
 *     and-snapshot design first (see sweep-retention.js header).
 *   - The per-tenant Oyon sweep (oyon_settings.retention_days) that this
 *     script also ran is kept: with --apply, after sweep-retention.js
 *     succeeds, sweepOyonRetention() runs and its per-tenant counts go to
 *     stderr (stdout stays sweep-retention.js's own output, so --json is
 *     still one parseable document). Like before, that import needs
 *     JWT_SECRET in the environment.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, 'sweep-retention.js');
const args = process.argv.slice(2);

process.stderr.write('[retention-sweep] DEPRECATED: delegating to scripts/sweep-retention.js (dry run unless --apply; the audit log is never swept)\n');

if (!args.includes('--days')) {
    const days = process.env.ROHY_RETENTION_DAYS || process.env.RETENTION_DAYS;
    if (days) args.push('--days', String(days));
    else if (process.env.ROHY_RETENTION_SECONDS || process.env.RETENTION_SECONDS) {
        process.stderr.write('[retention-sweep] *_SECONDS retention variables are no longer honoured; pass --days N\n');
    }
}

const result = spawnSync(process.execPath, [target, ...args], { stdio: 'inherit', env: process.env });
if (result.status !== 0 || !args.includes('--apply')) process.exit(result.status ?? 1);

try {
    const { sweepOyonRetention } = await import('../server/routes/_helpers.js');
    const deletedByTenant = await sweepOyonRetention();
    process.stderr.write(`[retention-sweep] oyon_emotion_records deleted per tenant: ${JSON.stringify(deletedByTenant)}\n`);
    process.exit(0);
} catch (err) {
    process.stderr.write(`[retention-sweep] oyon retention sweep failed: ${err.message}\n`);
    process.exit(1);
}
