import express from 'express';
import { findDefaultAgent } from '../db.js';
import dbAdapter from '../dbAdapter.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'node:os';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import {
    authenticateToken,
    requireAdmin,
    requireAuth,
    requireEducator,
    requireReviewer,
    generateToken,
    recordActiveSession,
    revokeActiveSessionByHash,
    ROLE_RANKS,
    AUTH_COOKIE_NAME,
    getRoleRank,
    hasRoleAtLeast,
} from '../middleware/auth.js';
import {
    CSRF_COOKIE_NAME,
    csrfCookieOptions,
    generateCsrfToken,
} from '../middleware/csrf.js';
import * as labDb from '../services/labDatabase.js';
import { spawn } from 'node:child_process';
import { buildWavHeader } from '../services/wav.js';
import { EvenByteAligner } from '../lib/pcmAlign.js';
import {
    REDACTED,
    redactPlatformSettingRows,
} from '../redaction.js';
import { logger } from '../logger.js';
import { verifyAuditChain } from '../audit-chain.js';
import {
    auditSuccess,
    buildUserPurgePlan,
    canManageOwnedResource,
    canReadAcrossUsers,
    clampInitialVitals,
    createCaseVersion,
    dbGet,
    dbRun,
    executeUserPurge,
    isValidRole,
    logAudit,
    logAuditAsync,
    mergeScenarioSource,
    parseAuditJson,
    redactAuditSetting,
    redactRow,
    redactRows,
    resolveSessionCaseConfig,
    resolveSessionCaseScenario,
    roleForStorage,
    tenantId,
    validatePassword,
    verifySessionOwnership
} from './_helpers.js';
import {
    BudgetExceededError,
    budgetExceededResponse,
    enforceBudget,
    recordUsage
} from '../usage-budget.js';

function authCookieOptions(maxAgeSeconds = 4 * 60 * 60) {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeSeconds * 1000,
    };
}

const auditLog = logger('audit');
const authLog = logger('auth');
const radiologyLog = logger('radiology');
const routesAuthLog = logger('routes-auth-users-tenants');
const routesCasesLog = logger('routes-cases-sessions');
const routesOrdersLog = logger('routes-orders-labs-radiology');
const routesLlmLog = logger('routes-llm-tts');
const routesAdminLog = logger('routes-agent-tna-admin');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: 'Too many registration attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const clientLogLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 60,
    message: { error: 'Too many client log batches. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.user?.tenant_id || 'tenant'}:${req.user?.id || 'user'}`
});

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

const VOICE_TTS_PROVIDERS = ['piper', 'kokoro', 'openai', 'google', 'browser'];

const extractUpstreamError = (errText) => {
    try {
        const parsed = JSON.parse(errText);
        const msg = parsed?.error?.message ?? parsed?.error ?? parsed?.message;
        if (typeof msg === 'string' && msg.length > 0 && msg.length <= 500) return msg;
    } catch { /* not json */ }
    return 'Upstream LLM error';
};

router.post('/proxy/llm', authenticateToken, async (req, res) => {
    const { messages, system_prompt, session_id, agent_llm_config, session_mode } = req.body;
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
        if (agent_llm_config && agent_llm_config.provider) {
            agentProvider = agent_llm_config.provider;
            agentModel = agent_llm_config.model;
            agentApiKey = agent_llm_config.api_key;
            agentEndpoint = agent_llm_config.endpoint;
            if (agent_llm_config.temperature !== undefined && agent_llm_config.temperature !== null && agent_llm_config.temperature !== '') {
                agentTemperature = parseFloat(agent_llm_config.temperature);
                if (!Number.isFinite(agentTemperature)) agentTemperature = null;
            }
            if (agent_llm_config.max_tokens !== undefined && agent_llm_config.max_tokens !== null && agent_llm_config.max_tokens !== '') {
                agentMaxTokens = parseInt(agent_llm_config.max_tokens, 10);
                if (!Number.isFinite(agentMaxTokens)) agentMaxTokens = null;
            }
            (req.log || routesLlmLog).info('using agent-specific llm config', { provider: agentProvider, model: agentModel || null, temperature: agentTemperature ?? null, max_tokens: agentMaxTokens ?? null });
        } else if (agent_llm_config?.agent_template_id) {
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
            baseUrl = sessionLlmSettings.baseUrl.trim();
            apiKey = (sessionLlmSettings?.apiKey && sessionLlmSettings.apiKey.trim()) || platformApiKey;
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

        // 8. Build system prompt
        let fullSystemPrompt = '';
        if (systemPromptTemplate) {
            fullSystemPrompt = systemPromptTemplate;
        }
        if (system_prompt) {
            fullSystemPrompt += (fullSystemPrompt ? '\n\n---\n\n' : '') + system_prompt;
        }

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
                model: model || 'claude-3-5-sonnet-20241022',
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
            const upstream = await fetch(endpoint, {
                method: 'POST',
                headers: llmHeaders,
                body: JSON.stringify(streamPayload)
            });
            if (!upstream.ok) {
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

            let accText = '';
            let promptTokens = 0;
            let completionTokens = 0;
            let streamInterrupted = false;
            let streamErrMessage = null;
            const decoder = new TextDecoder();
            let buffered = '';

            // If the client goes away mid-stream we want the same accounting
            // path (treat as an incomplete stream). Express's `req` emits
            // 'close' for both clean ends and disconnects, so we additionally
            // gate on `!res.writableEnded` to distinguish.
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
                                if (t) { accText += t; sse({ delta: t }); }
                            } else if (eventName === 'message_delta' && evt?.usage) {
                                completionTokens = evt.usage.output_tokens || completionTokens;
                            } else if (eventName === 'message_start' && evt?.message?.usage) {
                                promptTokens = evt.message.usage.input_tokens || 0;
                            }
                        } else {
                            // OpenAI / OpenAI-compatible
                            const delta = evt?.choices?.[0]?.delta?.content || '';
                            if (delta) { accText += delta; sse({ delta }); }
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

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: llmHeaders,
            body: JSON.stringify(requestPayload)
        });

        const responseTime = Date.now() - startTime;

        if (!response.ok) {
            const errText = await response.text();
            (req.log || routesLlmLog).error('llm upstream error', { status: response.status, error: errText });
            dbAdapter.run('INSERT INTO llm_request_log (user_id, session_id, model, status, error_message, response_time_ms) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, session_id, model, 'error', errText.substring(0, 500), responseTime]);
            return res.status(response.status).json({ error: extractUpstreamError(errText) });
        }

        const rawData = await response.json();

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

const LLM_MODEL_REGISTRY = [
    { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7',          tier: 'flagship' },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',        tier: 'balanced' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',         tier: 'fast' },
    { id: 'claude-3-5-sonnet-20241022',label: 'Claude 3.5 Sonnet (legacy)', tier: 'legacy' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (legacy)',  tier: 'legacy' }
];

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
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

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
// TTS (Piper) ROUTES
// ============================================

const PIPER_DIR = path.join(__dirname, '../data', 'piper');
// piper1-gpl (the maintained successor to the archived rhasspy/piper) is
// distributed as a Python wheel; install-piper.sh creates a venv at
// $PIPER_DIR/venv/ and `pip install piper-tts` exposes the CLI at
// venv/bin/piper. Old standalone-binary installs (rhasspy/piper unpacked
// into $PIPER_DIR/piper/piper) and Homebrew installs (/opt/homebrew/bin/piper)
// continue to work via the PIPER_BIN env override.
const PIPER_BIN = process.env.PIPER_BIN || path.join(PIPER_DIR, 'venv', 'bin', 'piper');
const TTS_TEXT_LIMIT = 2000;

const readVoiceSidecar = (filename) => {
    const sidecar = path.join(PIPER_DIR, filename + '.json');
    if (!fs.existsSync(sidecar)) return null;
    try { return JSON.parse(fs.readFileSync(sidecar, 'utf8')); }
    catch { return null; }
};

// GET /api/tts/voices - list voices for the active TTS provider.
// Accepts ?provider=kokoro|piper to preview voices for an unsaved provider
// choice; otherwise falls back to the platform setting.
router.get('/tts/voices', authenticateToken, async (req, res) => {
    const queryProvider = typeof req.query.provider === 'string' ? req.query.provider : '';
    const ttsProvider = VOICE_TTS_PROVIDERS.includes(queryProvider)
        ? queryProvider
        : (await getPlatformSetting('tts_provider')) || 'piper';

    if (ttsProvider === 'kokoro') {
        try {
            const { loadKokoro, listKokoroVoices } = await import('../services/kokoroTts.js');
            await loadKokoro();
            return res.json({
                provider: 'kokoro',
                voices: listKokoroVoices(),
                piperInstalled: fs.existsSync(PIPER_BIN)
            });
        } catch (err) {
            (req.log || routesLlmLog).error('kokoro voice listing load failed', {
                error: err.message,
                code: err.code || null,
            });
            const disabled = err.code === 'KOKORO_DISABLED';
            return res.status(503).json({
                error: disabled
                    ? 'Kokoro is disabled until the next server restart (model load failed). Switch tts_provider in admin settings to recover.'
                    : 'Kokoro TTS failed to load',
                code: err.code || null,
            });
        }
    }

    if (ttsProvider === 'openai') {
        const { listOpenaiVoices } = await import('../services/openaiTts.js');
        return res.json({
            provider: 'openai',
            voices: listOpenaiVoices(),
            piperInstalled: fs.existsSync(PIPER_BIN)
        });
    }

    if (ttsProvider === 'google') {
        const { listGoogleVoices } = await import('../services/googleTts.js');
        return res.json({
            provider: 'google',
            voices: listGoogleVoices(),
            piperInstalled: fs.existsSync(PIPER_BIN)
        });
    }

    const piperInstalled = fs.existsSync(PIPER_BIN);
    if (!fs.existsSync(PIPER_DIR)) {
        return res.json({ provider: 'piper', voices: [], piperInstalled });
    }
    let files;
    try {
        files = fs.readdirSync(PIPER_DIR).filter(f => f.endsWith('.onnx'));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
    const voices = files.map(filename => {
        const sidecar = readVoiceSidecar(filename);
        const language = sidecar?.language?.code || sidecar?.language?.name_native || 'unknown';
        const sampleRate = sidecar?.audio?.sample_rate || 22050;
        const m = filename.match(/^([a-z]{2}_[A-Z]{2})-([^-]+)-/);
        const speaker = m?.[2] || filename.replace(/\.onnx$/, '');
        return { filename, displayName: speaker, language, sampleRate };
    });
    res.json({ provider: 'piper', voices, piperInstalled });
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

// Pre-flight voice validation. If the requested voice isn't in the active
// provider's catalogue (typically because the persona default was saved
// under a different provider), substitute the provider's hardcoded
// fallback so the conversation keeps going. Logs a warning so admins can
// see the misconfiguration in server logs.
async function resolveTtsVoice(provider, requestedVoice, gender) {
    let isValid = true;
    try {
        switch (provider) {
            case 'kokoro': {
                const { isKokoroVoice } = await import('../services/kokoroTts.js');
                isValid = await isKokoroVoice(requestedVoice);
                break;
            }
            case 'openai': {
                const { isOpenaiVoice } = await import('../services/openaiTts.js');
                isValid = isOpenaiVoice(requestedVoice);
                break;
            }
            case 'google': {
                const { isGoogleVoice } = await import('../services/googleTts.js');
                isValid = isGoogleVoice(requestedVoice);
                break;
            }
            case 'piper': {
                isValid = typeof requestedVoice === 'string'
                    && requestedVoice.endsWith('.onnx')
                    && fs.existsSync(path.join(PIPER_DIR, requestedVoice));
                break;
            }
            default:
                return requestedVoice;   // unknown provider; let synth handle it
        }
    } catch (err) {
        routesLlmLog.warn('tts voice catalogue check failed', { provider, error: err.message });
        return requestedVoice;
    }
    if (isValid) return requestedVoice;

    const { fallbackVoiceFor } = await import('../services/voiceFallbacks.js');
    const safeGender = ['male', 'female', 'child'].includes(gender) ? gender : 'female';
    const fallback = fallbackVoiceFor(provider, safeGender);
    if (fallback && fallback !== requestedVoice) {
        routesLlmLog.warn('tts voice fallback selected', { provider, requested_voice: requestedVoice, fallback_voice: fallback });
        return fallback;
    }
    return requestedVoice;   // no fallback available — synth will throw UNKNOWN_VOICE
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

// POST /api/tts - synthesize speech (returns audio/wav OR x-rohy-pcm-stream)
// Dispatches to:
//   - Piper  (local subprocess, ~25 MB voices, very fast, robotic)
//   - Kokoro (kokoro-js, ~330 MB local model, ~0.7× realtime, natural)
//   - OpenAI (cloud, lowest latency, native streaming PCM at 24 kHz)
// based on the `tts_provider` platform setting.
router.post('/tts', authenticateToken, async (req, res) => {
    const { text, voice: requestedVoice, rate, pitch, gender, provider: bodyProvider } = req.body || {};

    if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'text required' });
    }
    if (text.length > TTS_TEXT_LIMIT) {
        return res.status(400).json({ error: `text exceeds ${TTS_TEXT_LIMIT} character limit` });
    }
    if (typeof requestedVoice !== 'string' || !requestedVoice) {
        return res.status(400).json({ error: 'voice required' });
    }

    // Provider-override lets the settings UI preview a voice without having
    // to switch the platform's active TTS engine. Accept it from query
    // (?provider=…) for direct curl/test paths AND from the JSON body for
    // client SDKs (VoiceService.speak) — neither used to be wired, so all
    // four providers silently collapsed to the platform default. Only honour
    // an override that names a known provider.
    const queryProvider = typeof req.query.provider === 'string' && VOICE_TTS_PROVIDERS.includes(req.query.provider)
        ? req.query.provider
        : null;
    const bodyProviderOverride = typeof bodyProvider === 'string' && VOICE_TTS_PROVIDERS.includes(bodyProvider)
        ? bodyProvider
        : null;
    const providerOverride = queryProvider || bodyProviderOverride;
    const ttsProvider = providerOverride || (await getPlatformSetting('tts_provider')) || 'piper';

    try {
        await enforceBudget({
            tenantId: tenantId(req),
            userId: req.user?.id,
            provider: `tts-${ttsProvider}`,
            metric: 'characters',
            requested: text.length
        });
    } catch (err) {
        if (err instanceof BudgetExceededError) {
            return res.status(429).json(budgetExceededResponse(err));
        }
        throw err;
    }

    // Validate the requested voice against the active provider's catalogue
    // and substitute the provider's hardcoded fallback if it's unknown.
    // This is the safety net for "persona default was set under a different
    // provider" — without it, the patient just goes silent on switch.
    // The original UNKNOWN_VOICE error path inside each synth service still
    // exists, but we should never hit it from real chats now.
    const voice = await resolveTtsVoice(ttsProvider, requestedVoice, gender);

    // Record char usage up-front. We charge optimistically — even if the
    // synth fails partway through, we already paid for the API call
    // (Google/OpenAI bill on submission, not delivery). For local providers
    // this is a $0 row that still lets us see usage volume per user.
    recordTtsUsage(req.user?.id, ttsProvider, text.length);
    await recordUsage({
        tenantId: tenantId(req),
        userId: req.user?.id,
        provider: `tts-${ttsProvider}`,
        metric: 'characters',
        amount: text.length
    });

    if (ttsProvider === 'google') {
        const { synthesizeGoogleStream, synthesizeGoogleWav } = await import('../services/googleTts.js');
        const stream = req.query.stream === '1' || req.headers.accept?.includes('application/x-rohy-pcm-stream');
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
            try {
                await pipePcmStream(res, synthesizeGoogleStream({ text, voice, speed, pitch: pitchSemitones, apiKey }));
                return;
            } catch (err) {
                (req.log || routesLlmLog).error('google tts streaming synthesis failed', { error: err.message });
                if (!res.headersSent) {
                    const status = err.code === 'UNKNOWN_VOICE' ? 400
                        : err.code === 'NO_API_KEY' || err.code === 'BAD_API_KEY' ? 503
                        : 502;
                    return res.status(status).json({ error: err.message });
                }
                return res.end();
            }
        }
        try {
            const wav = await synthesizeGoogleWav({ text, voice, speed, pitch: pitchSemitones, apiKey });
            res.set('Content-Type', 'audio/wav');
            res.set('Cache-Control', 'no-store');
            res.set('Content-Length', String(wav.length));
            return res.end(wav);
        } catch (err) {
            (req.log || routesLlmLog).error('google tts synthesis failed', { error: err.message });
            const status = err.code === 'UNKNOWN_VOICE' ? 400
                : err.code === 'NO_API_KEY' || err.code === 'BAD_API_KEY' ? 503
                : 502;
            return res.status(status).json({ error: err.message });
        }
    }

    if (ttsProvider === 'openai') {
        const { synthesizeOpenaiStream, synthesizeOpenaiWav } = await import('../services/openaiTts.js');
        const stream = req.query.stream === '1' || req.headers.accept?.includes('application/x-rohy-pcm-stream');
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
            try {
                await pipePcmStream(res, synthesizeOpenaiStream({ text, voice, speed, apiKey }));
                return;
            } catch (err) {
                (req.log || routesLlmLog).error('openai tts streaming synthesis failed', { error: err.message });
                if (!res.headersSent) {
                    const status = err.code === 'UNKNOWN_VOICE' ? 400
                        : err.code === 'NO_API_KEY' || err.code === 'BAD_API_KEY' ? 503
                        : 502;
                    return res.status(status).json({ error: err.message });
                }
                return res.end();
            }
        }
        try {
            const wav = await synthesizeOpenaiWav({ text, voice, speed, apiKey });
            res.set('Content-Type', 'audio/wav');
            res.set('Cache-Control', 'no-store');
            res.set('Content-Length', String(wav.length));
            return res.end(wav);
        } catch (err) {
            (req.log || routesLlmLog).error('openai tts synthesis failed', { error: err.message });
            const status = err.code === 'UNKNOWN_VOICE' ? 400
                : err.code === 'NO_API_KEY' || err.code === 'BAD_API_KEY' ? 503
                : 502;
            return res.status(status).json({ error: err.message });
        }
    }

    if (ttsProvider === 'kokoro') {
        // Streaming path: emit a custom binary frame per Kokoro sentence so
        // the browser can start playing the first sentence while later ones
        // are still being synthesized.
        //
        // Wire format (little-endian throughout):
        //   header: 4 bytes — sampleRate (uint32)
        //   then repeating frames:
        //       4 bytes — pcm byte length (uint32, 0 = end-of-stream)
        //       N bytes — int16 PCM samples
        const stream = req.query.stream === '1' || req.headers.accept?.includes('application/x-rohy-pcm-stream');
        const speed = (rate !== undefined && rate !== null && Number.isFinite(parseFloat(rate)))
            ? Math.max(0.5, Math.min(1.5, parseFloat(rate)))
            : 1;

        if (stream) {
            // If the client disconnects mid-synthesis, breaking the for-await
            // tells kokoro-js's generator to clean up; we also stop scheduling
            // new sentences so we don't burn ~600 MB of inference for nobody.
            let clientGone = false;
            req.on('close', () => { if (!res.writableEnded) clientGone = true; });
            try {
                const { synthesizeKokoroStream } = await import('../services/kokoroTts.js');
                res.set('Content-Type', 'application/x-rohy-pcm-stream');
                res.set('Cache-Control', 'no-store');
                res.set('X-Accel-Buffering', 'no'); // bypass nginx buffering if proxied
                res.flushHeaders?.();
                if (res.socket) res.socket.setNoDelay(true);
                let headerSent = false;
                for await (const { sampleRate, pcm } of synthesizeKokoroStream({ text, voice, speed })) {
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
                (req.log || routesLlmLog).error('kokoro streaming synthesis failed', {
                    error: err.message,
                    code: err.code || null,
                });
                if (!res.headersSent && !clientGone) {
                    // UNKNOWN_VOICE — name the bad voice. KOKORO_DISABLED —
                    // tell admin to switch providers. Anything else gets a
                    // generic message; details stay in the log.
                    let status = 500, msg = 'Kokoro synthesis failed';
                    if (err.code === 'UNKNOWN_VOICE') { status = 400; msg = err.message; }
                    else if (err.code === 'KOKORO_DISABLED') {
                        status = 503;
                        msg = 'Kokoro is disabled until the next server restart. Switch tts_provider in admin settings to recover.';
                    }
                    return res.status(status).json({ error: msg, code: err.code || null });
                }
                if (!res.writableEnded) return res.end();
                return;
            }
        }

        // Non-streaming fallback: full WAV in one response.
        try {
            const { synthesizeKokoro } = await import('../services/kokoroTts.js');
            const wav = await synthesizeKokoro({ text, voice, speed });
            res.set('Content-Type', 'audio/wav');
            res.set('Cache-Control', 'no-store');
            res.set('Content-Length', String(wav.length));
            return res.end(wav);
        } catch (err) {
            (req.log || routesLlmLog).error('kokoro synthesis failed', {
                error: err.message,
                code: err.code || null,
            });
            let status = 500, msg = 'Kokoro synthesis failed';
            if (err.code === 'UNKNOWN_VOICE') { status = 400; msg = err.message; }
            else if (err.code === 'KOKORO_DISABLED') {
                status = 503;
                msg = 'Kokoro is disabled until the next server restart. Switch tts_provider in admin settings to recover.';
            }
            return res.status(status).json({ error: msg, code: err.code || null });
        }
    }

    // ---- Piper path ----
    if (voice.includes('/') || voice.includes('\\') || voice.includes('..') || !voice.endsWith('.onnx')) {
        return res.status(400).json({ error: 'invalid voice filename' });
    }

    const voiceFile = path.join(PIPER_DIR, voice);
    if (!voiceFile.startsWith(PIPER_DIR + path.sep) || !fs.existsSync(voiceFile)) {
        return res.status(400).json({ error: 'unknown voice' });
    }
    // Resolve symlinks: a planted symlink within PIPER_DIR pointing outside
    // would otherwise pass startsWith but feed Piper an arbitrary file path.
    // Realistic threat is low (needs write access to PIPER_DIR), but the
    // hardening is one syscall.
    try {
        const realVoiceFile = fs.realpathSync(voiceFile);
        const realPiperDir = fs.realpathSync(PIPER_DIR);
        if (!realVoiceFile.startsWith(realPiperDir + path.sep)) {
            return res.status(400).json({ error: 'unknown voice' });
        }
    } catch {
        return res.status(400).json({ error: 'unknown voice' });
    }
    if (!fs.existsSync(PIPER_BIN)) {
        return res.status(503).json({ error: 'Piper TTS binary not installed on server' });
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
        return res.status(500).json({ error: 'Failed to prepare TTS input' });
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
        return res.status(500).json({ error: 'Failed to start Piper' });
    }

    const chunks = [];
    let totalLen = 0;
    let stderrBuf = '';
    let aborted = false;
    let clientGone = false;

    const cleanup = () => {
        try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
    };

    // If the client disconnects before piper finishes, kill the subprocess so
    // we don't burn CPU and disk on a synthesis nobody's listening to. The
    // close handler will fire afterwards and run cleanup().
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
        if (!res.headersSent && !clientGone) res.status(500).json({ error: 'Piper process error' });
    });
    piper.on('close', (code) => {
        cleanup();
        if (clientGone || res.headersSent) return;
        if (aborted) return res.status(500).json({ error: 'TTS output exceeded size limit' });
        if (code !== 0) {
            routesLlmLog.warn('piper exited non-zero', { code, stderr: stderrBuf.slice(0, 500) });
            return res.status(500).json({ error: 'Piper synthesis failed' });
        }
        const pcm = Buffer.concat(chunks, totalLen);
        const header = buildWavHeader(pcm.length, sampleRate);
        res.set('Content-Type', 'audio/wav');
        res.set('Cache-Control', 'no-store');
        res.set('Content-Length', String(header.length + pcm.length));
        res.write(header);
        res.end(pcm);
    });
});

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
