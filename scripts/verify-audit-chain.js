#!/usr/bin/env node
/**
 * Periodic audit-chain verifier.
 *
 * Walks `system_audit_log` per-tenant and recomputes the prev_hash/entry_hash
 * chain. Exits 0 on clean, 2 on tampering detected, 1 on infrastructure
 * error. Intended to run as a cron / scheduled job (daily) so the gap
 * between "tampering happens" and "tampering noticed" stays bounded.
 *
 * Usage:
 *   node scripts/verify-audit-chain.js               # all tenants
 *   node scripts/verify-audit-chain.js --tenant 1    # one tenant
 *   node scripts/verify-audit-chain.js --json        # machine-readable
 *
 * Cron example (daily at 03:17, log to syslog):
 *   17 3 * * * cd /path/to/rohy && node scripts/verify-audit-chain.js \
 *              --json | logger -t rohy-audit
 *
 * On `ok:false` the JSON output names the broken row's id, the expected
 * vs actual hash, and the tenant — pivot from there into the
 * docs/INCIDENT_RESPONSE.md "Audit chain broken" runbook.
 */

import { dbReady } from '../server/db.js';
import db from '../server/db.js';
import { verifyAuditChain } from '../server/audit-chain.js';

const args = new Set(process.argv.slice(2));
const jsonMode = args.has('--json');
const tenantArgIdx = process.argv.indexOf('--tenant');
const onlyTenant = tenantArgIdx !== -1 ? Number(process.argv[tenantArgIdx + 1]) : null;

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []))
    );
}

async function main() {
    await dbReady;

    const tenants = onlyTenant != null
        ? [{ id: onlyTenant }]
        : await dbAll('SELECT DISTINCT tenant_id AS id FROM system_audit_log ORDER BY tenant_id');

    if (tenants.length === 0) {
        if (jsonMode) console.log(JSON.stringify({ ok: true, tenants: [] }));
        else console.log('no audit rows yet — nothing to verify');
        process.exit(0);
    }

    const results = [];
    let anyBroken = false;
    for (const t of tenants) {
        const tenant_id = t.id;
        const r = await verifyAuditChain({ tenant_id });
        if (!r.ok) anyBroken = true;
        results.push({ tenant_id, ...r });
    }

    if (jsonMode) {
        console.log(JSON.stringify({ ok: !anyBroken, tenants: results }));
    } else {
        for (const r of results) {
            if (r.ok) {
                console.log(`tenant ${r.tenant_id}: OK (last verified id ${r.lastVerifiedId ?? '—'})`);
            } else {
                console.log(`tenant ${r.tenant_id}: BROKEN at id ${r.brokenAt}`);
                console.log(`  expected: ${r.expected}`);
                console.log(`  actual:   ${r.actual}`);
            }
        }
    }

    process.exit(anyBroken ? 2 : 0);
}

main().catch((err) => {
    if (jsonMode) {
        console.log(JSON.stringify({ ok: false, error: err.message }));
    } else {
        console.error(`audit-chain verifier failed: ${err.message}`);
    }
    process.exit(1);
});
