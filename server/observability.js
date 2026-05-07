import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { logger } from './logger.js';

const LOG_LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const DEFAULT_SKIP_PATHS = ['/api/proxy/llm', '/health'];
const MAX_SQL_LENGTH = 500;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const INSTRUMENTED = Symbol.for('rohy.db.instrumented');
let platformSlowQueryMs = null;

const requestContext = new AsyncLocalStorage();
const dbLog = logger('db');
const observabilityLog = logger('observability');

function configuredLogLevel() {
    const level = String(process.env.ROHY_LOG_LEVEL || 'info').toLowerCase();
    return LOG_LEVELS[level] ? level : 'info';
}

export function getSlowQueryThresholdMs() {
    const parsed = Number(process.env.ROHY_SLOW_QUERY_MS);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    if (Number.isFinite(platformSlowQueryMs) && platformSlowQueryMs >= 0) return platformSlowQueryMs;
    return 100;
}

export function configureSlowQueryThresholdFromDb(db) {
    if (process.env.ROHY_SLOW_QUERY_MS || !db || typeof db.get !== 'function') return;
    db.get(
        `SELECT setting_value FROM platform_settings
         WHERE setting_key IN ('slow_query_ms', 'observability_slow_query_ms')
         ORDER BY CASE setting_key WHEN 'slow_query_ms' THEN 0 ELSE 1 END
         LIMIT 1`,
        (err, row) => {
            if (err || !row) return;
            const parsed = Number(row.setting_value);
            if (Number.isFinite(parsed) && parsed >= 0) {
                platformSlowQueryMs = parsed;
            }
        }
    );
}

export function getLogSkipPaths() {
    const raw = process.env.ROHY_LOG_SKIP_PATHS;
    if (!raw) return DEFAULT_SKIP_PATHS;
    return raw.split(',').map((p) => p.trim()).filter(Boolean);
}

export function shouldSkipRequestLog(pathname, skipPaths = getLogSkipPaths()) {
    return skipPaths.some((skip) => {
        if (!skip) return false;
        if (skip.endsWith('*')) return pathname.startsWith(skip.slice(0, -1));
        return pathname === skip || pathname.startsWith(`${skip}/`);
    });
}

export function generateRequestId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
}

export function normalizeRequestId(value) {
    const requestId = Array.isArray(value) ? value[0] : value;
    if (typeof requestId !== 'string') return null;
    const trimmed = requestId.trim();
    return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function runWithRequestContext(context, work) {
    return requestContext.run(context || {}, work);
}

export function getRequestContext() {
    return requestContext.getStore() || {};
}

export function getCurrentRequestId() {
    return getRequestContext().request_id || null;
}

function serializeError(err) {
    if (!err) return null;
    return {
        message: err.message || String(err),
        stack: err.stack || null
    };
}

export function logStructured(level, event, fields = {}) {
    const normalized = LOG_LEVELS[level] ? level : 'info';
    if (LOG_LEVELS[normalized] < LOG_LEVELS[configuredLogLevel()]) return;

    const entry = {
        timestamp: new Date().toISOString(),
        level: normalized,
        event,
        ...fields
    };

    if (entry.error instanceof Error) {
        entry.error = serializeError(entry.error);
    }

    try {
        process.stdout.write(`${JSON.stringify(entry)}\n`);
    } catch (err) {
        observabilityLog.warn('structured log write failed', { error: err.message });
    }
}

export function sanitizeSql(sql) {
    const normalized = String(sql || '')
        .replace(/'([^']|'')*'/g, '?')
        .replace(/\b\d+(?:\.\d+)?\b/g, '?')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.length > MAX_SQL_LENGTH ? `${normalized.slice(0, MAX_SQL_LENGTH)}...` : normalized;
}

export function logSlowQuery({ sql, durationMs, requestId, operation }) {
    const thresholdMs = getSlowQueryThresholdMs();
    if (durationMs < thresholdMs) return;
    logStructured('warn', 'slow_query', {
        request_id: requestId || getCurrentRequestId(),
        operation,
        duration_ms: Number(durationMs.toFixed(3)),
        threshold_ms: thresholdMs,
        sql: sanitizeSql(sql)
    });
}

export async function timeDbAdapterQuery(operation, sql, work) {
    const started = process.hrtime.bigint();
    try {
        return await requestContext.run({
            ...getRequestContext(),
            suppress_sqlite_wrapper: true
        }, work);
    } finally {
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        logSlowQuery({ operation, sql, durationMs });
    }
}

function findCallback(args) {
    for (let i = args.length - 1; i >= 0; i--) {
        if (typeof args[i] === 'function') return i;
    }
    return -1;
}

function wrapDbMethod(db, methodName) {
    const original = db[methodName];
    if (typeof original !== 'function') return;
    db[methodName] = function instrumentedDbMethod(sql, ...args) {
        const started = process.hrtime.bigint();
        const requestId = getCurrentRequestId();
        const callbackIndex = findCallback(args);
        const emitQueryLog = (durationMs, callbackArgs = [], contextThis = null) => {
            if (getRequestContext().suppress_sqlite_wrapper) return;
            const entry = {
                sql_summary: sanitizeSql(sql),
                duration_ms: Number(durationMs.toFixed(3)),
                operation: methodName,
                request_id: requestId
            };
            if (methodName === 'all' && Array.isArray(callbackArgs[1])) {
                entry.rows = callbackArgs[1].length;
            } else if (methodName === 'get') {
                entry.rows = callbackArgs[1] ? 1 : 0;
            } else if (methodName === 'run' && contextThis) {
                if (Number.isFinite(contextThis.changes)) entry.rows = contextThis.changes;
                if (Number.isFinite(contextThis.lastID)) entry.last_id = contextThis.lastID;
            }
            if (callbackArgs[0]) {
                entry.error = callbackArgs[0] instanceof Error ? callbackArgs[0].message : String(callbackArgs[0]);
            }
            dbLog.debug('sqlite query', entry);
            logSlowQuery({ operation: methodName, sql, durationMs, requestId });
        };
        if (callbackIndex >= 0) {
            const originalCallback = args[callbackIndex];
            args[callbackIndex] = function timedDbCallback(...callbackArgs) {
                const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
                emitQueryLog(durationMs, callbackArgs, this);
                return originalCallback.apply(this, callbackArgs);
            };
            return original.call(this, sql, ...args);
        }

        const result = original.call(this, sql, ...args);
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        emitQueryLog(durationMs);
        return result;
    };
}

export function instrumentSqliteDb(db) {
    if (!db || db[INSTRUMENTED]) return db;
    Object.defineProperty(db, INSTRUMENTED, { value: true });
    ['get', 'all', 'run', 'exec'].forEach((method) => wrapDbMethod(db, method));
    return db;
}
