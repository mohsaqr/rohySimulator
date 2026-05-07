/**
 * Structured logger.
 *
 * Audit follow-up: server/ had ad-hoc console.log / console.warn /
 * console.error scattered across modules. Production observability
 * (ship to Loki / OTLP / etc.) needs structured JSON, not freeform text.
 *
 * Design:
 *   - One factory: `logger(component)` returns a per-component logger
 *     bound to a `component` field. Use it everywhere instead of bare
 *     console.* calls.
 *   - Output is one JSON object per line (newline-delimited JSON).
 *   - Standard fields: ts (ISO8601), level, component, msg, plus any
 *     extra structured fields the caller passes.
 *   - In TTY-attached dev mode, prints a colorised single-line summary
 *     instead of JSON so logs are readable without piping through jq.
 *
 * Migration: existing console.* calls keep working. New code should
 * import `logger`. A future sweep can swap call sites — see the audit
 * follow-up "Structured logging schema" item.
 */

const LEVELS = ['debug', 'info', 'warn', 'error'];
const LEVEL_RANK = Object.fromEntries(LEVELS.map((l, i) => [l, i]));

function currentLevel() {
    const env = (process.env.LOG_LEVEL || 'info').toLowerCase();
    return LEVEL_RANK[env] ?? LEVEL_RANK.info;
}

function shouldEmit(level) {
    return LEVEL_RANK[level] >= currentLevel();
}

function isStructuredEnv() {
    // Tests, production, and explicit LOG_FORMAT=json all get JSON.
    // TTY-attached dev gets pretty single-line.
    if (process.env.LOG_FORMAT === 'json') return true;
    if (process.env.LOG_FORMAT === 'pretty') return false;
    if (process.env.NODE_ENV === 'production') return true;
    if (process.env.NODE_ENV === 'test') return true;
    return !process.stdout.isTTY;
}

function formatPretty(level, component, msg, fields) {
    const colour = {
        debug: '\x1b[37m',  // grey
        info:  '\x1b[36m',  // cyan
        warn:  '\x1b[33m',  // yellow
        error: '\x1b[31m',  // red
    }[level] || '';
    const reset = '\x1b[0m';
    const time = new Date().toISOString().slice(11, 23);
    const head = `${colour}${time} ${level.padEnd(5)} ${component.padEnd(16)}${reset}`;
    const extras = Object.keys(fields).length
        ? ' ' + Object.entries(fields)
            .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join(' ')
        : '';
    return `${head} ${msg}${extras}`;
}

function emit(level, component, msg, fields) {
    if (!shouldEmit(level)) return;
    const entry = {
        ts: new Date().toISOString(),
        level,
        component,
        msg: typeof msg === 'string' ? msg : String(msg),
        ...fields,
    };
    const line = isStructuredEnv()
        ? JSON.stringify(entry)
        : formatPretty(level, component, entry.msg, fields);
    if (level === 'error') process.stderr.write(line + '\n');
    else if (level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
}

/**
 * Build a per-component logger. Caller does:
 *   const log = logger('auth');
 *   log.info('login ok', { user_id: 7 });
 *   log.error('verify failed', { reason: err.message });
 */
export function logger(component) {
    return {
        debug: (msg, fields = {}) => emit('debug', component, msg, fields),
        info:  (msg, fields = {}) => emit('info',  component, msg, fields),
        warn:  (msg, fields = {}) => emit('warn',  component, msg, fields),
        error: (msg, fields = {}) => emit('error', component, msg, fields),
        // Convenience: log + return the value, useful for `return log.info(x, ...)`
        // patterns where you want to keep the function body terse.
        child: (extra = {}) => {
            // Sub-logger that auto-adds `extra` fields to every emit.
            const sub = {};
            for (const lvl of LEVELS) {
                sub[lvl] = (msg, fields = {}) => emit(lvl, component, msg, { ...extra, ...fields });
            }
            return sub;
        },
    };
}

// Test-only helper to read the current effective level without mutating env.
export function _effectiveLevelForTest() {
    return LEVELS[currentLevel()];
}
