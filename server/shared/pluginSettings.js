/**
 * RPS-1 1.4 — the settings slot.
 *
 * Imported by BOTH the client and the server (see the header of
 * pluginRegistry.js for why that means it lives under server/shared/). It is
 * DATA AND PURE FUNCTIONS ONLY — in particular it never reads `process.env`,
 * because this module is bundled into the browser, where `process` does not
 * exist and a host ceiling would be a lie anyway. Env-derived limits arrive as
 * an argument (`ceilings`), decided by the route.
 *
 * WHY A SLOT INSTEAD OF A SCREEN
 *
 * §14.4 listed "no per-tenant enable/disable" as the standard's fourth gap, and
 * the obvious fix — write a React settings page for pathology — solves it once
 * and leaves the second plugin exactly where the first one was. So the host
 * renders and stores plugin settings GENERICALLY from a manifest-declared
 * schema: a plugin gets an admin page by declaring fields, not by shipping a
 * screen. Pathology is the first user, not the only intended one.
 *
 * WHY THE STORED SHAPE IS FLAT
 *
 * Settings are stored as a flat map of dotted keys — `{'imports.enabled': true}`
 * — never as a nested object. The PUT is a key-presence merge (the same
 * semantics as `/platform-settings/voice`), and "which keys did the caller
 * actually send" is a question with one obvious answer on a flat map and
 * several defensible ones on a nested one. Deep-merge ambiguity is how a
 * partial save silently erases a sibling key. `nestSettings()` builds the
 * nested view for a plugin that would rather read `settings.imports.enabled`.
 *
 * WHY THE DEFAULT IS VALIDATED AGAINST ITS OWN FIELD
 *
 * The failure this prevents is the one the `document` block's validator was
 * written for too: a schema whose default violates its own constraint fails
 * OPEN. `maxBytes: { max: 16GiB, default: 64GiB }` would ship 64 GiB to every
 * tenant that never opened the settings page, while the page itself refused to
 * save that number. A default is a value like any other and is checked like one.
 */

/**
 * Deployment-wide ceilings a manifest may bind a numeric field to.
 *
 * A closed list, and closed for two reasons. It fails CLOSED: a manifest naming
 * an env var the host never reads would declare a ceiling that does not exist,
 * and "this deployment caps imports at 4 GiB" would be a sentence nothing
 * enforces. And it keeps the reads LITERAL — `scripts/docs-gen/gen-config.mjs`
 * discovers env vars by scanning source for their literal spelling, so a
 * computed lookup is invisible to the config reference and an operator cannot
 * find the knob.
 *
 * Adding one is two lines: a name here and a literal read in
 * server/routes/plugins-routes.js.
 */
export const HOST_CEILING_ENVS = ['ROHY_PLUGIN_IMPORT_MAX_BYTES'];

/**
 * Operator allowlists an `origins` field may be bounded BY.
 *
 * The composition is one-directional and that is the whole point: a tenant
 * admin narrows the operator's list and can never widen it. A tenant admin is
 * not the server operator — they are a role inside one deployment, and the
 * deployment's network position belongs to whoever runs it. Letting an admin
 * name an arbitrary host for the server to fetch from is the SSRF hole rohy
 * already closed once in proxy-routes.js.
 *
 * Closed for the same two reasons as HOST_CEILING_ENVS: a bound the host never
 * reads is not a bound, and the read has to stay literal to be discoverable by
 * the config reference.
 */
export const HOST_ORIGIN_ALLOWLIST_ENVS = ['ROHY_PLUGIN_IMPORT_ORIGINS'];

/** Field types the host knows how to store, validate and render. */
export const SETTING_TYPES = ['boolean', 'int', 'bytes', 'enum', 'enumList', 'origins'];

/** Types that carry a numeric range. */
const NUMERIC_TYPES = ['int', 'bytes'];
/** Types whose value is drawn from a declared `options` list. */
const OPTION_TYPES = ['enum', 'enumList'];

/**
 * Normalise one origin to `scheme://host[:port]`, or throw.
 *
 * ONE definition, used by two callers that must not disagree: the operator's
 * `ROHY_PLUGIN_ORIGINS` allowlist (server/lib/pluginRemoteOrigins.js) and a
 * plugin's own `origins`-typed settings field. They are the same kind of value
 * — "a host rohy's server may talk to" — and two copies of that rule is two
 * chances to accept a userinfo segment in one place and refuse it in the other.
 *
 * @param   {string} value  candidate origin
 * @param   {string} label  what to call it in the error message
 * @returns {string} the normalised origin
 * @throws  {Error} with a message naming `label` and the specific defect
 */
export function normalizeOrigin(value, label = 'origin') {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    let url;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error(`${label} is not a URL: '${value}'`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`${label} must be http or https, got '${url.protocol}'`);
    }
    // Credentials in the URL would be forwarded on every request and logged by
    // every intermediary. An upstream needing auth needs a design, not a
    // userinfo segment.
    if (url.username || url.password) {
        throw new Error(`${label} carries credentials in the URL; that is not a supported way to authenticate an upstream`);
    }
    // A path or query on an origin silently prefixes or corrupts every request
    // built from it. An origin is a HOST; paths belong to whatever declares them.
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
        throw new Error(`${label} must be a bare origin with no path, query or fragment`);
    }
    return url.origin;
}

/**
 * Validate a manifest's `settings` block at generation time, before any code
 * runs. Every throw here names the plugin and the field, because the person
 * reading it is looking at a manifest, not a stack trace.
 *
 * @param {object|undefined} settings  manifest.settings
 * @param {string}           pluginId
 * @returns {object|undefined} the block, unchanged
 * @throws  {Error} on any malformed group, field, type, range or default
 */
export function validateSettingsSchema(settings, pluginId) {
    if (settings === undefined) return undefined;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new Error(`Plugin '${pluginId}' declares 'settings' that is not an object`);
    }
    const unknownTop = Object.keys(settings).find((k) => k !== 'groups' && k !== 'fields');
    if (unknownTop) {
        throw new Error(`Plugin '${pluginId}' settings declares unknown key '${unknownTop}' — only groups and fields are defined`);
    }
    if (!Array.isArray(settings.groups) || settings.groups.length === 0) {
        throw new Error(`Plugin '${pluginId}' settings declares no groups — the host renders one card per group and would have nowhere to put a field`);
    }
    const groupKeys = new Set();
    settings.groups.forEach((group) => {
        if (!group || typeof group !== 'object') {
            throw new Error(`Plugin '${pluginId}' settings has a group that is not an object`);
        }
        if (!/^[a-z][a-z0-9_]*$/.test(group.key || '')) {
            throw new Error(`Plugin '${pluginId}' settings group key '${group.key}' must be lower_snake_case — it prefixes every field key in the stored map`);
        }
        if (groupKeys.has(group.key)) {
            throw new Error(`Plugin '${pluginId}' settings declares group '${group.key}' twice`);
        }
        if (!group.labelKey) {
            throw new Error(`Plugin '${pluginId}' settings group '${group.key}' has no labelKey — its card would render blank`);
        }
        groupKeys.add(group.key);
    });

    const fields = settings.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length === 0) {
        throw new Error(`Plugin '${pluginId}' settings declares no fields`);
    }
    Object.entries(fields).forEach(([key, field]) => {
        const where = `Plugin '${pluginId}' setting '${key}'`;
        // The key IS the storage key and the group membership at once, so it is
        // checked as strictly as a plugin id. A field whose prefix names no
        // declared group would be stored fine and rendered nowhere.
        const match = /^([a-z][a-z0-9_]*)\.([a-z][a-zA-Z0-9]*)$/.exec(key);
        if (!match) {
            throw new Error(`${where} must be named '<group>.<field>' in lower_snake_case and camelCase`);
        }
        if (!groupKeys.has(match[1])) {
            throw new Error(`${where} names group '${match[1]}', which the settings block does not declare`);
        }
        if (!field || typeof field !== 'object') {
            throw new Error(`${where} is not an object`);
        }
        if (!SETTING_TYPES.includes(field.type)) {
            throw new Error(`${where} declares type '${field.type}'; known types are ${SETTING_TYPES.join(', ')}`);
        }
        if (!field.labelKey) {
            throw new Error(`${where} has no labelKey — it would render as a blank row`);
        }
        if (field.default === undefined) {
            throw new Error(`${where} has no default. A tenant that never opens the settings page runs on defaults, so every field must state the value it ships with`);
        }
        if (NUMERIC_TYPES.includes(field.type)) {
            if (!Number.isInteger(field.min) || !Number.isInteger(field.max)) {
                throw new Error(`${where} is numeric and must declare integer min and max — an unbounded number reaches whatever consumes it`);
            }
            if (field.min > field.max) {
                throw new Error(`${where} declares min ${field.min} above max ${field.max}`);
            }
        }
        if (OPTION_TYPES.includes(field.type)) {
            if (!Array.isArray(field.options) || field.options.length === 0) {
                throw new Error(`${where} is an enum and declares no options`);
            }
            const bad = field.options.find((o) => typeof o !== 'string' && typeof o !== 'number');
            if (bad !== undefined) {
                throw new Error(`${where} declares a non-scalar option`);
            }
        }
        // A numeric field may name a deployment-wide ceiling an OPERATOR sets,
        // which a tenant admin can lower but never raise. The manifest names
        // the variable; only the server reads it (this module is bundled into
        // the browser, where `process` does not exist).
        if (field.ceilingEnv !== undefined) {
            if (!NUMERIC_TYPES.includes(field.type)) {
                throw new Error(`${where} declares ceilingEnv but is not numeric — a ceiling has nothing to bound`);
            }
            if (!HOST_CEILING_ENVS.includes(field.ceilingEnv)) {
                throw new Error(
                    `${where} declares ceilingEnv '${field.ceilingEnv}', which the host does not define. `
                    + `Known ceilings: ${HOST_CEILING_ENVS.join(', ')}. A ceiling the host never reads is not a limit.`
                );
            }
        }
        if (field.allowlistEnv !== undefined) {
            if (field.type !== 'origins') {
                throw new Error(`${where} declares allowlistEnv but is not an 'origins' field — an origin allowlist has nothing to bound`);
            }
            if (!HOST_ORIGIN_ALLOWLIST_ENVS.includes(field.allowlistEnv)) {
                throw new Error(
                    `${where} declares allowlistEnv '${field.allowlistEnv}', which the host does not define. `
                    + `Known allowlists: ${HOST_ORIGIN_ALLOWLIST_ENVS.join(', ')}. A bound the host never reads is not a bound.`
                );
            }
        }
        if (field.minRole !== undefined && !['guest', 'student', 'reviewer', 'educator', 'admin'].includes(field.minRole)) {
            throw new Error(`${where} declares minRole '${field.minRole}', which is not a rohy role`);
        }
        // The load-bearing check — see the header. A default is a value, and a
        // schema whose own default is out of range fails open for every tenant
        // that never visits the page.
        const checked = coerceSettingValue(field, field.default);
        if (!checked.ok) {
            throw new Error(`${where} has a default its own constraints reject: ${checked.message}`);
        }
    });
    return settings;
}

/**
 * Validate and normalise one value against one field spec.
 *
 * Returns a result rather than throwing, because the caller is usually an HTTP
 * handler that must answer 400 naming the field rather than 500.
 *
 * @param {object} field        the field spec from the schema
 * @param {*}      value        the candidate
 * @param {object} [constraint] host-imposed bounds for this field:
 *                              `{ ceiling }` for a number, `{ allowedOrigins }`
 *                              for an origins list. Always tighter than the
 *                              field's own declaration, never looser.
 * @returns {{ok: true, value: *}|{ok: false, message: string}}
 */
export function coerceSettingValue(field, value, constraint = {}) {
    switch (field.type) {
        case 'boolean':
            if (typeof value !== 'boolean') return { ok: false, message: 'must be true or false' };
            return { ok: true, value };

        case 'int':
        case 'bytes': {
            if (!Number.isInteger(value)) return { ok: false, message: 'must be an integer' };
            if (value < field.min) return { ok: false, message: `must be at least ${field.min}` };
            if (value > field.max) return { ok: false, message: `must be at most ${field.max}` };
            // The host ceiling is applied AFTER the field's own max, and is
            // never widened by it: an operator lowering the deployment-wide cap
            // must not be overridden by a manifest that declares a bigger one.
            const { ceiling } = constraint;
            if (ceiling !== undefined && value > ceiling) {
                return { ok: false, message: `exceeds this deployment's limit of ${ceiling}` };
            }
            return { ok: true, value };
        }

        case 'enum':
            if (!field.options.includes(value)) {
                return { ok: false, message: `must be one of ${field.options.join(', ')}` };
            }
            return { ok: true, value };

        case 'enumList': {
            if (!Array.isArray(value)) return { ok: false, message: 'must be a list' };
            const stray = value.find((v) => !field.options.includes(v));
            if (stray !== undefined) {
                return { ok: false, message: `'${stray}' is not one of ${field.options.join(', ')}` };
            }
            if (new Set(value).size !== value.length) return { ok: false, message: 'contains a duplicate' };
            return { ok: true, value: [...value] };
        }

        case 'origins': {
            if (!Array.isArray(value)) return { ok: false, message: 'must be a list of origins' };
            const out = [];
            for (const entry of value) {
                try {
                    out.push(normalizeOrigin(entry, 'origin'));
                } catch (err) {
                    return { ok: false, message: err.message };
                }
            }
            if (new Set(out).size !== out.length) return { ok: false, message: 'lists the same origin twice' };
            // The operator's outer bound. Checked here so a tenant admin gets a
            // 400 naming the origin rather than a save that looks successful and
            // a download that is refused later for reasons they cannot see.
            const { allowedOrigins } = constraint;
            if (allowedOrigins !== undefined) {
                const outside = out.find((o) => !allowedOrigins.includes(o));
                if (outside !== undefined) {
                    return {
                        ok: false,
                        message: allowedOrigins.length === 0
                            ? `'${outside}' is not allowed: this deployment permits no import origins for this plugin`
                            : `'${outside}' is not among the origins this deployment allows (${allowedOrigins.join(', ')})`,
                    };
                }
            }
            return { ok: true, value: out };
        }

        default:
            // Unreachable via a validated schema; reached only if SETTING_TYPES
            // gains a name before this switch does.
            return { ok: false, message: `unsupported setting type '${field.type}'` };
    }
}

/**
 * The flat default map for a schema.
 *
 * @param {object|undefined} settings manifest.settings
 * @returns {object} dotted key → default value
 */
export function settingsDefaults(settings) {
    if (!settings) return {};
    return Object.fromEntries(
        Object.entries(settings.fields).map(([key, field]) => [key, structuredClone(field.default)])
    );
}

/**
 * Effective settings: defaults overlaid with whatever the tenant has stored.
 *
 * A stored key the schema no longer declares is DROPPED, and a stored value the
 * schema now rejects falls back to the default rather than propagating. Both
 * cases are what a plugin upgrade looks like from the database's point of view,
 * and neither should hand a plugin a value it cannot understand.
 *
 * @param {object|undefined} settings manifest.settings
 * @param {object|string|null} stored the tenant's row (object or JSON text)
 * @returns {object} flat dotted-key map, complete for every declared field
 */
export function readSettings(settings, stored) {
    const out = settingsDefaults(settings);
    if (!settings) return out;
    let parsed = stored;
    if (typeof stored === 'string') {
        try { parsed = JSON.parse(stored); } catch { return out; }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
    Object.entries(parsed).forEach(([key, value]) => {
        const field = settings.fields[key];
        if (!field) return;
        const checked = coerceSettingValue(field, value);
        if (checked.ok) out[key] = checked.value;
    });
    return out;
}

/**
 * Apply a key-presence merge of `patch` onto `stored`, validating every key the
 * caller actually sent. Absent keys are left alone — this is a merge, never the
 * full replace that `PUT /addons/oyon/settings` is (and that any partial UI on
 * it has to compensate for by GET-spreading first).
 *
 * @param {object|undefined} settings  manifest.settings
 * @param {object}           stored    the tenant's current flat map
 * @param {object}           patch     the request body
 * @param {object}       [constraints] dotted key → host bounds for that field
 *                                     (`{ ceiling }` / `{ allowedOrigins }`)
 * @returns {{ok: true, value: object}|{ok: false, field: string, message: string}}
 */
export function mergeSettings(settings, stored, patch, constraints = {}) {
    if (!settings) return { ok: false, field: '', message: 'this plugin declares no settings' };
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return { ok: false, field: '', message: 'body must be an object of setting keys' };
    }
    const merged = { ...readSettings(settings, stored) };
    for (const [key, value] of Object.entries(patch)) {
        const field = settings.fields[key];
        // An unknown key is refused rather than ignored. Silently dropping it
        // is how an operator saves a typo'd field, sees a 200, and believes a
        // limit is in force that nothing ever read.
        if (!field) {
            return { ok: false, field: key, message: 'is not a setting this plugin declares' };
        }
        const checked = coerceSettingValue(field, value, constraints[key] ?? {});
        if (!checked.ok) {
            return { ok: false, field: key, message: checked.message };
        }
        merged[key] = checked.value;
    }
    return { ok: true, value: merged };
}

/**
 * The nested view, for a plugin that would rather read `settings.imports.enabled`
 * than `settings['imports.enabled']`. Storage stays flat; this is a projection.
 *
 * @param {object} flat dotted-key map
 * @returns {object} nested object
 */
export function nestSettings(flat) {
    const out = {};
    Object.entries(flat || {}).forEach(([key, value]) => {
        const [group, name] = key.split('.');
        if (!name) return;
        (out[group] ??= {})[name] = value;
    });
    return out;
}

/**
 * The fields a role may see. Defaults to admin, deliberately: a settings field
 * with no stated audience is a deployment-wide knob, and the safe reading of an
 * omission is the strictest one.
 *
 * @param {object|undefined} settings manifest.settings
 * @param {string}           role
 * @param {function}         roleAllows  from pluginRegistry.js
 * @returns {string[]} visible dotted keys
 */
export function visibleSettingKeys(settings, role, roleAllows) {
    if (!settings) return [];
    return Object.entries(settings.fields)
        .filter(([, field]) => roleAllows(role, field.minRole ?? 'admin'))
        .map(([key]) => key);
}
