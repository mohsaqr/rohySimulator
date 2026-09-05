/**
 * The one write path into `learning_events`.
 *
 * Before this module existed there were ten: the single and batch ingest
 * routes (which disagreed about limiters, vitals and client_time), three
 * auth writers, four order writers, the settings dual-write and the plugin
 * server slot. Three of the order writers omitted severity/category — the
 * exact regression the registry was moved server-side to fix — and the auth
 * writers used verbs the registry did not contain, so the ingest route would
 * have rejected the server's own rows.
 *
 * Every writer now goes through `ingestEvents()`. It normalises historical
 * verb names, checks the registry, derives severity/category, resolves the
 * session trinity with the principal, stamps the server's clock, names
 * every column (RPS-1 R32 — the table still carries a legacy DEFAULT on
 * `timestamp`), and — the property this module exists for — never discards
 * an event silently: whatever cannot be inserted is written to
 * `learning_events_rejected` with its reason, so a dropped click is a row an
 * operator can see rather than a counter that only the caller ever reads.
 */
import dbAdapter from '../dbAdapter.js';
import { LEARNING_VERBS, SERVER_ONLY_VERBS, normalizeVerb, resolveEventMetadata } from '../shared/learningVerbs.js';
import { resolvePluginAttribution } from '../shared/pluginRegistry.js';
import { resolveSessionTrinity, logAuditAsync } from '../routes/_helpers.js';
import { anchorToServer, toIsoZ, nowIso } from '../shared/time.js';
import { logger } from '../logger.js';

const log = logger('learning-event-ingest');

/** Batch cap: BackendSurface caps its own queue at 500, so anything larger is a bug or an attack. */
export const MAX_BATCH_EVENTS = 500;

/** A quarantined payload is truncated past this many bytes of JSON. */
export const REJECTED_PAYLOAD_MAX_BYTES = 4096;

/** Every reason a row can fail to reach learning_events. The first six are the
 *  pre-existing `dropped_reasons` contract and are ALWAYS present in a response. */
export const DROP_REASONS = Object.freeze([
    'cross_tenant', 'not_owner', 'missing_required_field', 'unknown_verb', 'invalid_metadata', 'db_error',
    'server_only_verb', 'payload_too_large',
]);

/** Reasons an attribution field is stripped while the row is still inserted. */
export const STRIP_REASONS = Object.freeze(['unknown_plugin', 'plugin_verb_mismatch', 'plugin_version_mismatch']);

const SERVER_ONLY = new Set(SERVER_ONLY_VERBS);
const FORGERY = new Set(['not_owner', 'cross_tenant']);

const INSERT_SQL = `
    INSERT INTO learning_events (
        session_id, user_id, case_id, verb,
        object_type, object_id, object_name,
        component, parent_component,
        result, duration_ms, context,
        message_content, message_role, timestamp, client_time, tenant_id,
        severity, category,
        vital_hr, vital_spo2, vital_bp_sys, vital_bp_dia,
        vital_rr, vital_temp, vital_etco2, vital_rhythm,
        room, plugin_id, plugin_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?)
`;

const REJECT_SQL = `
    INSERT INTO learning_events_rejected (
        tenant_id, user_id, session_id, received_at, reason, source,
        verb, object_type, payload_json, client_time, plugin_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function zeroed(keys) {
    return Object.fromEntries(keys.map((k) => [k, 0]));
}

function jsonOrNull(value) {
    if (value === undefined || value === null) return null;
    try { return JSON.stringify(value); } catch { return null; }
}

/**
 * What the quarantine keeps of a payload. A forgery (a row for a session the
 * caller does not own) keeps only the SHAPE — key names and lengths — because
 * attacker-supplied prose must not be persisted under a victim's tenant. Any
 * other rejection keeps the payload, truncated.
 */
function quarantinePayload(event, reason) {
    if (FORGERY.has(reason)) {
        const shape = Object.fromEntries(Object.entries(event || {}).map(([k, v]) => [
            k, typeof v === 'string' ? `string(${v.length})` : Array.isArray(v) ? `array(${v.length})` : typeof v,
        ]));
        return JSON.stringify({ _shape: shape });
    }
    let json = jsonOrNull(event) ?? 'null';
    if (Buffer.byteLength(json, 'utf8') > REJECTED_PAYLOAD_MAX_BYTES) {
        json = JSON.stringify({
            _truncated: true,
            _bytes: Buffer.byteLength(json, 'utf8'),
            _keys: Object.keys(event || {}),
            verb: event?.verb ?? null,
            object_type: event?.object_type ?? null,
        });
    }
    return json;
}

/**
 * Ingest a list of events under one tenant and one principal.
 *
 * @param {object} args
 * @param {number}  args.tenantId
 * @param {{id:number, username?:string}|null} args.principal  the caller; null
 *        means "the server itself is writing on the owner's behalf" and skips
 *        the ownership check (a server writer chose the session id itself)
 * @param {object[]} args.events  rows in the wire shape (snake_case)
 * @param {number}  [args.receivedMs=Date.now()]  read ONCE per call
 * @param {string}  [args.source='batch']  'single' | 'batch' | 'plugin:<id>' | 'server:<route>'
 * @param {object}  [args.req]  for req.log and audit only — never for tenant/user
 * @param {boolean} [args.allowServerOnly=false]  the server may write server-only verbs
 * @returns {Promise<{inserted:number, dropped:number, quarantined:number, total:number,
 *           dropped_reasons:Record<string,number>, stripped_reasons:Record<string,number>,
 *           rowIds:number[], firstReason:string|null, firstStatus:number|null}>}
 */
export async function ingestEvents({
    tenantId, principal, events, receivedMs = Date.now(), source = 'batch', req = null, allowServerOnly = false,
}) {
    const out = {
        inserted: 0,
        dropped: 0,
        quarantined: 0,
        total: Array.isArray(events) ? events.length : 0,
        dropped_reasons: zeroed(DROP_REASONS),
        stripped_reasons: zeroed(STRIP_REASONS),
        rowIds: [],
        firstReason: null,
        firstStatus: null,
    };
    if (!Array.isArray(events) || events.length === 0) return out;

    const principalUserId = principal?.id ?? null;

    // Trinity once per distinct session id. `principal` is what stops a batch
    // carrying events for a session the caller does not own — the server would
    // otherwise derive the VICTIM's user_id and write the forged row under
    // their name.
    const distinct = [...new Set(events.map((e) => e?.session_id).filter(Boolean))];
    const trinity = new Map();
    await Promise.all(distinct.map(async (sid) => {
        trinity.set(sid, await resolveSessionTrinity(sid, tenantId, { principal }));
    }));

    const reject = async (event, reason, extra = {}) => {
        out.dropped++;
        out.dropped_reasons[reason] = (out.dropped_reasons[reason] || 0) + 1;
        if (out.firstReason === null) {
            out.firstReason = reason;
            out.firstStatus = statusForReason(reason);
        }
        try {
            await dbAdapter.run(REJECT_SQL, [
                tenantId,
                principalUserId,
                Number.isFinite(Number(event?.session_id)) ? Number(event.session_id) : null,
                nowIso(),
                reason,
                source,
                typeof event?.verb === 'string' ? event.verb.slice(0, 120) : null,
                typeof event?.object_type === 'string' ? event.object_type.slice(0, 120) : null,
                quarantinePayload(event, reason),
                toIsoZ(event?.client_time ?? event?.timestamp) ?? null,
                typeof event?.plugin_id === 'string' ? event.plugin_id.slice(0, 64) : null,
            ]);
            out.quarantined++;
        } catch (err) {
            // The quarantine itself failing must not hide the drop: it is
            // still counted, and the failure is loud.
            (req?.log || log).warn('learning event could not be quarantined', { reason, error: err.message, ...extra });
        }
        if (FORGERY.has(reason)) {
            // A forgery is a security event, not telemetry noise: the audit
            // chain gets the fact (who, which session), never the payload.
            // AWAITED, unlike the fire-and-forget logAudit: the response says
            // the event was rejected, and the audit row that proves it must
            // exist by then — under CI load the chain's retry landed the row
            // after the caller had already read the table. A failed audit
            // write is warned, never allowed to fail the batch.
            try {
                await logAuditAsync({
                    userId: principalUserId,
                    username: principal?.username ?? null,
                    action: 'learning_event_rejected',
                    resourceType: 'session',
                    resourceId: event?.session_id ?? null,
                    status: 'failure',
                    errorMessage: reason,
                    metadata: { source, verb: event?.verb ?? null },
                    tenantId,
                    ipAddress: req?.ip ?? null,
                    userAgent: req?.headers?.['user-agent'] ?? null,
                });
            } catch (err) {
                (req?.log || log).warn('forgery audit write failed', { reason, error: err.message });
            }
        }
    };

    const stmt = dbAdapter.prepare(INSERT_SQL);
    try {
        const runs = [];
        for (const raw of events) {
            const event = raw && typeof raw === 'object' ? raw : {};

            if (!event.verb || !event.object_type) {
                await reject(event, 'missing_required_field');
                continue;
            }
            // Historical verb names are read as their canonical name and
            // stored as such — the alias map is the contract that no rename
            // ever costs a row.
            const verb = normalizeVerb(String(event.verb));
            if (!LEARNING_VERBS.includes(verb)) {
                await reject(event, 'unknown_verb');
                continue;
            }
            if (SERVER_ONLY.has(verb) && !allowServerOnly) {
                await reject(event, 'server_only_verb');
                continue;
            }
            const meta = resolveEventMetadata(verb, event, event.object_type);
            if (!meta.ok) {
                await reject(event, 'invalid_metadata');
                continue;
            }

            let userId;
            let caseId;
            if (event.session_id) {
                const t = trinity.get(event.session_id);
                if (!t || !t.found) {
                    await reject(event, t?.reason === 'not_owner' ? 'not_owner' : 'cross_tenant');
                    continue;
                }
                userId = t.user_id;
                caseId = t.case_id;
            } else {
                userId = event.user_id ?? principalUserId;
                caseId = null;
            }

            // Plugin attribution: metadata about provenance, never a reason to
            // lose the learner's action. A bad pair is STRIPPED and counted.
            let pluginId = null;
            let pluginVersion = null;
            if (event.plugin_id) {
                const attr = resolvePluginAttribution(event.plugin_id, event.plugin_version, verb);
                if (attr.ok) {
                    pluginId = attr.pluginId;
                    pluginVersion = attr.pluginVersion;
                    if (attr.versionMismatch) out.stripped_reasons.plugin_version_mismatch++;
                } else {
                    out.stripped_reasons[attr.reason] = (out.stripped_reasons[attr.reason] || 0) + 1;
                }
            }

            const contextJson = jsonOrNull(event.context);
            const params = [
                event.session_id || null,
                userId,
                caseId,
                verb,
                event.object_type,
                event.object_id ?? null,
                event.object_name ?? null,
                event.component ?? null,
                event.parent_component ?? null,
                event.result ?? null,
                event.duration_ms ?? null,
                contextJson,
                event.message_content ?? null,
                event.message_role ?? null,
                // The server's clock is the anchor; the device's reading is
                // kept beside it, never instead of it. `offset_ms` is how long
                // before this flush the event happened, so subtracting it
                // preserves the SPACING between a session's events exactly
                // while the anchor stays on a clock rohy controls.
                anchorToServer(receivedMs, event.offset_ms),
                toIsoZ(event.client_time ?? event.timestamp) ?? null,
                tenantId,
                meta.severity,
                meta.category,
                event.vital_hr ?? null,
                event.vital_spo2 ?? null,
                event.vital_bp_sys ?? null,
                event.vital_bp_dia ?? null,
                event.vital_rr ?? null,
                event.vital_temp ?? null,
                event.vital_etco2 ?? null,
                event.vital_rhythm ?? null,
                event.room || pluginId || null,
                pluginId,
                pluginVersion,
            ];
            runs.push(stmt.run(params).then((r) => {
                out.inserted++;
                out.rowIds.push(r.lastID);
            }, (err) => reject(event, 'db_error', { error: err.message })));
        }
        await Promise.all(runs);
    } finally {
        try { await stmt.finalize(); } catch { /* finalize errors don't change the result */ }
    }

    if (out.dropped_reasons.not_owner > 0) {
        (req?.log || log).warn('learning events for sessions the caller does not own', {
            user_id: principalUserId,
            dropped: out.dropped_reasons.not_owner,
            session_ids: distinct.filter((sid) => trinity.get(sid)?.reason === 'not_owner'),
        });
    }
    return out;
}

/** HTTP status the single-event route answers for a rejection reason. */
export function statusForReason(reason) {
    switch (reason) {
        case 'not_owner': return 403;
        case 'cross_tenant': return 404;
        case 'db_error': return 500;
        default: return 400;
    }
}

/**
 * Record ONE server-authored learning event through the ingest core.
 *
 * Replaces the hand-rolled INSERTs in auth-routes, orders-routes and the
 * settings dual-write. `scope.principal` defaults to null — the server is
 * not impersonating anyone, it IS the authority, and it chose the session
 * id itself — so the ownership check is skipped and server-only verbs are
 * allowed. Pass a principal explicitly where the row must be the caller's.
 *
 * @param {import('express').Request|null} req  for tenant/user defaults, req.log and audit
 * @param {object} event  wire-shape row (snake_case): verb, object_type, session_id?, user_id?, …
 * @param {{tenantId?: number, principal?: object|null, source?: string}} [scope]
 * @returns {Promise<ReturnType<typeof ingestEvents>>}
 */
export async function recordServerEvent(req, event, scope = {}) {
    const tenantId = scope.tenantId ?? req?.user?.tenant_id ?? 1;
    const principal = Object.prototype.hasOwnProperty.call(scope, 'principal') ? scope.principal : null;
    const result = await ingestEvents({
        tenantId,
        principal,
        events: [{ user_id: req?.user?.id ?? null, ...event }],
        source: scope.source ?? `server:${event.verb}`,
        req,
        allowServerOnly: true,
    });
    if (result.inserted === 0) {
        (req?.log || log).warn('server-side learning event was not persisted', {
            verb: event.verb, reason: result.firstReason,
        });
    }
    return result;
}
