export const REDACTED = '[redacted]';

const SECRET_KEY_PATTERN = /(^|[_-])(api[_-]?key|key|secret|token)$|password/i;
const PII_COLUMNS = new Set([
    'email',
    'user_email',
    'alternative_email',
    'phone',
    'address',
    'name',
    'student_name',
    'education',
    'grade'
]);

const SECRET_SETTING_KEY_PATTERN = /(^|[_-])(api[_-]?key|key|secret|token)$/i;

export const RESPONSE_REDACTION_POLICY = {
    apiKey: { class: 'secret', action: 'redact' },
    api_key: { class: 'secret', action: 'redact' },
    llm_api_key: { class: 'secret', action: 'redact' },
    password_hash: { class: 'secret', action: 'hide' },
    refresh_token: { class: 'secret', action: 'hide' },
    token_hash: { class: 'secret', action: 'hide' },
    token: { class: 'secret', action: 'hide' },

    llm_settings: { class: 'json', action: 'redact-json' },
    default_llm_settings: { class: 'json', action: 'redact-json' },
    notification_settings: { class: 'json', action: 'redact-json' },
    default_monitor_settings: { class: 'json', action: 'redact-json' },
    monitor_settings: { class: 'json', action: 'redact-json' },
    settings_snapshot: { class: 'json', action: 'redact-json' },
    settings_json: { class: 'json', action: 'redact-json' },
    old_value: { class: 'json', action: 'redact-json' },
    new_value: { class: 'json', action: 'redact-json' },
    metadata: { class: 'json', action: 'redact-json' },

    email: { class: 'pii', action: 'mask-email-domain' },
    user_email: { class: 'pii', action: 'mask-email-domain' },
    alternative_email: { class: 'pii', action: 'mask-email-domain' },
    phone: { class: 'pii', action: 'redact' },
    address: { class: 'pii', action: 'redact' },
    name: { class: 'pii', action: 'redact' },
    student_name: { class: 'pii', action: 'redact' },
    education: { class: 'pii', action: 'redact' },
    grade: { class: 'pii', action: 'redact' },

    updated_by: { class: 'internal', action: 'redact' },
    created_by: { class: 'internal', action: 'redact' },
    role_rank: { class: 'internal', action: 'hide' }
};

function shouldRedactKey(key) {
    if (key === 'setting_key') return false;
    return SECRET_KEY_PATTERN.test(key);
}

function cloneJson(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed || !/^[[{]/.test(trimmed)) return value;
    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}

function parseJsonValue(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function formatJsonLike(original, redacted) {
    return typeof original === 'string' && redacted && typeof redacted === 'object'
        ? JSON.stringify(redacted)
        : redacted;
}

export function redactJsonColumn(value, columnPolicy = {}) {
    if (value == null) return value;
    const parsed = cloneJson(value);
    if (Array.isArray(parsed)) {
        return formatJsonLike(value, parsed.map(item => redactJsonColumn(item, columnPolicy)));
    }
    if (parsed && typeof parsed === 'object') {
        const out = {};
        for (const [key, child] of Object.entries(parsed)) {
            out[key] = shouldRedactKey(key)
                ? (child ? REDACTED : child)
                : redactJsonColumn(child, columnPolicy);
        }
        return formatJsonLike(value, out);
    }
    return value;
}

function redactValue(key, value, policy, classification) {
    if (!policy && shouldRedactKey(key)) {
        return value ? REDACTED : value;
    }
    if (!policy) return value;

    if (policy.class === 'secret') {
        if (policy.action === 'hide') return undefined;
        return value ? REDACTED : value;
    }
    if (policy.class === 'json') {
        return redactJsonColumn(value, policy);
    }
    if (policy.class === 'pii') {
        if (classification.pii === 'allow') return value;
        if (policy.action === 'mask-email-domain' && typeof value === 'string' && value.includes('@')) {
            return `${value.split('@')[0]}@${REDACTED}`;
        }
        return value ? REDACTED : value;
    }
    if (policy.class === 'internal') {
        if (classification.internal === 'allow') return value;
        if (policy.action === 'hide') return undefined;
        return value ? REDACTED : value;
    }
    return value;
}

export function redactRow(row, classification = {}) {
    if (!row || typeof row !== 'object') return row;
    const effective = {
        pii: 'allow',
        internal: 'allow',
        ...classification
    };
    const out = Array.isArray(row) ? [] : {};
    for (const [key, value] of Object.entries(row)) {
        const policy = RESPONSE_REDACTION_POLICY[key]
            || (PII_COLUMNS.has(key) ? { class: 'pii', action: 'redact' } : null);
        const redacted = redactValue(key, value, policy, effective);
        if (redacted !== undefined) {
            out[key] = redacted;
        }
    }
    return out;
}

export function redactRows(rows, classification = {}) {
    return (rows || []).map(row => redactRow(row, classification));
}

export function redactPlatformSettingRow(row) {
    if (!row || typeof row !== 'object') return row;
    const out = redactRow(row, { internal: 'allow' });
    if (!Object.prototype.hasOwnProperty.call(row, 'setting_value')) return out;

    if (SECRET_SETTING_KEY_PATTERN.test(String(row.setting_key || ''))) {
        out.setting_value = row.setting_value ? REDACTED : row.setting_value;
    } else {
        out.setting_value = redactJsonColumn(parseJsonValue(row.setting_value));
    }
    return out;
}

export function redactPlatformSettingRows(rows) {
    return (rows || []).map(row => redactPlatformSettingRow(row));
}

export function redactAuditPayload(value) {
    return redactJsonColumn(value);
}
