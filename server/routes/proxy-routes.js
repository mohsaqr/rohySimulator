import express from 'express';
import dbAdapter from '../dbAdapter.js';
import path from 'path';
import fs from 'fs';
import os from 'node:os';
import { fileURLToPath } from 'url';
import {
    authenticateToken,
    requireAdmin,
    ROLE_RANKS,
    hasRoleAtLeast,
} from '../middleware/auth.js';


import { spawn } from 'node:child_process';
import { buildWavHeader } from '../services/wav.js';
import { EvenByteAligner } from '../lib/pcmAlign.js';
import { assembleSystemPrompt } from '../services/systemPromptAssembly.js';
import { resolveAffectNote } from '../shared/affectNote.js';
import {
    TTS_PROVIDERS,
    guessVoiceProvider,
} from '../shared/voiceIdentity.js';
import {
    PIPER_DIR,
    PIPER_BIN,
    deriveVoiceProvider,
    providerHasVoice,
    getProviderStatus,
    getAllProviderStatus,
    listVoicesForProvider,
    readVoiceSidecar,
} from '../services/ttsProviders.js';


import { logger } from '../logger.js';
import {
    auditSuccess,
    tenantId,
    verifySessionOwnership
} from './_helpers.js';
import {
    BudgetExceededError,
    budgetExceededResponse,
    enforceBudget,
    recordUsage
} from '../usage-budget.js';
import { LLM_MODEL_REGISTRY, LLM_PROVIDERS, defaultModelFor } from '../shared/llmCatalogue.js';

const radiologyLog = logger('radiology');
const routesLlmLog = logger('routes-llm-tts');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let radiologyDatabase = [];
try {
    const radiologyPath = path.join(__dirname, '../data/radiology_database.json');
    if (fs.existsSync(radiologyPath)) {
        const data = JSON.parse(fs.readFileSync(radiologyPath, 'utf8'));
        radiologyDatabase = data.studies || [];
        radiologyLog.info('radiology database loaded', { count: radiologyDatabase.length });
    }
} catch (err) {
    radiologyLog.error('radiology database load failed', { error: err.message });
}

const router = express.Router();

const getPlatformSetting = async (key) => {
    const row = await dbAdapter.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key]);
    return row?.setting_value ?? null;
};

const DEFAULT_RATE_LIMITS = {
    tokensPerUserDaily: 100000,
    costPerUserDaily: 10,
    tokensPlatformDaily: 1000000,
    costPlatformDaily: 100,
    requestsPerUserHourly: 100
};


// F-005: upstream LLM fetches were unbounded. /proxy/llm is intentionally
// excluded from the global routeTimeout middleware (streaming responses can
// legitimately run long), but the upstream call itself needs its own cap or
// a slow/malicious endpoint can pin a server connection forever. Connect /
// non-stream cap is 60s; the stream branch additionally enforces a 5-minute
// total upper bound and aborts the upstream when the client disconnects.
const LLM_UPSTREAM_CONNECT_MS = 60_000;
const LLM_STREAM_MAX_MS = 5 * 60_000;

const extractUpstreamError = (errText) => {
    try {
        const parsed = JSON.parse(errText);
        const msg = parsed?.error?.message ?? parsed?.error ?? parsed?.message;
        if (typeof msg === 'string' && msg.length > 0 && msg.length <= 500) return msg;
    } catch { /* not json */ }
    return 'Upstream LLM error';
};

router.post('/proxy/llm', authenticateToken, async (req, res) => {
    const { messages, system_prompt, session_id, agent_llm_config, session_mode, case_language, student_affect } = req.body;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    const startTime = Date.now();

    try {
        // 1. Check if LLM is enabled
        const llmEnabled = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', ['llm_enabled'], (err, row) => {
                if (err) reject(err);
                else resolve(row?.setting_value !== 'false');
            });
        });

        if (!llmEnabled) {
            return res.status(503).json({ error: 'LLM service is currently disabled by administrator' });
        }

        // 2. Get user's current usage
        const userUsage = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT * FROM llm_usage WHERE user_id = ? AND date = ?', [userId, today], (err, row) => {
                if (err) reject(err);
                else resolve(row || { total_tokens: 0, estimated_cost: 0, request_count: 0 });
            });
        });

        // 3. Get platform usage
        const platformUsage = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT SUM(total_tokens) as total_tokens, SUM(estimated_cost) as total_cost FROM llm_usage WHERE date = ?', [today], (err, row) => {
                if (err) reject(err);
                else resolve(row || { total_tokens: 0, total_cost: 0 });
            });
        });

        // 4. Get rate limits
        const getLimitSetting = (key, defaultVal) => new Promise((resolve, reject) => {
            dbAdapter.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key], (err, row) => {
                if (err) reject(err);
                else resolve(row?.setting_value ? parseFloat(row.setting_value) : defaultVal);
            });
        });

        const tokensPerUserDaily = await getLimitSetting('rate_limit_tokens_per_user_daily', 0);
        const costPerUserDaily = await getLimitSetting('rate_limit_cost_per_user_daily', 0);
        const tokensPlatformDaily = await getLimitSetting('rate_limit_tokens_platform_daily', 0);
        const costPlatformDaily = await getLimitSetting('rate_limit_cost_platform_daily', 0);

        // Helper to log rate limit events (fire and forget with error handling)
        const logRateLimit = (msg) => {
            dbAdapter.run('INSERT INTO llm_request_log (user_id, session_id, status, error_message) VALUES (?, ?, ?, ?)',
                [userId, session_id, 'rate_limited', msg],
                (err) => { if (err) routesLlmLog.warn('llm rate-limit log failed', { error: err.message }); }
            );
        };

        // 5. Check user rate limits (0 = unlimited/disabled)
        if (tokensPerUserDaily > 0 && userUsage.total_tokens >= tokensPerUserDaily) {
            logRateLimit('User daily token limit exceeded');
            return res.status(429).json({
                error: 'Daily token limit exceeded',
                tokensUsed: userUsage.total_tokens,
                tokensLimit: tokensPerUserDaily,
                resetsAt: 'midnight UTC'
            });
        }

        if (costPerUserDaily > 0 && userUsage.estimated_cost >= costPerUserDaily) {
            logRateLimit('User daily cost limit exceeded');
            return res.status(429).json({
                error: 'Daily cost limit exceeded',
                costUsed: userUsage.estimated_cost,
                costLimit: costPerUserDaily,
                resetsAt: 'midnight UTC'
            });
        }

        // 6. Check platform rate limits (0 = unlimited/disabled)
        if (tokensPlatformDaily > 0 && (platformUsage.total_tokens || 0) >= tokensPlatformDaily) {
            logRateLimit('Platform daily token limit exceeded');
            return res.status(429).json({
                error: 'Platform daily token limit exceeded. Please try again tomorrow.',
                resetsAt: 'midnight UTC'
            });
        }

        if (costPlatformDaily > 0 && (platformUsage.total_cost || 0) >= costPlatformDaily) {
            logRateLimit('Platform daily cost limit exceeded');
            return res.status(429).json({
                error: 'Platform daily cost limit exceeded. Please try again tomorrow.',
                resetsAt: 'midnight UTC'
            });
        }

        // 7. Get LLM settings from platform settings (these are the defaults)
        const getPlatformLLMSetting = (key, defaultVal) => new Promise((resolve, reject) => {
            dbAdapter.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key], (err, row) => {
                if (err) reject(err);
                else resolve(row?.setting_value || defaultVal);
            });
        });

        // Get all platform settings first (these are always the base)
        const platformProvider = await getPlatformLLMSetting('llm_provider', 'lmstudio');
        const platformModel = await getPlatformLLMSetting('llm_model', '');
        const platformBaseUrl = await getPlatformLLMSetting('llm_base_url', 'http://localhost:1234/v1');
        const platformApiKey = await getPlatformLLMSetting('llm_api_key', '');
        const platformMaxTokens = await getPlatformLLMSetting('llm_max_output_tokens', '');
        const platformTemperature = await getPlatformLLMSetting('llm_temperature', '');
        const systemPromptTemplate = await getPlatformLLMSetting('llm_system_prompt_template', '');

        // Check if session has user-specific LLM settings (optional overrides).
        // The session-scoped lookup leaks settings across users if we don't
        // first verify the caller owns the session — even though billing is
        // per-user, the per-session llm_settings (custom base URL, model,
        // overrides) would otherwise be readable by anyone who guesses an id.
        // verifySessionOwnership writes the 403/404 itself; admins bypass.
        let sessionLlmSettings = null;
        if (session_id) {
            if (!await verifySessionOwnership(session_id, req.user, res)) return;
            sessionLlmSettings = await new Promise((resolve, reject) => {
                dbAdapter.get('SELECT llm_settings FROM sessions WHERE id = ?', [session_id], (err, row) => {
                    if (err) reject(err);
                    else {
                        try {
                            const parsed = row?.llm_settings ? JSON.parse(row.llm_settings) : null;
                            // Only use if it has actual settings (not empty object)
                            if (parsed && Object.keys(parsed).length > 0) {
                                resolve(parsed);
                            } else {
                                resolve(null);
                            }
                        } catch {
                            resolve(null);
                        }
                    }
                });
            });
        }

        // Merge: agent_llm_config > session settings > platform settings
        // Agent-specific LLM config has highest priority
        let agentProvider = null;
        let agentModel = null;
        let agentApiKey = null;
        let agentEndpoint = null;

        // Stage-4 audit: agent layer now contributes temperature and
        // max_tokens too. Pre-fix these were never read from the agent
        // template, so admin tuning per-agent had zero effect — every chat
        // used session/platform values regardless of the editor's settings.
        let agentTemperature = null;
        let agentMaxTokens = null;
        // F-001: previously this route trusted client-supplied
        // `agent_llm_config.{provider,endpoint,api_key}` outright, which let
        // any authenticated user point the server at a custom endpoint AND
        // fall back to the platform API key (SSRF + key exfiltration). The
        // current React client only ever sends `{ agent_template_id }`
        // (see src/services/AgentService.js & llmService.js), so we now
        // ignore inline raw routing fields and require the
        // `agent_template_id` indirection. Admins still configure agent
        // routing via the agent_templates table, which is server-trusted.
        if (agent_llm_config && (agent_llm_config.provider || agent_llm_config.endpoint || agent_llm_config.api_key)) {
            (req.log || routesLlmLog).warn('ignored client-supplied agent llm routing fields', {
                user_id: userId,
                had_provider: !!agent_llm_config.provider,
                had_endpoint: !!agent_llm_config.endpoint,
                had_api_key: !!agent_llm_config.api_key
            });
        }
        if (agent_llm_config?.agent_template_id) {
            // Try to fetch agent template LLM config from DB
            const agentTemplate = await new Promise((resolve, reject) => {
                dbAdapter.get('SELECT llm_provider, llm_model, llm_api_key, llm_endpoint, llm_temperature, llm_max_tokens FROM agent_templates WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
                    [agent_llm_config.agent_template_id, tenantId(req)], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            if (agentTemplate && agentTemplate.llm_provider) {
                agentProvider = agentTemplate.llm_provider;
                agentModel = agentTemplate.llm_model;
                agentApiKey = agentTemplate.llm_api_key;
                agentEndpoint = agentTemplate.llm_endpoint;
                if (agentTemplate.llm_temperature !== null && Number.isFinite(agentTemplate.llm_temperature)) {
                    agentTemperature = agentTemplate.llm_temperature;
                }
                if (agentTemplate.llm_max_tokens !== null && Number.isFinite(agentTemplate.llm_max_tokens)) {
                    agentMaxTokens = agentTemplate.llm_max_tokens;
                }
                (req.log || routesLlmLog).info('using agent-template llm config', { agent_template_id: agent_llm_config.agent_template_id, provider: agentProvider, temperature: agentTemperature ?? null, max_tokens: agentMaxTokens ?? null });
            }
        }

        // Priority: agent > session > platform
        let provider = agentProvider || (sessionLlmSettings?.provider && sessionLlmSettings.provider.trim()) || platformProvider;
        const baseModel = agentModel || (sessionLlmSettings?.model && sessionLlmSettings.model.trim()) || platformModel;

        // Voice-mode model override: when client sends session_mode='voice' AND admin has set
        // llm_model_voice in platform settings, swap to that model for this call only.
        // Voice mode often needs a smaller/faster model to keep round-trip latency under 2s.
        let voiceModelOverride = null;
        if (session_mode === 'voice') {
            const stored = await getPlatformSetting('llm_model_voice');
            if (stored && typeof stored === 'string' && stored.trim()) {
                voiceModelOverride = stored.trim();
            }
        }
        const model = voiceModelOverride || baseModel;
        if (voiceModelOverride) {
            (req.log || routesLlmLog).info('voice-mode llm override active', { model: voiceModelOverride });
        }

        // For API key and base URL, also consider agent settings
        let baseUrl = platformBaseUrl;
        let apiKey = platformApiKey;

        // Handle provider-specific defaults for base URL
        if (agentProvider) {
            // Agent provider override
            if (agentProvider === 'openai') {
                baseUrl = 'https://api.openai.com/v1';
            } else if (agentProvider === 'anthropic') {
                baseUrl = 'https://api.anthropic.com/v1';
            } else if (agentProvider === 'openrouter') {
                baseUrl = 'https://openrouter.ai/api/v1';
            } else if (agentProvider === 'custom' && agentEndpoint) {
                baseUrl = agentEndpoint;
            }
            apiKey = agentApiKey || platformApiKey;
        } else if (sessionLlmSettings?.baseUrl && sessionLlmSettings.baseUrl.trim()) {
            // F-002: session-level baseUrl is reachable from
            // /users/preferences (any authenticated user can set it).
            // Pre-fix we paired the user-supplied URL with the platform
            // API key, which let any account exfiltrate the platform key
            // by pointing baseUrl at an attacker-controlled host. Now:
            // a custom session baseUrl is only honored when it ships with
            // its own apiKey. Otherwise we fall through to the platform
            // baseUrl + platform key (still server-trusted).
            const sessionBase = sessionLlmSettings.baseUrl.trim();
            const sessionKey = (sessionLlmSettings?.apiKey && sessionLlmSettings.apiKey.trim()) || null;
            // Normalize trailing slashes so an operator setting the same
            // URL with/without a trailing `/` doesn't silently fall into
            // the "custom URL → drop platform key" branch.
            const stripSlash = (u) => (u || '').replace(/\/+$/, '');
            if (stripSlash(sessionBase) === stripSlash(platformBaseUrl)) {
                // Same endpoint as platform — safe to reuse platform key.
                apiKey = sessionKey || platformApiKey;
            } else if (sessionKey) {
                baseUrl = sessionBase;
                apiKey = sessionKey;
            } else {
                (req.log || routesLlmLog).warn('refusing custom session baseUrl without session-supplied apiKey', {
                    user_id: userId,
                    session_id: session_id ?? null
                });
                // Drop the custom baseUrl; keep the rest of the request
                // flowing on the platform endpoint+key.
                apiKey = platformApiKey;
            }
        } else {
            apiKey = (sessionLlmSettings?.apiKey && sessionLlmSettings.apiKey.trim()) || platformApiKey;
        }

        // Voice override may pick a model from a different vendor than the
        // platform default (e.g. user picked "Claude Haiku" while platform is
        // OpenAI). The model name alone isn't enough — we have to swap the
        // provider+endpoint+key too, otherwise the Claude model id gets sent
        // to OpenAI's endpoint and 500s. Crucially: do NOT fall back to the
        // platform key when its vendor doesn't match the new provider, or we
        // end up sending an OpenAI sk-proj-* to Anthropic and get a confusing
        // 401 invalid-x-api-key.
        if (voiceModelOverride) {
            const m = voiceModelOverride.toLowerCase();
            const platformVendor = (agentProvider || platformProvider || '').toLowerCase();
            if (m.startsWith('claude-')) {
                provider = 'anthropic';
                baseUrl = 'https://api.anthropic.com/v1';
                apiKey = process.env.ANTHROPIC_API_KEY
                    || (platformVendor === 'anthropic' ? apiKey : '');
                (req.log || routesLlmLog).info('voice override routed to anthropic');
            } else if (m.startsWith('gpt-') || m.startsWith('o1-') || m.startsWith('o3-')) {
                provider = 'openai';
                baseUrl = 'https://api.openai.com/v1';
                apiKey = process.env.OPENAI_API_KEY
                    || (platformVendor === 'openai' ? apiKey : '');
                (req.log || routesLlmLog).info('voice override routed to openai');
            }
            if (!apiKey) {
                const envName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY'
                    : provider === 'openai' ? 'OPENAI_API_KEY'
                    : `${provider.toUpperCase()}_API_KEY`;
                return res.status(503).json({
                    error: `Voice mode wants to use "${voiceModelOverride}" via ${provider}, but no matching API key is configured. Either (a) set ${envName} in server/.env and restart the server, or (b) change the voice-mode model in Settings → Voice & Avatar to "inherit platform" so it uses your existing platform LLM (${platformVendor || 'unset'}).`
                });
            }
            // Catch the cross-vendor mistake (e.g. an OpenAI sk-proj-* key in
            // the Anthropic field) before Anthropic returns a confusing 401.
            if (provider === 'anthropic' && !apiKey.startsWith('sk-ant-')) {
                return res.status(503).json({
                    error: `The API key being used for Anthropic doesn't have the expected "sk-ant-" prefix. Get one at console.anthropic.com and set ANTHROPIC_API_KEY in server/.env.`
                });
            }
            if (provider === 'openai' && !apiKey.startsWith('sk-')) {
                return res.status(503).json({
                    error: `The API key being used for OpenAI doesn't have the expected "sk-" prefix. Set OPENAI_API_KEY in server/.env or fix the platform LLM API key field.`
                });
            }
        }

        // Precedence (matches provider/model): agent > session > platform.
        // `?? null` because `0` is a valid temperature; `||` would silently
        // skip it.
        const maxOutputTokensRaw = agentMaxTokens ?? (sessionLlmSettings?.maxOutputTokens || platformMaxTokens);
        const temperatureRaw = agentTemperature ?? (sessionLlmSettings?.temperature !== undefined && sessionLlmSettings?.temperature !== '' ? sessionLlmSettings.temperature : platformTemperature);
        let maxOutputTokens = maxOutputTokensRaw !== null && maxOutputTokensRaw !== undefined && maxOutputTokensRaw !== ''
            ? parseInt(maxOutputTokensRaw, 10)
            : null;
        if (!Number.isFinite(maxOutputTokens)) maxOutputTokens = null;
        // In voice mode every extra word adds synthesis time. Cap responses
        // hard so the patient stays terse and TTS turnaround stays under ~3s.
        if (session_mode === 'voice') {
            const cap = 180;
            maxOutputTokens = maxOutputTokens ? Math.min(maxOutputTokens, cap) : cap;
        }
        let temperature = temperatureRaw !== null && temperatureRaw !== undefined && temperatureRaw !== ''
            ? parseFloat(temperatureRaw)
            : null;
        if (!Number.isFinite(temperature)) temperature = null;

        // Debug logging
        (req.log || routesLlmLog).info('llm final settings resolved', { provider, model: model || null, base_url: baseUrl });
        if (sessionLlmSettings && Object.keys(sessionLlmSettings).length > 0) {
            (req.log || routesLlmLog).info('using session llm overrides', { session_id, override_keys: Object.keys(sessionLlmSettings).filter(k => sessionLlmSettings[k]) });
        }

        const budgetProvider = `llm-${provider || 'unknown'}`;
        const requestedTokens = maxOutputTokens || 4096;
        await enforceBudget({
            tenantId: tenantId(req),
            userId,
            provider: budgetProvider,
            metric: 'tokens',
            requested: requestedTokens
        });

        // 8. Build system prompt. See assembleSystemPrompt for the ordering
        // invariant — case content leads, platform template trails, and the
        // output-language directive (case_language, registry-validated)
        // trails everything so it stays dominant.
        //
        // Observed learner affect (Plan A): the client sends a structured
        // signal only; resolveAffectNote is the single authoritative gate
        // (feature enabled, provider policy local-vs-cloud on the RESOLVED
        // provider, signal validity/freshness/confidence) and composes the
        // note from enum-validated fields — client text never reaches the
        // prompt through this field. Invalid/stale/disallowed → ''.
        let studentAffectNote = '';
        if (student_affect) {
            const affectSettings = await getPlatformLLMSetting('affect_routing', '');
            studentAffectNote = resolveAffectNote(student_affect, {
                providerGroup: LLM_PROVIDERS[provider]?.group,
                settings: affectSettings
            });
            if (studentAffectNote) {
                (req.log || routesLlmLog).info('student affect routed', {
                    session_id, mode: student_affect?.mode, provider
                });
            }
        }
        let fullSystemPrompt = assembleSystemPrompt({ system_prompt, systemPromptTemplate, caseLanguage: case_language, studentAffectNote });

        // 9. Build request based on provider type
        let llmHeaders = { 'Content-Type': 'application/json' };
        let requestPayload = {};
        let endpoint = '';

        if (provider === 'anthropic') {
            // Anthropic Claude API format
            llmHeaders['x-api-key'] = apiKey;
            llmHeaders['anthropic-version'] = '2023-06-01';

            // Filter out system messages for Anthropic (uses separate system field)
            const anthropicMessages = (messages || []).filter(m => m.role !== 'system').map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content
            }));

            requestPayload = {
                model: model || defaultModelFor('anthropic'),
                max_tokens: maxOutputTokens || 1024,
                messages: anthropicMessages
            };
            if (fullSystemPrompt) {
                requestPayload.system = fullSystemPrompt;
            }
            if (temperature !== null) {
                requestPayload.temperature = temperature;
            }
            endpoint = `${baseUrl}/messages`;
        } else {
            // OpenAI-compatible API format (OpenAI, LM Studio, Ollama, OpenRouter, Groq, Together, etc.)
            if (apiKey) {
                llmHeaders['Authorization'] = `Bearer ${apiKey}`;
            }

            const conversation = [];
            if (fullSystemPrompt) {
                conversation.push({ role: 'system', content: fullSystemPrompt });
            }
            if (messages && Array.isArray(messages)) {
                conversation.push(...messages);
            }

            requestPayload = {
                messages: conversation,
                stream: false
            };
            if (temperature !== null) {
                requestPayload.temperature = temperature;
            }
            if (maxOutputTokens) {
                if (provider === 'openai') {
                    requestPayload.max_completion_tokens = maxOutputTokens;
                } else {
                    requestPayload.max_tokens = maxOutputTokens;
                }
            }
            if (model && model.trim() !== '') {
                requestPayload.model = model;
            }
            endpoint = `${baseUrl}/chat/completions`;
        }

        // 10. Make LLM request
        (req.log || routesLlmLog).info('llm upstream request sending', { user_id: userId, provider, model: model || null, endpoint });

        // Streaming branch — emit SSE deltas from the upstream provider.
        // Client requests it via Accept: text/event-stream OR ?stream=1.
        const wantStream = req.query.stream === '1'
            || req.body?.stream === true
            || (req.headers.accept || '').includes('text/event-stream');
        if (wantStream) {
            const streamPayload = { ...requestPayload, stream: true };
            // F-005: bound upstream. Connect timeout caps how long we'll
            // wait for the upstream's first response; the max-duration
            // timer caps a slow/never-ending stream; the req 'close'
            // handler aborts upstream the moment the client goes away.
            const streamController = new AbortController();
            const connectTimer = setTimeout(() => streamController.abort(new Error('upstream_connect_timeout')), LLM_UPSTREAM_CONNECT_MS);
            const overallTimer = setTimeout(() => streamController.abort(new Error('upstream_stream_max_duration')), LLM_STREAM_MAX_MS);
            // The accounting-flag siblings (streamInterrupted /
            // streamErrMessage) live further down, attached AFTER the
            // upstream connects — they only matter once we're committed
            // to sending SSE. This handler is the safety-critical half:
            // it has to fire even if the upstream never responds, so it
            // attaches now and dedupes on signal.aborted.
            req.on('close', () => {
                if (!streamController.signal.aborted) {
                    try { streamController.abort(new Error('client_disconnected')); } catch { /* noop */ }
                }
            });
            let upstream;
            try {
                upstream = await fetch(endpoint, {
                    method: 'POST',
                    headers: llmHeaders,
                    body: JSON.stringify(streamPayload),
                    signal: streamController.signal
                });
            } finally {
                clearTimeout(connectTimer);
            }
            if (!upstream.ok) {
                clearTimeout(overallTimer);
                const errText = await upstream.text();
                (req.log || routesLlmLog).error('llm stream upstream error', { status: upstream.status, error: errText.slice(0, 200) });
                dbAdapter.run('INSERT INTO llm_request_log (user_id, session_id, model, status, error_message, response_time_ms) VALUES (?, ?, ?, ?, ?, ?)',
                    [userId, session_id, model, 'error', errText.substring(0, 500), Date.now() - startTime]);
                return res.status(upstream.status).json({ error: extractUpstreamError(errText) });
            }

            res.set('Content-Type', 'text/event-stream');
            res.set('Cache-Control', 'no-store');
            res.set('X-Accel-Buffering', 'no');
            res.flushHeaders?.();
            if (res.socket) res.socket.setNoDelay(true);

            const sse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

            let promptTokens = 0;
            let completionTokens = 0;
            let streamInterrupted = false;
            let streamErrMessage = null;
            const decoder = new TextDecoder();
            let buffered = '';

            // Accounting-flag sibling to the abort handler above. Express's
            // `req` emits 'close' for both clean ends and disconnects, so
            // we gate on `!res.writableEnded` to distinguish. Two separate
            // handlers (rather than one combined) because the abort half
            // must fire even before the stream is committed to writing
            // SSE, while these flags only matter once we're already
            // streaming. Both run on every 'close', the gates dedupe.
            req.on('close', () => {
                if (!res.writableEnded) {
                    streamInterrupted = true;
                    streamErrMessage = 'client_disconnected';
                }
            });

            try {
                for await (const chunk of upstream.body) {
                    buffered += decoder.decode(chunk, { stream: true });
                    // SSE messages are separated by blank lines; data: lines accumulate
                    let sep;
                    while ((sep = buffered.indexOf('\n\n')) >= 0) {
                        const block = buffered.slice(0, sep);
                        buffered = buffered.slice(sep + 2);
                        // Each block can have event: ... and data: ... lines
                        const dataLines = [];
                        let eventName = '';
                        for (const line of block.split('\n')) {
                            if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
                            else if (line.startsWith('event:')) eventName = line.slice(6).trim();
                        }
                        if (dataLines.length === 0) continue;
                        const dataStr = dataLines.join('\n');
                        if (dataStr === '[DONE]') break;
                        let evt;
                        try { evt = JSON.parse(dataStr); } catch { continue; }

                        // Anthropic format
                        if (provider === 'anthropic') {
                            if (eventName === 'content_block_delta' && evt?.delta?.type === 'text_delta') {
                                const t = evt.delta.text || '';
                                if (t) { sse({ delta: t }); }
                            } else if (eventName === 'message_delta' && evt?.usage) {
                                completionTokens = evt.usage.output_tokens || completionTokens;
                            } else if (eventName === 'message_start' && evt?.message?.usage) {
                                promptTokens = evt.message.usage.input_tokens || 0;
                            }
                        } else {
                            // OpenAI / OpenAI-compatible
                            const delta = evt?.choices?.[0]?.delta?.content || '';
                            if (delta) { sse({ delta }); }
                            if (evt?.usage) {
                                promptTokens = evt.usage.prompt_tokens || promptTokens;
                                completionTokens = evt.usage.completion_tokens || completionTokens;
                            }
                        }
                    }
                }
            } catch (streamErr) {
                (req.log || routesLlmLog).error('llm stream interrupted', { error: streamErr.message });
                streamInterrupted = true;
                streamErrMessage = streamErr?.message?.slice(0, 500) || 'stream_error';
            } finally {
                clearTimeout(overallTimer);
            }

            // Final usage + log
            const totalTokens = promptTokens + completionTokens;
            await recordUsage({
                tenantId: tenantId(req),
                userId,
                provider: budgetProvider,
                metric: 'tokens',
                amount: totalTokens
            });
            const responseTimeStream = Date.now() - startTime;
            const pricing = await new Promise((resolve) => {
                dbAdapter.get('SELECT * FROM llm_model_pricing WHERE provider = ? AND (model = ? OR model = ?)',
                    [provider, model, 'default'], (err, row) => {
                    resolve(row || { input_cost_per_1k: 0, output_cost_per_1k: 0 });
                });
            });
            const estCost = (promptTokens / 1000) * pricing.input_cost_per_1k
                + (completionTokens / 1000) * pricing.output_cost_per_1k;
            dbAdapter.run(`INSERT INTO llm_usage (user_id, date, prompt_tokens, completion_tokens, total_tokens, estimated_cost, model, request_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, date) DO UPDATE SET
                prompt_tokens = llm_usage.prompt_tokens + excluded.prompt_tokens,
                completion_tokens = llm_usage.completion_tokens + excluded.completion_tokens,
                total_tokens = llm_usage.total_tokens + excluded.total_tokens,
                estimated_cost = llm_usage.estimated_cost + excluded.estimated_cost,
                request_count = llm_usage.request_count + 1,
                updated_at = CURRENT_TIMESTAMP`,
                [userId, today, promptTokens, completionTokens, totalTokens, estCost, model]);
            // Schema's status CHECK whitelists ('success','error','rate_limited').
            // Stream interrupts (upstream error mid-stream OR client disconnect)
            // get logged as 'error' with error_message disambiguating the cause.
            const finalStatus = streamInterrupted ? 'error' : 'success';
            dbAdapter.run(`INSERT INTO llm_request_log (user_id, session_id, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost, status, error_message, response_time_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, session_id, model, promptTokens, completionTokens, totalTokens, estCost, finalStatus, streamErrMessage, responseTimeStream]);

            if (!res.writableEnded) {
                sse({ done: true, usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens } });
                res.write('data: [DONE]\n\n');
                return res.end();
            }
            return;
        }

        // F-005: non-stream upstream had no timeout — a slow or never-
        // returning endpoint pinned the server connection indefinitely.
        // 60s is generous for non-stream completion latencies; client
        // disconnects also abort the upstream so resources are released
        // promptly.
        const nonStreamController = new AbortController();
        const nonStreamTimer = setTimeout(
            () => nonStreamController.abort(new Error('upstream_timeout')),
            LLM_UPSTREAM_CONNECT_MS
        );
        req.on('close', () => {
            if (!nonStreamController.signal.aborted) {
                try { nonStreamController.abort(new Error('client_disconnected')); } catch { /* noop */ }
            }
        });
        // Keep the timer alive through both fetch() AND body parse — a
        // slow-trickle upstream body would otherwise pin the connection
        // past the 60s cap. The outer try/finally covers every exit path
        // (success, !ok branch, body-parse throw, fetch throw); the route
        // handler's outer catch handles any rethrow.
        let response;
        let rawData;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: llmHeaders,
                body: JSON.stringify(requestPayload),
                signal: nonStreamController.signal
            });

            const responseTime = Date.now() - startTime;

            if (!response.ok) {
                const errText = await response.text();
                (req.log || routesLlmLog).error('llm upstream error', { status: response.status, error: errText });
                dbAdapter.run('INSERT INTO llm_request_log (user_id, session_id, model, status, error_message, response_time_ms) VALUES (?, ?, ?, ?, ?, ?)',
                    [userId, session_id, model, 'error', errText.substring(0, 500), responseTime]);
                return res.status(response.status).json({ error: extractUpstreamError(errText) });
            }

            rawData = await response.json();
        } finally {
            clearTimeout(nonStreamTimer);
        }

        const responseTime = Date.now() - startTime;

        // 11. Normalize response format (Anthropic vs OpenAI)
        let data;
        let promptTokens, completionTokens, totalTokens;

        if (provider === 'anthropic') {
            // Anthropic response format -> OpenAI format
            const content = rawData.content?.[0]?.text || '';
            promptTokens = rawData.usage?.input_tokens || 0;
            completionTokens = rawData.usage?.output_tokens || 0;
            totalTokens = promptTokens + completionTokens;

            data = {
                choices: [{
                    message: { role: 'assistant', content },
                    finish_reason: rawData.stop_reason || 'stop'
                }],
                usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens }
            };
        } else {
            // OpenAI-compatible format
            data = rawData;
            promptTokens = data.usage?.prompt_tokens || 0;
            completionTokens = data.usage?.completion_tokens || 0;
            totalTokens = data.usage?.total_tokens || promptTokens + completionTokens;
        }

        // 12. Calculate estimated cost
        const pricing = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT * FROM llm_model_pricing WHERE provider = ? AND (model = ? OR model = ?)',
                [provider, model, 'default'], (err, row) => {
                if (err) reject(err);
                else resolve(row || { input_cost_per_1k: 0, output_cost_per_1k: 0 });
            });
        });

        const estimatedCost = (promptTokens / 1000) * pricing.input_cost_per_1k +
                             (completionTokens / 1000) * pricing.output_cost_per_1k;

        await recordUsage({
            tenantId: tenantId(req),
            userId,
            provider: budgetProvider,
            metric: 'tokens',
            amount: totalTokens
        });

        // 13. Update user's daily usage (upsert)
        dbAdapter.run(`
            INSERT INTO llm_usage (user_id, date, prompt_tokens, completion_tokens, total_tokens, estimated_cost, model, request_count, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, date) DO UPDATE SET
            prompt_tokens = llm_usage.prompt_tokens + excluded.prompt_tokens,
            completion_tokens = llm_usage.completion_tokens + excluded.completion_tokens,
            total_tokens = llm_usage.total_tokens + excluded.total_tokens,
            estimated_cost = llm_usage.estimated_cost + excluded.estimated_cost,
            request_count = llm_usage.request_count + 1,
            updated_at = CURRENT_TIMESTAMP
        `, [userId, today, promptTokens, completionTokens, totalTokens, estimatedCost, model]);

        // 14. Log the request
        dbAdapter.run(`INSERT INTO llm_request_log (user_id, session_id, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost, status, response_time_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, session_id, model, promptTokens, completionTokens, totalTokens, estimatedCost, 'success', responseTime]);

        (req.log || routesLlmLog).info('llm usage recorded', { user_id: userId, total_tokens: totalTokens, estimated_cost: Number(estimatedCost.toFixed(4)), response_time_ms: responseTime });

        // 15. Return response
        res.json(data);
    } catch (err) {
        if (err instanceof BudgetExceededError) {
            return res.status(429).json(budgetExceededResponse(err));
        }
        (req.log || routesLlmLog).error('llm proxy failed', { error: err.message });
        res.status(500).json({ error: "LLM Request Failed", details: err.message });
    }
});

// ========================================
// SCENARIO REPOSITORY ROUTES
// ========================================

// Get all scenarios (public + user's private ones)

// Model catalogue served to the settings UI. Source of truth:
// server/shared/llmCatalogue.js (also drives the pickers and pricing seed).
router.get('/llm/models', authenticateToken, (req, res) => {
    res.json({ models: LLM_MODEL_REGISTRY });
});

// GET /api/tts/usage - char-count + cost rollups for the calling user
// (or all users for admins via ?scope=all). Returns today, last 7 days,
// last 30 days, and an optional Google free-tier indicator.
//
// The free-tier remaining for Google is computed from the calendar month's
// total char_count — Google's free tier is 1M chars/month/account, not
// per-user, so this is more useful as a platform-wide indicator.
router.get('/tts/usage', authenticateToken, async (req, res) => {
    try {
        const isAdmin = hasRoleAtLeast(req.user, ROLE_RANKS.admin);
        const scopeAll = isAdmin && req.query.scope === 'all';
        const userFilter = scopeAll ? '' : 'AND user_id = ?';
        const userParam = scopeAll ? [] : [req.user.id];

        const today = new Date().toISOString().slice(0, 10);
        const monthStart = today.slice(0, 7) + '-01';
        const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

        const queryRollup = (whereDate) => new Promise((resolve, reject) => {
            dbAdapter.all(
                `SELECT provider,
                        SUM(char_count)     AS chars,
                        SUM(request_count)  AS requests,
                        SUM(estimated_cost) AS cost
                 FROM tts_usage
                 WHERE date >= ? ${userFilter}
                 GROUP BY provider`,
                [whereDate, ...userParam],
                (err, rows) => err ? reject(err) : resolve(rows || [])
            );
        });

        const [todayRows, weekRows, monthRows, allTimeRows] = await Promise.all([
            queryRollup(today),
            queryRollup(sevenDaysAgo),
            queryRollup(monthStart),
            queryRollup('1970-01-01')
        ]);

        // Google free tier: 1M chars/month for Neural2/WaveNet/Chirp HD,
        // 4M for Standard. We default to the Neural2 figure since that's
        // what the curated voice list ships.
        const googleMonthly = monthRows.find(r => r.provider === 'google')?.chars || 0;
        const googleFreeRemaining = Math.max(0, 1_000_000 - googleMonthly);

        res.json({
            scope: scopeAll ? 'all' : 'self',
            today: todayRows,
            last_7_days: weekRows,
            this_month: monthRows,
            all_time: allTimeRows,
            google_free_tier_remaining: googleFreeRemaining,
            google_free_tier_total: 1_000_000
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// TTS ROUTES
// ============================================
// PIPER_DIR / PIPER_BIN and every catalogue/derivation/usability helper
// live in server/services/ttsProviders.js — the one validator (Voice 2.0).

const TTS_TEXT_LIMIT = 2000;

// GET /api/tts/voices - voice catalogues (Voice 2.0, VOICE2_PLAN.md §5.6).
// Default response covers ALL providers so pickers can offer every usable
// engine's voices (grouped, with usability + reason for disabled groups).
// ?provider=<p> keeps the single-provider shape for per-provider needs
// (settings tab default-voice selects). Listing never forces a kokoro
// model load — the static package catalogue serves until the model is up.
router.get('/tts/voices', authenticateToken, async (req, res) => {
    try {
        const queryProvider = typeof req.query.provider === 'string' ? req.query.provider : '';
        if (TTS_PROVIDERS.includes(queryProvider)) {
            const status = await getProviderStatus(queryProvider);
            return res.json({
                provider: queryProvider,
                voices: await listVoicesForProvider(queryProvider),
                usable: status.usable,
                reason: status.reason,
                piperInstalled: fs.existsSync(PIPER_BIN)
            });
        }
        const providers = [];
        for (const p of TTS_PROVIDERS) {
            const status = await getProviderStatus(p);
            providers.push({ ...status, voices: await listVoicesForProvider(p) });
        }
        res.json({ providers });
    } catch (err) {
        (req.log || routesLlmLog).error('voice listing failed', { error: err.message });
        res.status(500).json({ error: 'Failed to list voices' });
    }
});

// GET /api/tts/voice-usage — which cases/personas rely on each engine,
// derived per stored case_voice. Feeds the engine-off impact modal in
// Settings → Voice: a configured voice is LITERAL (it fails rather than
// substitute), so disabling an engine strands these rows — the admin sees
// the blast radius, by name, BEFORE flipping the toggle. Admin-only: it
// enumerates case/persona names across the platform.
router.get('/tts/voice-usage', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const rows = await new Promise((resolve, reject) => {
            dbAdapter.all(`
                SELECT 'persona' AS kind, id, name, config FROM agent_templates
                WHERE config LIKE '%case_voice%'
                UNION ALL
                SELECT 'case' AS kind, id, name, config FROM cases
                WHERE config LIKE '%case_voice%'
            `, (err, r) => err ? reject(err) : resolve(r || []));
        });
        const byProvider = Object.fromEntries(TTS_PROVIDERS.map(p => [p, []]));
        const unknown = [];
        for (const row of rows) {
            let cfg = row.config;
            if (typeof cfg === 'string') {
                try { cfg = JSON.parse(cfg); } catch { cfg = null; }
            }
            const cv = cfg?.voice?.case_voice;
            if (typeof cv !== 'string' || !cv) continue;
            const { provider } = await deriveVoiceProvider(cv);
            const entry = { kind: row.kind, id: row.id, name: row.name, voice: cv };
            if (provider) byProvider[provider].push(entry);
            else unknown.push(entry);
        }
        res.json({ providers: byProvider, unknown });
    } catch (err) {
        (req.log || routesLlmLog).error('voice usage scan failed', { error: err.message });
        res.status(500).json({ error: 'Failed to scan voice usage' });
    }
});

// Per-provider input-text pricing (USD per 1M characters). Local providers
// are free. Google Neural2/Chirp HD costs $16/M after the 1M/month free
// tier, but for cost rollups we charge it from char 1 — the UI shows the
// free-tier remaining separately so users see the savings explicitly.
// Stable enough to hardcode; no db-driven price table needed.
const TTS_COST_PER_M_CHARS = {
    piper:  0,
    kokoro: 0,
    openai: 15,    // tts-1
    google: 16     // Neural2 / WaveNet — Chirp HD is $30 but we don't model it separately
};

// Voice 2.0 (VOICE2_PLAN.md §5.3): validation of a (provider, voice) pair
// delegates to the single catalogue authority in services/ttsProviders.js.
// Routing itself derives the provider FROM the voice (deriveVoiceProvider);
// this check exists for the preview route's explicit provider override.
async function resolveTtsVoice(provider, requestedVoice) {
    try {
        const ok = await providerHasVoice(provider, requestedVoice);
        return ok
            ? { ok: true, voice: requestedVoice }
            : { ok: false, reason: `voice "${requestedVoice}" is not a ${provider} voice` };
    } catch (err) {
        routesLlmLog.warn('tts voice catalogue check failed', { provider, error: err.message });
        return { ok: false, reason: `catalogue check failed: ${err.message}` };
    }
}

function recordTtsUsage(userId, provider, charCount) {
    if (!userId || !provider || !charCount) return;
    const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
    const rate = TTS_COST_PER_M_CHARS[provider] ?? 0;
    const cost = (charCount / 1_000_000) * rate;
    dbAdapter.run(
        `INSERT INTO tts_usage (user_id, date, provider, char_count, request_count, estimated_cost, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, date, provider) DO UPDATE SET
            char_count    = tts_usage.char_count    + excluded.char_count,
            request_count = tts_usage.request_count + 1,
            estimated_cost = tts_usage.estimated_cost + excluded.estimated_cost,
            updated_at    = CURRENT_TIMESTAMP`,
        [userId, today, provider, charCount, cost],
        (err) => { if (err) routesLlmLog.warn('tts usage insert failed', { error: err.message }); }
    );
}

// Shared PCM-stream framing for any provider that yields { sampleRate, pcm }.
// Wire format (little-endian throughout):
//   header: 4 bytes — sampleRate (uint32)
//   then repeating frames:
//       4 bytes — pcm byte length (uint32, 0 = end-of-stream)
//       N bytes — int16 PCM samples
async function pipePcmStream(res, asyncIter) {
    res.set('Content-Type', 'application/x-rohy-pcm-stream');
    res.set('Cache-Control', 'no-store');
    res.set('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    if (res.socket) res.socket.setNoDelay(true);
    let headerSent = false;
    const aligner = new EvenByteAligner();
    for await (const { sampleRate, pcm } of asyncIter) {
        if (!headerSent) {
            const hdr = Buffer.alloc(4);
            hdr.writeUInt32LE(sampleRate, 0);
            res.write(hdr);
            headerSent = true;
        }
        const aligned = aligner.push(pcm);
        if (!aligned) continue;
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32LE(aligned.length, 0);
        res.write(lenBuf);
        res.write(aligned);
    }
    aligner.flush(); // residual odd byte (if any) is dropped — half-sample is unrecoverable
    if (!headerSent) {
        const hdr = Buffer.alloc(4);
        hdr.writeUInt32LE(24000, 0);
        res.write(hdr);
    }
    const eof = Buffer.alloc(4);
    eof.writeUInt32LE(0, 0);
    res.write(eof);
    res.end();
}

// POST /api/tts - synthesize speech (returns audio/wav OR x-rohy-pcm-stream).
// Voice 2.0 + sovereignty (VOICE2_PLAN.md v1.4): THE VOICE OWNS ITS ENGINE,
// AND A CONFIGURED VOICE IS LITERAL. The provider is derived from the
// requested voice id by exact catalogue membership — there is no platform
// engine setting, and body/query provider fields are ignored on this route.
// A voice whose engine can't play it (unknown id, engine not installed /
// unkeyed / disabled) is an honest 400 — the server NEVER substitutes a
// stand-in for an explicit voice (owner directive: the case sound reigns
// supreme; a wrong voice is worse than an honest error). The per-language
// default voices are a CLIENT-side tier for personas with no voice
// configured at all; by the time a request reaches this route the voice is
// always explicit. The engine-off impact modal in Settings → Voice warns
// admins which cases a toggle strands BEFORE they flip it.
router.post('/tts', authenticateToken, async (req, res) => {
    return handleTtsSynthesis(req, res, { isPreview: false });
});

// Admin preview: accepts a `provider` override on the body so the Voice
// settings tab can audition any voice without touching the runtime path.
// Same literal-or-error semantics as the main route.
router.post('/tts/preview', authenticateToken, requireAdmin, async (req, res) => {
    return handleTtsSynthesis(req, res, { isPreview: true });
});

async function handleTtsSynthesis(req, res, { isPreview }) {
    // `gender` and `provider` are still accepted on the wire so older
    // clients don't break; `provider` is only consulted on the preview
    // route. `language` (registry code) is accepted for diagnostics — it
    // names the session language in rejection logs.
    const { text, voice: requestedVoice, rate, pitch, provider: bodyProvider, language: bodyLanguage } = req.body || {};

    if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'text required' });
    }
    if (text.length > TTS_TEXT_LIMIT) {
        return res.status(400).json({ error: `text exceeds ${TTS_TEXT_LIMIT} character limit` });
    }
    if (typeof requestedVoice !== 'string' || !requestedVoice) {
        return res.status(400).json({ error: 'voice required' });
    }

    // ---- Plan which (provider, voice) actually synthesizes ----
    let plan;
    if (isPreview) {
        const queryProvider = typeof req.query.provider === 'string' && TTS_PROVIDERS.includes(req.query.provider)
            ? req.query.provider : null;
        const bodyProviderOverride = typeof bodyProvider === 'string' && TTS_PROVIDERS.includes(bodyProvider)
            ? bodyProvider : null;
        const provider = bodyProviderOverride || queryProvider
            || (await deriveVoiceProvider(requestedVoice)).provider;
        if (!provider) {
            return res.status(400).json({
                error: 'invalid_voice',
                message: `Voice "${requestedVoice}" is in no provider's catalogue.`,
                requested_voice: requestedVoice
            });
        }
        const resolved = await resolveTtsVoice(provider, requestedVoice);
        if (!resolved.ok) {
            return res.status(400).json({
                error: 'invalid_voice',
                message: `Voice "${requestedVoice}" is not valid for provider "${provider}".`,
                provider,
                requested_voice: requestedVoice,
                reason: resolved.reason
            });
        }
        plan = { provider, voice: requestedVoice, substituted: false };
    } else {
        // A configured voice is LITERAL: it plays on its own derived engine
        // or the request fails honestly. No stand-ins.
        const { provider: derived } = await deriveVoiceProvider(requestedVoice);
        if (!derived) {
            const guessedProvider = guessVoiceProvider(requestedVoice);
            routesLlmLog.warn('tts voice rejected', {
                requested_voice: requestedVoice,
                provider: guessedProvider,
                language: bodyLanguage || null,
                reason: 'unknown_voice'
            });
            return res.status(400).json({
                error: 'invalid_voice',
                message: `Voice "${requestedVoice}" is in no provider's catalogue. Re-pick it in the case editor or Agent Personas.`,
                provider: guessedProvider,
                requested_voice: requestedVoice,
                reason: 'unknown_voice'
            });
        }
        const status = await getProviderStatus(derived);
        if (!status.usable) {
            routesLlmLog.warn('tts voice rejected', {
                requested_voice: requestedVoice,
                provider: derived,
                language: bodyLanguage || null,
                reason: 'engine_unusable',
                engine_status: status.reason
            });
            return res.status(400).json({
                error: 'invalid_voice',
                message: `Voice "${requestedVoice}" needs the "${derived}" engine, which is not usable on this server (${status.reason}). Fix the engine in Settings → Voice or re-pick the voice.`,
                provider: derived,
                requested_voice: requestedVoice,
                reason: 'engine_unusable',
                detail: status.reason
            });
        }
        plan = { provider: derived, voice: requestedVoice };
    }

    try {
        await enforceBudget({
            tenantId: tenantId(req),
            userId: req.user?.id,
            provider: `tts-${plan.provider}`,
            metric: 'characters',
            requested: text.length
        });
    } catch (err) {
        if (err instanceof BudgetExceededError) {
            return res.status(429).json(budgetExceededResponse(err));
        }
        throw err;
    }

    // Record char usage up-front for the engine that actually synthesizes.
    // Paid engines bill on submission, not delivery; local rows are $0 but
    // keep per-user volume visible.
    recordTtsUsage(req.user?.id, plan.provider, text.length);
    await recordUsage({
        tenantId: tenantId(req),
        userId: req.user?.id,
        provider: `tts-${plan.provider}`,
        metric: 'characters',
        amount: text.length
    });

    try {
        return await synthesizeToResponse(req, res, plan, { text, rate, pitch });
    } catch (err) {
        // A runtime engine failure (quota, network, 5xx) is an honest error
        // — the configured voice is literal, so there is no retry onto a
        // stand-in (owner directive, VOICE2_PLAN.md v1.4). The first-chunk
        // pre-flight keeps the response uncommitted until the engine
        // actually delivers, so the client gets a real JSON error instead
        // of a dead stream.
        return sendSynthesisError(req, res, plan.provider, err);
    }
}

// Maps a synthesis error to an HTTP response. Only reachable while no audio
// bytes have been written (pre-flight contract); if headers somehow went
// out, end the stream — audio can't be unsaid.
function sendSynthesisError(req, res, provider, err) {
    (req.log || routesLlmLog).error('tts synthesis failed', {
        provider,
        error: err.message,
        code: err.code || null,
    });
    if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
    }
    let status = 502, msg = `${provider} synthesis failed`;
    if (err.code === 'UNKNOWN_VOICE') { status = 400; msg = err.message; }
    else if (err.code === 'NO_API_KEY' || err.code === 'BAD_API_KEY') { status = 503; msg = err.message; }
    else if (err.code === 'KOKORO_DISABLED') {
        status = 503;
        msg = 'Kokoro is disabled until the next server restart (model load failed).';
    } else if (provider === 'kokoro' || provider === 'piper') {
        status = 500; // local engine — upstream 502 semantics don't apply
        msg = err.publicMessage || msg;
    }
    return res.status(status).json({ error: msg, code: err.code || null });
}

// First-chunk pre-flight (VOICE2_PLAN.md §5.3): pull the first upstream
// chunk BEFORE the caller flushes response headers, so an engine that
// fails at request time throws while the response is still uncommitted —
// handleTtsSynthesis can then substitute the default voice or send an
// honest JSON error instead of a dead stream.
async function preflightFirstChunk(asyncIterable) {
    const iterator = asyncIterable[Symbol.asyncIterator]();
    const first = await iterator.next(); // throws on request-time failure
    async function* resumed() {
        if (!first.done) yield first.value;
        for (;;) {
            const next = await iterator.next();
            if (next.done) break;
            yield next.value;
        }
    }
    return resumed();
}

// Synthesizes plan.voice on plan.provider and writes the audio to `res`.
// CONTRACT: while headers are unsent this function THROWS on failure and
// never writes an error response — handleTtsSynthesis owns retry/error
// policy. Once audio bytes are flowing, a mid-stream failure ends the
// stream here (nothing else is possible).
async function synthesizeToResponse(req, res, plan, { text, rate, pitch }) {
    const voice = plan.voice;
    const stream = req.query.stream === '1' || req.headers.accept?.includes('application/x-rohy-pcm-stream');

    if (plan.provider === 'google') {
        const { synthesizeGoogleStream, synthesizeGoogleWav } = await import('../services/googleTts.js');
        // Google supports 0.25–4.0; widened from 0.5–1.5 so an elderly or
        // respiratory-distressed patient can sound notably slower (~0.7) and
        // an anxious / tachypneic patient can sound faster (~1.3) without
        // hitting the cartoon end of the range.
        const speed = (rate !== undefined && rate !== null && Number.isFinite(parseFloat(rate)))
            ? Math.max(0.7, Math.min(1.3, parseFloat(rate)))
            : 1;
        const pitchSemitones = (pitch !== undefined && pitch !== null && pitch !== '' && Number.isFinite(parseFloat(pitch)))
            ? Math.max(-10, Math.min(10, parseFloat(pitch)))
            : 0;
        const apiKey = (await getPlatformSetting('google_tts_api_key')) || '';
        if (stream) {
            // Pre-flight: a request-time failure throws here, before any
            // header/byte is committed — the caller can still substitute.
            const chunks = await preflightFirstChunk(
                synthesizeGoogleStream({ text, voice, speed, pitch: pitchSemitones, apiKey })
            );
            try {
                await pipePcmStream(res, chunks);
            } catch (err) {
                (req.log || routesLlmLog).error('google tts failed mid-stream', { error: err.message });
                if (!res.writableEnded) res.end();
            }
            return;
        }
        const wav = await synthesizeGoogleWav({ text, voice, speed, pitch: pitchSemitones, apiKey });
        res.set('Content-Type', 'audio/wav');
        res.set('Cache-Control', 'no-store');
        res.set('Content-Length', String(wav.length));
        return res.end(wav);
    }

    if (plan.provider === 'openai') {
        const { synthesizeOpenaiStream, synthesizeOpenaiWav } = await import('../services/openaiTts.js');
        // OpenAI clamps speed to [0.25, 4.0] internally; we honour the same
        // 0.5–1.5 window the rest of the platform uses so cases stay portable.
        const speed = (rate !== undefined && rate !== null && Number.isFinite(parseFloat(rate)))
            ? Math.max(0.5, Math.min(1.5, parseFloat(rate)))
            : 1;
        // Prefer an explicit TTS-only key. Fall back to the platform's existing
        // OpenAI LLM key when the LLM is also OpenAI, so users who already have
        // one configured for chat get TTS for free.
        const explicitTtsKey      = (await getPlatformSetting('openai_tts_api_key')) || '';
        const platformLlmProvider = (await getPlatformSetting('llm_provider')) || '';
        const platformLlmApiKey   = (await getPlatformSetting('llm_api_key')) || '';
        const apiKey = explicitTtsKey
            || (platformLlmProvider === 'openai' ? platformLlmApiKey : '');

        if (stream) {
            const chunks = await preflightFirstChunk(
                synthesizeOpenaiStream({ text, voice, speed, apiKey })
            );
            try {
                await pipePcmStream(res, chunks);
            } catch (err) {
                (req.log || routesLlmLog).error('openai tts failed mid-stream', { error: err.message });
                if (!res.writableEnded) res.end();
            }
            return;
        }
        const wav = await synthesizeOpenaiWav({ text, voice, speed, apiKey });
        res.set('Content-Type', 'audio/wav');
        res.set('Cache-Control', 'no-store');
        res.set('Content-Length', String(wav.length));
        return res.end(wav);
    }

    if (plan.provider === 'kokoro') {
        // Streaming path: emit a custom binary frame per Kokoro sentence so
        // the browser can start playing the first sentence while later ones
        // are still being synthesized.
        //
        // Wire format (little-endian throughout):
        //   header: 4 bytes — sampleRate (uint32)
        //   then repeating frames:
        //       4 bytes — pcm byte length (uint32, 0 = end-of-stream)
        //       N bytes — int16 PCM samples
        const speed = (rate !== undefined && rate !== null && Number.isFinite(parseFloat(rate)))
            ? Math.max(0.5, Math.min(1.5, parseFloat(rate)))
            : 1;

        if (stream) {
            // If the client disconnects mid-synthesis, breaking the for-await
            // tells kokoro-js's generator to clean up; we also stop scheduling
            // new sentences so we don't burn ~600 MB of inference for nobody.
            let clientGone = false;
            req.on('close', () => { if (!res.writableEnded) clientGone = true; });
            const { synthesizeKokoroStream } = await import('../services/kokoroTts.js');
            // Pre-flight the first sentence: UNKNOWN_VOICE / KOKORO_DISABLED
            // now surface as honest JSON errors (they throw before headers),
            // where the old order — flush headers, then load the model —
            // could only kill the stream silently.
            const chunks = await preflightFirstChunk(synthesizeKokoroStream({ text, voice, speed }));
            try {
                res.set('Content-Type', 'application/x-rohy-pcm-stream');
                res.set('Cache-Control', 'no-store');
                res.set('X-Accel-Buffering', 'no'); // bypass nginx buffering if proxied
                res.flushHeaders?.();
                if (res.socket) res.socket.setNoDelay(true);
                let headerSent = false;
                for await (const { sampleRate, pcm } of chunks) {
                    if (clientGone) break;
                    if (!headerSent) {
                        const hdr = Buffer.alloc(4);
                        hdr.writeUInt32LE(sampleRate, 0);
                        res.write(hdr);
                        headerSent = true;
                    }
                    const lenBuf = Buffer.alloc(4);
                    lenBuf.writeUInt32LE(pcm.length, 0);
                    res.write(lenBuf);
                    res.write(pcm);
                }
                if (clientGone) return; // socket already closed; no point writing EOF
                if (!headerSent) {
                    // No chunks at all — client expects header. Send dummy.
                    const hdr = Buffer.alloc(4);
                    hdr.writeUInt32LE(24000, 0);
                    res.write(hdr);
                }
                const eof = Buffer.alloc(4);
                eof.writeUInt32LE(0, 0);
                res.write(eof);
                return res.end();
            } catch (err) {
                (req.log || routesLlmLog).error('kokoro tts failed mid-stream', {
                    error: err.message,
                    code: err.code || null,
                });
                if (!res.writableEnded) res.end();
                return;
            }
        }

        // Non-streaming fallback: full WAV in one response.
        const { synthesizeKokoro } = await import('../services/kokoroTts.js');
        const wav = await synthesizeKokoro({ text, voice, speed });
        res.set('Content-Type', 'audio/wav');
        res.set('Cache-Control', 'no-store');
        res.set('Content-Length', String(wav.length));
        return res.end(wav);
    }

    // ---- Piper path ----
    if (plan.provider !== 'piper') {
        // Unreachable by construction — plans only carry derived providers.
        throw new Error(`unknown provider "${plan.provider}"`);
    }
    const publicError = (message, code) => {
        const err = new Error(message);
        err.publicMessage = message;
        if (code) err.code = code;
        return err;
    };
    if (voice.includes('/') || voice.includes('\\') || voice.includes('..') || !voice.endsWith('.onnx')) {
        throw publicError('invalid voice filename', 'UNKNOWN_VOICE');
    }

    const voiceFile = path.join(PIPER_DIR, voice);
    if (!voiceFile.startsWith(PIPER_DIR + path.sep) || !fs.existsSync(voiceFile)) {
        throw publicError('unknown voice', 'UNKNOWN_VOICE');
    }
    // Resolve symlinks: a planted symlink within PIPER_DIR pointing outside
    // would otherwise pass startsWith but feed Piper an arbitrary file path.
    // Realistic threat is low (needs write access to PIPER_DIR), but the
    // hardening is one syscall.
    try {
        const realVoiceFile = fs.realpathSync(voiceFile);
        const realPiperDir = fs.realpathSync(PIPER_DIR);
        if (!realVoiceFile.startsWith(realPiperDir + path.sep)) {
            throw new Error('symlink escape');
        }
    } catch {
        throw publicError('unknown voice', 'UNKNOWN_VOICE');
    }
    if (!fs.existsSync(PIPER_BIN)) {
        throw publicError('Piper TTS binary not installed on server', 'NO_API_KEY');
    }

    const sidecar = readVoiceSidecar(voice);
    const sampleRate = sidecar?.audio?.sample_rate || 22050;

    // piper-tts 1.x (Python rewrite) truncates stdin synthesis to ~0.6s
    // regardless of input length. The `-i FILE` path doesn't have this bug,
    // so we write the prompt to a temp file and feed it that way.
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `rohy-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
    try {
        fs.writeFileSync(tmpFile, text, 'utf8');
    } catch (err) {
        routesLlmLog.error('piper temp input write failed', { error: err.message });
        throw publicError('Failed to prepare TTS input');
    }

    // piper1-gpl (Python rewrite) accepts `-m / --model`, `-i / --input-file`,
    // `--output-raw`, and `--length-scale` — same names as the old standalone.
    // It does NOT accept `--quiet`; piper1 logs at WARN level by default which
    // we discard via stderr handling below, so dropping the flag is harmless.
    const args = ['--model', voiceFile, '-i', tmpFile, '--output-raw'];
    if (rate !== undefined && rate !== null) {
        const r = parseFloat(rate);
        if (Number.isFinite(r) && r >= 0.5 && r <= 1.5) {
            args.push('--length-scale', String(1 / r));
        }
    }

    let piper;
    try {
        piper = spawn(PIPER_BIN, args);
    } catch (err) {
        routesLlmLog.error('piper spawn failed', { error: err.message });
        try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
        throw publicError('Failed to start Piper');
    }

    // Promise wrapper keeps the synthesizeToResponse contract: reject before
    // any bytes are written (caller formats the error), resolve after the
    // WAV is fully sent or the client is gone.
    await new Promise((resolve, reject) => {
        const chunks = [];
        let totalLen = 0;
        let stderrBuf = '';
        let aborted = false;
        let clientGone = false;

        const cleanup = () => {
            try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
        };

        // If the client disconnects before piper finishes, kill the subprocess
        // so we don't burn CPU and disk on a synthesis nobody's listening to.
        req.on('close', () => {
            if (res.writableEnded) return;
            clientGone = true;
            aborted = true;
            try { piper.kill('SIGTERM'); } catch { /* noop */ }
        });

        piper.stdout.on('data', (c) => {
            chunks.push(c);
            totalLen += c.length;
            if (totalLen > 50 * 1024 * 1024) {
                aborted = true;
                try { piper.kill('SIGTERM'); } catch { /* noop */ }
            }
        });
        piper.stderr.on('data', (d) => { stderrBuf += d.toString(); });
        piper.on('error', (err) => {
            routesLlmLog.error('piper process error', { error: err.message });
            cleanup();
            if (clientGone) return resolve();
            reject(publicError('Piper process error'));
        });
        piper.on('close', (code) => {
            cleanup();
            if (clientGone || res.headersSent) return resolve();
            if (aborted) return reject(publicError('TTS output exceeded size limit'));
            if (code !== 0) {
                routesLlmLog.warn('piper exited non-zero', { code, stderr: stderrBuf.slice(0, 500) });
                return reject(publicError('Piper synthesis failed'));
            }
            const pcm = Buffer.concat(chunks, totalLen);
            const header = buildWavHeader(pcm.length, sampleRate);
            res.set('Content-Type', 'audio/wav');
            res.set('Cache-Control', 'no-store');
            res.set('Content-Length', String(header.length + pcm.length));
            res.write(header);
            res.end(pcm);
            resolve();
        });
    });
}

// GET /api/llm/usage - Get current user's usage
router.get('/llm/usage', authenticateToken, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Get user's daily usage
        const userUsage = await new Promise((resolve, reject) => {
            dbAdapter.get(
                `SELECT * FROM llm_usage WHERE user_id = ? AND date = ?`,
                [req.user.id, today],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { total_tokens: 0, estimated_cost: 0, request_count: 0 });
                }
            );
        });

        // Get rate limits
        const limits = {
            tokensPerUserDaily: parseInt(await getPlatformSetting('rate_limit_tokens_per_user_daily')) || DEFAULT_RATE_LIMITS.tokensPerUserDaily,
            costPerUserDaily: parseFloat(await getPlatformSetting('rate_limit_cost_per_user_daily')) || DEFAULT_RATE_LIMITS.costPerUserDaily
        };

        res.json({
            date: today,
            tokensUsed: userUsage.total_tokens,
            tokensLimit: limits.tokensPerUserDaily,
            tokensRemaining: Math.max(0, limits.tokensPerUserDaily - userUsage.total_tokens),
            costUsed: userUsage.estimated_cost,
            costLimit: limits.costPerUserDaily,
            costRemaining: Math.max(0, limits.costPerUserDaily - userUsage.estimated_cost),
            requestCount: userUsage.request_count
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/llm/usage/all - Get all users' usage (Admin only)
router.get('/llm/usage/all', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        const usage = await new Promise((resolve, reject) => {
            dbAdapter.all(
                `SELECT lu.*, u.username, u.name
                 FROM llm_usage lu
                 JOIN users u ON lu.user_id = u.id
                 WHERE lu.date = ?
                 ORDER BY lu.total_tokens DESC`,
                [today],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        res.json({ date: today, users: usage });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/llm/usage/platform - Get platform-wide usage (Admin only)
router.get('/llm/usage/platform', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Get platform-wide totals for today
        const platformUsage = await new Promise((resolve, reject) => {
            dbAdapter.get(
                `SELECT
                    SUM(total_tokens) as total_tokens,
                    SUM(estimated_cost) as total_cost,
                    SUM(request_count) as total_requests,
                    COUNT(DISTINCT user_id) as active_users
                 FROM llm_usage WHERE date = ?`,
                [today],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { total_tokens: 0, total_cost: 0, total_requests: 0, active_users: 0 });
                }
            );
        });

        // Get limits
        const limits = {
            tokensPlatformDaily: parseInt(await getPlatformSetting('rate_limit_tokens_platform_daily')) || DEFAULT_RATE_LIMITS.tokensPlatformDaily,
            costPlatformDaily: parseFloat(await getPlatformSetting('rate_limit_cost_platform_daily')) || DEFAULT_RATE_LIMITS.costPlatformDaily
        };

        res.json({
            date: today,
            tokensUsed: platformUsage.total_tokens || 0,
            tokensLimit: limits.tokensPlatformDaily,
            tokensRemaining: Math.max(0, limits.tokensPlatformDaily - (platformUsage.total_tokens || 0)),
            costUsed: platformUsage.total_cost || 0,
            costLimit: limits.costPlatformDaily,
            costRemaining: Math.max(0, limits.costPlatformDaily - (platformUsage.total_cost || 0)),
            totalRequests: platformUsage.total_requests || 0,
            activeUsers: platformUsage.active_users || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/llm/pricing - Get model pricing table (Admin only)
router.get('/llm/pricing', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const pricing = await new Promise((resolve, reject) => {
            dbAdapter.all('SELECT * FROM llm_model_pricing WHERE is_active = 1 ORDER BY provider, model', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        res.json({ pricing });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/llm/pricing - Update model pricing (Admin only)
router.put('/llm/pricing', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { provider, model, inputCostPer1k, outputCostPer1k } = req.body;

        if (!provider || !model) {
            return res.status(400).json({ error: 'Provider and model are required' });
        }

        const oldPricing = await new Promise((resolve, reject) => {
            dbAdapter.get('SELECT * FROM llm_model_pricing WHERE provider = ? AND model = ?', [provider, model], (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        });

        await new Promise((resolve, reject) => {
            dbAdapter.run(
                `INSERT INTO llm_model_pricing (provider, model, input_cost_per_1k, output_cost_per_1k, updated_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(provider, model) DO UPDATE SET
                 input_cost_per_1k = excluded.input_cost_per_1k,
                 output_cost_per_1k = excluded.output_cost_per_1k,
                 updated_at = CURRENT_TIMESTAMP`,
                [provider, model, inputCostPer1k || 0, outputCostPer1k || 0],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        auditSuccess(req, {
            action: 'update_llm_pricing',
            resourceType: 'llm_model_pricing',
            resourceId: `${provider}:${model}`,
            resourceName: model,
            oldValue: oldPricing,
            newValue: { provider, model, inputCostPer1k: inputCostPer1k || 0, outputCostPer1k: outputCostPer1k || 0 }
        });

        res.json({ message: 'Pricing updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// PATIENT RECORD MEMORY MODULE ENDPOINTS
// ============================================

// POST /api/patient-record/sync - Sync patient record (events + document)

export default router;
