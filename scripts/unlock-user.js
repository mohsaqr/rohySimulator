#!/usr/bin/env node
/**
 * Lift a login lockout from the command line (security audit 2026-10-26, F-11).
 *
 * Five wrong passwords lock an account for 15 minutes (server/routes/auth-routes.js).
 * In the app an admin lifts it early by setting the user's status to Active or
 * resetting their password — but the rank guard stops an admin acting on a PEER
 * admin, so a sole admin who is locked out has no in-app way back. This is that
 * way back, for whoever can run commands on the server.
 *
 * It clears `failed_login_attempts` and `locked_until`, nothing else: status,
 * password and sessions are untouched. The act is written to the audit chain.
 *
 * Usage:
 *   node scripts/unlock-user.js <username>
 *   node scripts/unlock-user.js --id 42
 *   ROHY_DB=/path/to/database.sqlite node scripts/unlock-user.js admin
 *
 * Exit codes: 0 unlocked (or was not locked), 1 error, 3 no such user.
 */

import '../server/bootstrap-env.js';
import dbAdapter from '../server/dbAdapter.js';
import { dbReady } from '../server/db.js';
import { appendAuditEntry } from '../server/audit-chain.js';
import { clearLoginLock } from '../server/lib/accountSessions.js';

function parseArgs(argv) {
    const idIdx = argv.indexOf('--id');
    if (idIdx !== -1) return { id: Number(argv[idIdx + 1]), username: null };
    const username = argv.find((a) => !a.startsWith('--'));
    return { id: null, username: username ? username.trim() : null };
}

async function main() {
    const { id, username } = parseArgs(process.argv.slice(2));
    if (!username && !Number.isInteger(id)) {
        console.error('usage: node scripts/unlock-user.js <username> | --id <user id>');
        return 1;
    }
    await dbReady;
    const user = Number.isInteger(id)
        ? await dbAdapter.get('SELECT id, username, tenant_id, failed_login_attempts, locked_until FROM users WHERE id = ?', [id])
        : await dbAdapter.get('SELECT id, username, tenant_id, failed_login_attempts, locked_until FROM users WHERE username = ?', [username]);
    if (!user) {
        console.error(`no such user: ${username ?? `id ${id}`}`);
        return 3;
    }
    await clearLoginLock(user.id);
    await appendAuditEntry({
        userId: null,
        username: 'cli:unlock-user',
        action: 'cli_unlock_user',
        resourceType: 'user',
        resourceId: String(user.id),
        resourceName: user.username,
        oldValue: { failed_login_attempts: user.failed_login_attempts, locked_until: user.locked_until },
        newValue: { failed_login_attempts: 0, locked_until: null },
        tenantId: user.tenant_id || 1,
    });
    console.log(`unlocked ${user.username} (id ${user.id}); was ${user.locked_until ? `locked until ${user.locked_until}` : 'not locked'}, ${user.failed_login_attempts || 0} failed attempts`);
    return 0;
}

main().then((code) => process.exit(code), (err) => {
    console.error(`unlock-user failed: ${err.message}`);
    process.exit(1);
});
