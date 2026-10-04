// Report a problem — the relay between a signed-in person's page and Prova (the team's test and issue
// service). Owner's design, 2026-10-02: one row in the user menu, "Report a problem…" and "My reports".
//
//   POST /api/report        — one report: what happened, what was expected, steps, an optional screenshot
//                             (≤ 2 MB) and the technical block the page shows under "Sent with it".
//   GET  /api/reports/mine  — this person's reports and their status (Received / Being worked on /
//                             Fixed in <version> / Closed with a reason); `?seen=1` clears the news.
//
// The browser never talks to Prova. This server checks the body (no document or case content; the vendored
// relay refuses content-like fields and anything it does not know), adds the SIGNED-IN username — never one
// the page states — and Rohy's version, and forwards with this installation's key. The key never reaches the
// browser: it is configured (ROHY_PROVA_INSTALLATION_KEY, a key minted in Prova for an installation we run,
// which starts trusted) or registered with Prova on first use and kept in ROHY_REPORT_KEY_FILE (default:
// beside the database, mode 0600). In production the installation registers at start.
//
// Env: ROHY_PROVA_URL (production default https://prova.lacarm.com; elsewhere reporting is off unless set;
// "off" turns it off), ROHY_PROVA_INSTALLATION_KEY, ROHY_REPORT_KEY_FILE, ROHY_REPORT_LABEL (default "Rohy"),
// ROHY_REPORT_HOST (default: the request's Host).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticateToken, requireAuth } from '../middleware/auth.js';
import { auditSuccess } from './_helpers.js';
import { logger } from '../logger.js';
import { RelayError, createRelay } from '../lib/prova-relay.js';

const router = express.Router();
const log = logger('report');
const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_PROVA_URL = 'https://prova.lacarm.com';
export const REPORT_NOT_CONFIGURED = 'report_not_configured';

const rohyVersion = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.join(SERVER_DIR, '..', 'package.json'), 'utf8')).version || '0.0.0';
    } catch (err) {
        log.warn('package.json unreadable; reports carry version 0.0.0', { error: err.message });
        return '0.0.0';
    }
})();

/** Where reports go, from the environment. `null` = reporting is off on this installation. */
export function reportSettings() {
    const asked = (process.env.ROHY_PROVA_URL || '').trim();
    if (asked === 'off') return null;
    const provaUrl = asked || (process.env.NODE_ENV === 'production' ? DEFAULT_PROVA_URL : '');
    if (!provaUrl) return null;
    const dbDir = path.dirname(process.env.ROHY_DB || path.join(SERVER_DIR, 'database.sqlite'));
    return {
        provaUrl,
        keyFile: process.env.ROHY_REPORT_KEY_FILE || path.join(dbDir, 'report-key.json'),
        installationKey: (process.env.ROHY_PROVA_INSTALLATION_KEY || '').trim() || undefined,
        label: (process.env.ROHY_REPORT_LABEL || 'Rohy').trim().slice(0, 80) || 'Rohy',
        // The address Prova shows beside the label ("beyza · via Rohy · rohy.lacarm.com"); else the request's Host.
        host: (process.env.ROHY_REPORT_HOST || '').trim() || null,
    };
}

let relay = null;
let relayFor = null;
function currentRelay(req) {
    const settings = reportSettings();
    if (!settings) return null;
    const host = settings.host ?? req?.get?.('host') ?? '';
    const key = JSON.stringify({ ...settings, host });
    if (!relay || relayFor !== key) {
        relayFor = key;
        relay = createRelay({
            provaUrl: settings.provaUrl, product: 'rohy', kind: 'server', keyFile: settings.keyFile,
            installationKey: settings.installationKey,
            app: { name: settings.label, version: rohyVersion, host },
            log: (level, message) => log[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'](message),
        });
    }
    return relay;
}

// Production registers this installation at start, so it exists in Prova before anyone reports.
// Never in tests or development (no network unless ROHY_PROVA_URL is set and NODE_ENV is production).
if (process.env.NODE_ENV === 'production' && reportSettings()) {
    setImmediate(() => {
        currentRelay(null)?.ensureKey()
            .then(() => log.info('report relay: installation key ready'))
            .catch((err) => log.warn('report relay: could not register yet; the first report tries again', { error: err.message }));
    });
}

function relayError(res, err) {
    if (err instanceof RelayError) return res.status(err.status).json(err.toJSON());
    throw err;
}

// A key Prova will not take is this server's problem, never the person's sign-in: a 401 from Prova is a 502 here.
const passOn = (res, answer) => res.status(answer.status === 401 ? 502 : answer.status).json(answer.status === 401
    ? { error: 'The report service did not accept this server. Tell the administrator.', code: answer.json?.code || 'report_key_refused' }
    : answer.json);

router.post('/report', authenticateToken, requireAuth, async (req, res) => {
    const r = currentRelay(req);
    if (!r) return res.status(404).json({ error: 'Reporting a problem is not set up on this server.', code: REPORT_NOT_CONFIGURED });
    try {
        const answer = await r.report(req.body, { user: req.user.username });
        if (answer.status === 201) {
            auditSuccess(req, { action: 'report.sent', resourceType: 'app_report', resourceId: answer.json?.id ?? null, newValue: { id: answer.json?.id ?? null, duplicate: Boolean(answer.json?.duplicate) } });
            req.log.info('problem report relayed', { id: answer.json?.id ?? null });
        } else {
            req.log.warn('problem report refused', { status: answer.status, code: answer.json?.code ?? null });
        }
        return passOn(res, answer);
    } catch (err) {
        return relayError(res, err);
    }
});

// Read on every menu open: when reporting is off it answers 200 with the reason, so no page logs a failed request.
router.get('/reports/mine', authenticateToken, requireAuth, async (req, res) => {
    const r = currentRelay(req);
    if (!r) return res.json({ reports: [], news: 0, code: REPORT_NOT_CONFIGURED });
    // A READ never registers this installation. With no key yet nobody here
    // has reported anything, so there is nothing to list — and registering
    // from the badge's first poll put an install into Prova on page load
    // (and, when Prova answered 429, a failed request on the console) before
    // anyone had sent a report (QA 2026-10-04, PRV-38). Startup and the first
    // POST /report still register.
    if (!r.hasKey()) return res.json({ reports: [], news: 0 });
    try {
        return passOn(res, await r.mine({ user: req.user.username, seen: req.query.seen === '1' }));
    } catch (err) {
        return relayError(res, err);
    }
});

export default router;
