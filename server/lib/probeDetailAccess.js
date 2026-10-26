/**
 * Who may read the detailed half of the public health probes.
 *
 * /api/ready and /api/health/plugins stay unauthenticated so a load balancer,
 * systemd, the Docker HEALTHCHECK and the deploy verify can probe them
 * without a token. In production their DETAIL (migration level, content
 * versions, library counts, error text, whether a directory is writable) is a
 * map of the deployment for whoever polls it, so an anonymous caller gets the
 * verdicts only and an administrator gets the rest (security audit
 * 2026-10-26, L9). Outside production everything is shown, as before.
 */
import { authenticateToken, extractToken, hasRoleAtLeast, ROLE_RANKS } from '../middleware/auth.js';

/**
 * Resolve whether the request carries a valid administrator session, using
 * the same checks as every authenticated route (signature, server-side
 * revocation, live role, terms gate) but never answering the request: a
 * missing, bad or non-admin token simply resolves false.
 *
 * @param {import('express').Request} req
 * @returns {Promise<boolean>}
 */
export function callerIsAdmin(req) {
    if (!extractToken(req).token) return Promise.resolve(false);
    return new Promise((resolve) => {
        let settled = false;
        const settle = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        // authenticateToken answers a refusal with res.status(n).json(body);
        // this stand-in turns any answer into "not an admin".
        const refusal = {
            status: () => refusal,
            json: () => { settle(false); return refusal; },
            send: () => { settle(false); return refusal; },
            end: () => { settle(false); return refusal; },
            setHeader: () => refusal,
        };
        try {
            authenticateToken(req, refusal, () => settle(hasRoleAtLeast(req.user, ROLE_RANKS.admin)));
        } catch (err) {
            req.log?.warn?.('probe detail auth check failed', { error: err?.message || String(err) });
            settle(false);
        }
    });
}

/**
 * True when the probe may show its full detail to this caller.
 *
 * @param {import('express').Request} req
 * @param {object} [env=process.env]
 * @returns {Promise<boolean>}
 */
export async function probeDetailAllowed(req, env = process.env) {
    if (env.NODE_ENV !== 'production') return true;
    return callerIsAdmin(req);
}
