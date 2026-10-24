// What a user may tell the LLM proxy, and how far the server trusts it.
//
// Security audit 2026-10-24 (findings LLM-2/3/4): `llm_settings` on a session
// and `default_llm_settings` on a user's preferences were stored verbatim and
// honoured by POST /proxy/llm, so any signed-in account could (a) point the
// server at an arbitrary URL and receive the hidden persona prompt, (b) pick
// any model name / token count / temperature, and (c) send the OpenAI path an
// unvalidated `messages` array. These helpers are the single place where those
// values are checked — at write time (sessions-routes, users-routes) and again
// at use time (proxy-routes), so a row written before the fix is caught too.
//
// Pure functions, no I/O: tests/server/llm-guards.test.js exercises them
// directly.

import { validateOutboundUrl } from './outboundUrl.js';
import { ROLE_RANKS, getRoleRank } from '../middleware/auth.js';
import { isKnownModel } from '../shared/llmCatalogue.js';

/** Settings keys that re-route the request; only educator+ may write them. */
export const LLM_ROUTING_KEYS = Object.freeze(['baseUrl', 'apiKey', 'provider']);

/** Client conversation caps (POST /proxy/llm `messages`). */
export const MAX_CHAT_MESSAGES = 200;
export const MAX_CHAT_CHARS = 200_000;

/** Output-token cap when the platform has not configured `llm_max_output_tokens`. */
export const DEFAULT_MAX_OUTPUT_TOKENS_CAP = 4096;

/** Temperature range accepted from a session/user setting. */
export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 2;

const CHAT_ROLES = new Set(['user', 'assistant']);

/** Educator and above may route a session to a custom endpoint. */
export function mayRouteCustomEndpoint(user) {
    return getRoleRank(user) >= ROLE_RANKS.educator;
}

/**
 * Check `llm_settings` a user wrote (POST /sessions body, or the
 * `default_llm_settings` preference) before it is stored.
 *
 * - below educator: baseUrl / apiKey / provider are removed (reported in
 *   `dropped`), the rest (model, maxOutputTokens, temperature) is kept and
 *   bounded at use time;
 * - educator and above: a non-empty baseUrl must pass validateOutboundUrl and
 *   is stored normalised.
 *
 * `null`, `undefined`, `''` and `false` pass through unchanged (they mean
 * "no settings"); any other non-object is refused.
 *
 * @returns {{ ok: true, settings: any, dropped: string[] } | { ok: false, error: string }}
 */
export function sanitizeUserLlmSettings(settings, user) {
    if (settings == null || settings === '' || settings === false) {
        return { ok: true, settings, dropped: [] };
    }
    if (typeof settings !== 'object' || Array.isArray(settings)) {
        return { ok: false, error: 'llm_settings must be an object' };
    }
    const out = { ...settings };
    if (!mayRouteCustomEndpoint(user)) {
        const dropped = LLM_ROUTING_KEYS.filter((key) => out[key] !== undefined);
        dropped.forEach((key) => { delete out[key]; });
        return { ok: true, settings: out, dropped };
    }
    if (out.baseUrl != null && out.baseUrl !== '') {
        if (typeof out.baseUrl !== 'string') {
            return { ok: false, error: 'baseUrl must be a string' };
        }
        const checked = validateOutboundUrl(out.baseUrl);
        if (!checked.ok) return { ok: false, error: `baseUrl: ${checked.reason}` };
        out.baseUrl = checked.url;
    }
    return { ok: true, settings: out, dropped: [] };
}

/**
 * Which model a session setting may select.
 *
 * A model name from a session is honoured only when the request is going to
 * the educator's own validated endpoint (`customEndpoint`), when it is the
 * platform model, or when the catalogue lists it for the resolved provider.
 * Anything else falls back to the platform model.
 *
 * @returns {{ model: string, honoured: boolean }}
 */
export function resolveSessionModel({ requested, provider, platformModel, customEndpoint = false }) {
    const wanted = typeof requested === 'string' ? requested.trim() : '';
    if (!wanted) return { model: platformModel, honoured: false };
    if (customEndpoint || wanted === platformModel || isKnownModel(provider, wanted)) {
        return { model: wanted, honoured: true };
    }
    return { model: platformModel, honoured: false };
}

/**
 * Bound a session-supplied max-output-tokens value by the platform's
 * configured cap (or DEFAULT_MAX_OUTPUT_TOKENS_CAP when none is set).
 *
 * @returns {{ value: number|null, clamped: boolean }}
 */
export function clampOutputTokens(value, { platformMax } = {}) {
    const requested = Number.parseInt(value, 10);
    if (!Number.isFinite(requested) || requested < 1) return { value: null, clamped: false };
    const platformCap = Number.parseInt(platformMax, 10);
    const cap = Number.isFinite(platformCap) && platformCap > 0 ? platformCap : DEFAULT_MAX_OUTPUT_TOKENS_CAP;
    return requested > cap ? { value: cap, clamped: true } : { value: requested, clamped: false };
}

/**
 * Bound a session-supplied temperature to [TEMPERATURE_MIN, TEMPERATURE_MAX].
 *
 * @returns {{ value: number|null, clamped: boolean }}
 */
export function clampTemperature(value) {
    const requested = Number.parseFloat(value);
    if (!Number.isFinite(requested)) return { value: null, clamped: false };
    if (requested < TEMPERATURE_MIN) return { value: TEMPERATURE_MIN, clamped: true };
    if (requested > TEMPERATURE_MAX) return { value: TEMPERATURE_MAX, clamped: true };
    return { value: requested, clamped: false };
}

/**
 * Validate the client's conversation for POST /proxy/llm.
 *
 * Every message must be `{ role: 'user' | 'assistant', content: string }`.
 * The server builds the only system message, so a client `system` role is
 * refused, as is array (multimodal) content. At most MAX_CHAT_MESSAGES
 * messages and MAX_CHAT_CHARS characters of content in all.
 *
 * @returns {{ ok: true, messages: Array<{role: string, content: string}> } | { ok: false, error: string }}
 */
export function validateChatMessages(messages) {
    if (messages == null) return { ok: true, messages: [] };
    if (!Array.isArray(messages)) return { ok: false, error: 'messages must be an array' };
    if (messages.length > MAX_CHAT_MESSAGES) {
        return { ok: false, error: `messages: at most ${MAX_CHAT_MESSAGES} messages per request` };
    }
    const cleaned = [];
    let totalChars = 0;
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (!m || typeof m !== 'object' || Array.isArray(m)) {
            return { ok: false, error: `messages[${i}] must be an object` };
        }
        if (!CHAT_ROLES.has(m.role)) {
            return { ok: false, error: `messages[${i}].role must be "user" or "assistant"` };
        }
        if (typeof m.content !== 'string') {
            return { ok: false, error: `messages[${i}].content must be a string` };
        }
        totalChars += m.content.length;
        if (totalChars > MAX_CHAT_CHARS) {
            return { ok: false, error: `messages: at most ${MAX_CHAT_CHARS} characters of content per request` };
        }
        cleaned.push({ role: m.role, content: m.content });
    }
    return { ok: true, messages: cleaned };
}
