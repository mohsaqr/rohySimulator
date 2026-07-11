// Turn a raw LLM connection error into a plain-language, actionable message.
//
// The test/proxy routes bubble the upstream failure up verbatim — e.g.
//   `LLM API returned 400: { "error": { "message": "Multiple models are
//    loaded. Please specify a model by providing a 'model' field.", ... } }`
// which is accurate but reads like a stack trace in a toast. This maps the
// handful of failures admins actually hit to a friendly sentence that says what
// to do next, and falls back to the cleaned-up upstream message otherwise (we
// never fully swallow the detail — an unrecognised error still shows its text).
//
// Pure + `t`-injected so it unit-tests without i18n wiring.

// Pull the human sentence out of an upstream error body. Providers wrap it as
// `{"error":{"message":"…"}}`; some return `{"message":"…"}` or bare text. We
// try JSON first (after any `returned <status>:` prefix), then a message regex.
export function extractUpstreamDetail(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const jsonStart = raw.indexOf('{');
    if (jsonStart !== -1) {
        try {
            const parsed = JSON.parse(raw.slice(jsonStart));
            const msg = parsed?.error?.message || parsed?.message || parsed?.error;
            if (typeof msg === 'string' && msg.trim()) return msg.trim();
        } catch {
            const m = raw.match(/"message"\s*:\s*"([^"]+)"/);
            if (m) return m[1].trim();
        }
    }
    return raw.trim();
}

/**
 * @param {string} raw   the raw error string (from data.error or err.message)
 * @param {Function} t   i18n translator bound to the 'authoring_config' namespace
 * @returns {string} a friendly, actionable message
 */
export function friendlyLlmError(raw, t) {
    const detail = extractUpstreamDetail(raw);
    const hay = `${raw || ''} ${detail}`.toLowerCase();

    if (/multiple models are loaded|specify a model|provide a 'model'|provide a "model"/.test(hay)) {
        return t('err_llm_multiple_models');
    }
    if (/model.*(not found|does not exist|unknown|not loaded)|model_not_found|no such model|invalid model/.test(hay)) {
        return t('err_llm_model_not_found');
    }
    if (/insufficient_quota|exceeded your current quota|out of credits?|billing|payment required|402/.test(hay)) {
        return t('err_llm_quota');
    }
    if (/invalid.*api.*key|incorrect api key|invalid_api_key|unauthorized|authentication|401|403|permission/.test(hay)) {
        return t('err_llm_bad_key');
    }
    if (/econnrefused|enotfound|failed to fetch|fetch failed|network ?error|timed? ?out|timeout|refused|unreachable|socket hang up/.test(hay)) {
        return t('err_llm_unreachable');
    }
    // Unknown failure: keep the upstream detail so nothing is hidden, but wrap
    // it in a sentence instead of dumping raw JSON.
    return t('err_llm_generic', { detail });
}
