import express from 'express';
import dbAdapter from '../dbAdapter.js';
import path from 'path';
import fs from 'fs';
import os from 'node:os';
import { fileURLToPath } from 'url';
import {
    authenticateToken,
    requireAdmin,
    requireReviewer,
    ROLE_RANKS,
    hasRoleAtLeast,
} from '../middleware/auth.js';


import { spawn } from 'node:child_process';
import { buildWavHeader } from '../services/wav.js';
import { EvenByteAligner } from '../lib/pcmAlign.js';
import { assembleSystemPrompt } from '../services/systemPromptAssembly.js';
import { resolveAffectNote } from '../shared/affectNote.js';
import { agentMaySeeRecord, renderEncounterRecord } from '../services/encounterRecord.js';
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
    listVoicesForProvider,
    readVoiceSidecar,
} from '../services/ttsProviders.js';


import { logger } from '../logger.js';
import {
    auditSuccess,
    isPlatformAdmin,
    loadSessionCaseConfig,
    requirePlatformAdmin,
    tenantId,
    verifySessionOwnership
} from './_helpers.js';
import { isRoomEnabled, specialistAnswers } from '../shared/caseRooms.js';
import {
    BudgetExceededError,
    LLM_MIN_PREFLIGHT_TOKENS,
    budgetExceededResponse,
    reserveBudget
} from '../usage-budget.js';
import { LLM_MODEL_REGISTRY, LLM_PROVIDERS, defaultModelFor, thinkingOffParams, thinkingIsOff } from '../shared/llmCatalogue.js';
import { SQL_NOW } from '../shared/time.js';
import { OUTBOUND_FETCH_OPTIONS, OutboundBlockedError, secureFetch, validateOutboundUrl } from '../lib/outboundUrl.js';
import {
    LlmQuotaRefusal,
    estimateTokens,
    llmInFlightGuard,
    llmRateLimiter,
    readLlmLimits,
    reserveLlmQuota,
    usageOrEstimate,
} from '../lib/llmLimits.js';
import {
    MAX_SSE_BUFFER_CHARS,
    MAX_STREAM_REPLY_CHARS,
    MAX_UPSTREAM_ERROR_BYTES,
    UpstreamBodyTooLargeError,
    createThinkStripper,
    noteAgentReply,
    publicUpstreamError,
    readJsonCapped,
    readTextCapped,
    shapeReply,
    upstreamReplyText,
} from '../lib/llmReply.js';
import { TTS_TIMEOUT_MS, ttsGate, ttsRateLimiter } from '../lib/ttsLimits.js';
import { GateFullError } from '../lib/concurrencyGate.js';
import {
    DEFAULT_MAX_OUTPUT_TOKENS_CAP,
    clampOutputTokens,
    clampTemperature,
    resolveSessionModel,
    validateChatMessages,
} from '../lib/llmGuards.js';
import { buildAgentPersonaPrompt, loadSessionAgentKnowledge, loadSessionCaseAgent } from '../services/agentPersona.js';
import { buildSessionPatientPrompt, isSessionEnded } from '../services/patientPersona.js';
import { buildSessionDiscussantPrompt, buildTeamAgentSituation } from '../services/agentSituation.js';
import { isKnownLanguage } from '../shared/languages.js';
import { isSpecialistType, normalizeDisclosure, roomKeysOf, specialtyFor } from '../shared/specialties.js';
import { normalizeKnowledge, serverBuildsSituation } from '../shared/agentKnowledge.js';
import {
    buildHandoverBrief,
    buildUnbriefedBlock,
    formatVitals,
    latestVitals,
    loadHandoverCaseData,
} from '../services/situationBrief.js';
import {
    buildReplyGuard,
    buildSpecialistBrief,
    countStudentTurns,
    createStreamReplyGuard,
    disclosureState,
    extractFindings,
    guardHasTerms,
    guardSpecialistReply,
    hasRoomActivity,
    loadSpecialistCaseData,
} from '../services/specialistBrief.js';

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

// The locale pipeline's persona (scripts/translate-locales.mjs). The task —
// strings, glossary, ICU rules — is in the user message; this only fixes the
// output contract.
const LOCALIZATION_SYSTEM_PROMPT = 'You are a precise software localization engine. You output only valid JSON.';

const getPlatformSetting = async (key) => {
    const row = await dbAdapter.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key]);
    return row?.setting_value ?? null;
};

// Rate limits: one definition, shared with the admin page — lib/llmLimits.js
// (F-24: this file displayed defaults the proxy never enforced).


// F-005: upstream LLM fetches were unbounded. /proxy/llm is intentionally
// excluded from the global routeTimeout middleware (streaming responses can
// legitimately run long), but the upstream call itself needs its own cap or
// a slow/malicious endpoint can pin a server connection forever. Connect /
// non-stream cap is 60s; the stream branch additionally enforces a 5-minute
// total upper bound and aborts the upstream when the client disconnects.
const LLM_UPSTREAM_CONNECT_MS = 60_000;
const LLM_STREAM_MAX_MS = 5 * 60_000;

// Agent-template values are educator-typed: bounded at use time so a stray
// 1e9 cannot reserve a day's budget in one request (L3 info).
const AGENT_MAX_OUTPUT_TOKENS_CAP = 16_384;

// OpenAI-compatible providers known to accept `stream_options`; a custom
// endpoint may be a server that rejects unknown fields, so it relies on the
// character estimate instead (lib/llmLimits.js usageOrEstimate).
const STREAM_USAGE_PROVIDERS = new Set(['openai', 'openrouter', 'groq', 'together', 'azure', 'ollama', 'lmstudio']);

// The specialist "after effort" gate counts the learner's turns. A learner can
// write `role: 'user'` rows straight into agent_conversations without ever
// asking the agent anything, so on its own that count opened the gate for
// free (L3-10 / L2-13). A stored turn now counts only up to the number of
// times this agent was actually asked through the proxy in this session —
// llm_request_log rows the server writes itself — plus the turn being asked
// now.
async function countAnsweredStudentTurns({ sessionId, tenant, agentType, caseAgentId }) {
    const [userTurns, asked] = await Promise.all([
        countStudentTurns({ sessionId, tenant, agentType }),
        dbAdapter.get(
            `SELECT COUNT(*) AS n FROM llm_request_log
              WHERE session_id = ? AND tenant_id = ? AND case_agent_id = ? AND status = 'success'`,
            [sessionId, tenant, caseAgentId]
        ).then((row) => Number(row?.n) || 0),
    ]);
    return Math.min(userTurns, asked + 1);
}

// A team agent's history is the stored conversation (AgentService loads it
// from GET .../conversation and sends it back). An assistant turn the client
// sends that is not a stored agent reply is a learner writing the agent's
// lines — a prompt-extraction aid (L3-10) — and is dropped. Learner turns
// pass: they are the learner's own words either way.
async function verifiedTeamHistory({ sessionId, tenant, agentType, messages, log }) {
    if (!messages.some((m) => m.role === 'assistant')) return messages;
    const rows = await dbAdapter.all(
        `SELECT content FROM agent_conversations
          WHERE session_id = ? AND tenant_id = ? AND agent_type = ? AND role = 'assistant'`,
        [sessionId, tenant, agentType]
    );
    const stored = new Map();
    rows.forEach((r) => { const k = String(r.content ?? '').trim(); stored.set(k, (stored.get(k) || 0) + 1); });
    let dropped = 0;
    const kept = messages.filter((m) => {
        if (m.role !== 'assistant') return true;
        const k = m.content.trim();
        const left = stored.get(k) || 0;
        if (left > 0) { stored.set(k, left - 1); return true; }
        dropped += 1;
        return false;
    });
    if (dropped > 0) log.warn('unverified assistant turns dropped from team-agent history', { session_id: sessionId, agent_type: agentType, dropped });
    return kept;
}

// GET /api/sessions/:id/patient-prompt — the patient's assembled system prompt
// for this session, exactly as the proxy builds it (minus the per-turn affect
// note). Reviewers and above: the DiagnosticBar's "show assembled prompt"
// inspector. The prompt is built server-side now, so the browser no longer
// holds a copy to show (Phase 1, 2026-10-04).
router.get('/sessions/:id/patient-prompt', authenticateToken, requireReviewer, async (req, res) => {
    try {
        const built = await buildSessionPatientPrompt({ sessionId: req.params.id, tenant: tenantId(req) });
        if (!built) return res.status(404).json({ error: 'Session not found' });
        const templateRow = await dbAdapter.get(`SELECT setting_value FROM platform_settings WHERE setting_key = 'llm_system_prompt_template'`);
        const caseLanguage = isKnownLanguage(built.patientCase.config?.case_language) ? built.patientCase.config.case_language : null;
        const prompt = assembleSystemPrompt({
            system_prompt: built.prompt,
            systemPromptTemplate: templateRow?.setting_value || '',
            caseLanguage,
        });
        res.json({
            prompt,
            chars: prompt.length,
            case_id: built.patientCase.caseId,
            template_id: built.template?.templateId ?? null,
            case_language: caseLanguage,
        });
    } catch (err) {
        req.log.error('patient prompt inspect failed', { error: err.message });
        res.status(500).json({ error: 'Could not assemble the patient prompt' });
    }
});

router.post('/proxy/llm', authenticateToken, llmRateLimiter, llmInFlightGuard, async (req, res) => {
    const { messages, system_prompt, session_id, agent_llm_config, session_mode, case_language, student_affect } = req.body;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    const startTime = Date.now();

    try {
        // 0. The client's conversation, checked before anything is read or
        // spent: {role: user|assistant, content: string} only, bounded in
        // count and size. The server builds the one system message below;
        // both provider paths (Anthropic, OpenAI-compatible) send only what
        // passed here (security audit 2026-10-24, LLM-4).
        const chat = validateChatMessages(messages);
        if (!chat.ok) {
            return res.status(400).json({ error: chat.error, code: 'invalid_messages' });
        }

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

        // Rate-limit refusals are logged before the agent is resolved (and the
        // body's agent ids are not trusted unresolved), so agent_type and
        // case_agent_id stay NULL on these rows. Awaited: the quota check
        // counts llm_request_log rows, so a refusal's row lands before the
        // next request is checked.
        const logRateLimit = (msg) => dbAdapter.run(
            `INSERT INTO llm_request_log (user_id, session_id, tenant_id, agent_type, case_agent_id, status, error_message, request_timestamp) VALUES (?, ?, ?, NULL, NULL, ?, ?, ${SQL_NOW})`,
            [userId, session_id ?? null, tenantId(req), 'rate_limited', msg]
        ).catch((err) => routesLlmLog.warn('llm rate-limit log failed', { error: err.message }));

        // 2-6. The daily user / tenant / platform token and cost limits, the
        // hourly request limit and the SEC-26 usage budget are checked AND
        // reserved together just before the provider is called (step 9b),
        // once the request's size is known: until 2026-10-26 they were read
        // here, against usage recorded only after earlier calls finished, so
        // parallel requests all passed (F-06).

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
        const platformThinking = await getPlatformLLMSetting('llm_thinking', '');
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
        // The agent's type as the SERVER knows it (from agent_templates, keyed
        // by the template id the client names). Gates the encounter record —
        // see services/encounterRecord.js.
        let agentType = null;
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
        // An agent config that names no agent is a client defect, not a
        // patient request: AgentService posting `{ case_agent_id: undefined }`
        // arrives as `{}`, and falling through would answer as a bare model
        // with no persona. No legitimate caller sends one — llmService and the
        // patient/discussant paths omit the field entirely when they have no
        // template id — so refuse rather than guess.
        if (agent_llm_config !== undefined && agent_llm_config !== null) {
            const namesAgent = typeof agent_llm_config === 'object'
                && !Array.isArray(agent_llm_config)
                && (agent_llm_config.case_agent_id != null || !!agent_llm_config.agent_template_id
                    || agent_llm_config.persona === 'patient' || agent_llm_config.persona === 'discussant'
                    || agent_llm_config.persona === 'localization');
            if (!namesAgent) {
                (req.log || routesLlmLog).warn('agent_llm_config names no agent', { user_id: userId, session_id: session_id ?? null });
                return res.status(400).json({
                    error: 'agent_llm_config must name an agent (case_agent_id, agent_template_id or persona)',
                    code: 'agent_not_named'
                });
            }
        }
        // A team agent is named by its CASE agent id: the server then owns the
        // persona prompt as well as the routing (services/agentPersona.js), and
        // the client's `system_prompt` is demoted to the situation block. The
        // bare template id remains for the two client-built types (patient,
        // discussant), which name a template with no case agent behind it.
        let caseAgent = null;
        let agentTemplateId = null;
        let agentTemplate = null;
        if (agent_llm_config?.case_agent_id != null) {
            if (!session_id) {
                return res.status(400).json({ error: 'case_agent_id requires session_id' });
            }
            caseAgent = await loadSessionCaseAgent({
                sessionId: session_id,
                caseAgentId: agent_llm_config.case_agent_id,
                tenant: tenantId(req),
            });
            // 404, not a silent fall-through to the patient path: a missing
            // agent would otherwise answer with no persona at all.
            if (!caseAgent) {
                return res.status(404).json({ error: 'Agent not found for this session' });
            }
            // An ended case has no team to talk to either: the same gate the
            // patient has (FI-0010 F09). The debrief discussant speaks after
            // the end by design and keeps its own unlock gate below.
            if (caseAgent.agentType !== 'discussant'
                && await isSessionEnded({ sessionId: session_id, tenant: tenantId(req) })) {
                (req.log || routesLlmLog).info('case agent refused after the session ended', { session_id, case_agent_id: caseAgent.caseAgentId });
                return res.status(409).json({ error: 'This session has ended', code: 'session_ended' });
            }
            agentTemplateId = caseAgent.agentTemplateId;
            agentTemplate = {
                agent_type: caseAgent.agentType,
                llm_provider: caseAgent.llm.provider,
                llm_model: caseAgent.llm.model,
                llm_api_key: caseAgent.llm.apiKey,
                llm_endpoint: caseAgent.llm.endpoint,
                llm_temperature: caseAgent.llm.temperature,
                llm_max_tokens: caseAgent.llm.maxTokens,
            };
        } else if (agent_llm_config?.agent_template_id) {
            // A bare template id is how the two client-built personas (patient,
            // discussant) name themselves, always inside a session. It used to
            // load ANY template in the tenant, so a caller could borrow another
            // agent's routing (provider, model, key) by naming its id. Now the
            // template must be one of those two types, or attached to the
            // session's own case (Phase 0 hardening, 2026-10-04).
            if (!session_id) {
                return res.status(400).json({ error: 'agent_template_id requires session_id', code: 'session_required' });
            }
            agentTemplateId = agent_llm_config.agent_template_id;
            agentTemplate = await dbAdapter.get(
                `SELECT t.agent_type, t.llm_provider, t.llm_model, t.llm_api_key, t.llm_endpoint, t.llm_temperature, t.llm_max_tokens
                   FROM agent_templates t
                  WHERE t.id = ? AND t.tenant_id = ? AND t.deleted_at IS NULL
                    AND (t.agent_type IN ('patient', 'discussant')
                         OR EXISTS (SELECT 1 FROM case_agents ca
                                      JOIN sessions s ON s.case_id = ca.case_id
                                     WHERE ca.agent_template_id = t.id AND s.id = ?))`,
                [agentTemplateId, tenantId(req), session_id]
            );
            if (!agentTemplate) {
                return res.status(404).json({ error: 'Agent template not available for this session', code: 'template_not_allowed' });
            }
        } else if (agent_llm_config?.persona === 'patient' || agent_llm_config?.persona === 'discussant') {
            if (!session_id) {
                return res.status(400).json({ error: `the ${agent_llm_config.persona} speaks only inside a session`, code: 'session_required' });
            }
        } else if (agent_llm_config?.persona === 'localization') {
            // The locale pipeline (scripts/translate-locales.mjs) translates UI
            // strings through the platform model, outside any session. Admins
            // only — they already hold the platform key — and the system
            // prompt is the server's, never the caller's.
            if (!hasRoleAtLeast(req.user, ROLE_RANKS.admin)) {
                return res.status(403).json({ error: 'The localization persona is for administrators', code: 'admin_required' });
            }
        } else if (!session_id) {
            // No agent named and no session: a free-form system prompt answered
            // on the platform's key, by anyone signed in. Every real caller (the
            // patient chat, the debrief) speaks inside a session (Phase 0).
            return res.status(400).json({ error: 'session_id is required', code: 'session_required' });
        } else {
            // A session but no persona: the last client-built prompt path. Every
            // caller now names who speaks — the patient and the discussant are
            // built here, team agents by case agent id — so a bare prompt is no
            // longer answered as anyone (Phase 2, 2026-10-04).
            return res.status(400).json({ error: 'name the persona (agent_llm_config)', code: 'persona_required' });
        }
        // The PATIENT is built server-side (services/patientPersona.js) from
        // the session's case snapshot, its resolved patient template and the
        // session's record: the client's system_prompt is ignored for it.
        // Recognised by the explicit marker, or — for clients that predate it —
        // by a named template whose stored type is 'patient'. The template the
        // server resolves wins over any id the client named (Phase 1, 2026-10-04).
        let serverPatient = null;
        let serverDiscussant = null;
        if (agent_llm_config?.persona === 'discussant' || (!caseAgent && agentTemplate?.agent_type === 'discussant')) {
            // The debrief discussant, built from the session's case, the
            // case's discussant (or the platform default) and its knowledge
            // scope (services/agentSituation.js). Same server-wins rule as the
            // patient for the template it speaks with.
            serverDiscussant = await buildSessionDiscussantPrompt({
                sessionId: session_id, tenant: tenantId(req), opening: req.body?.discussion_opening === true,
            });
            if (!serverDiscussant) return res.status(404).json({ error: 'Session not found' });
            if (!serverDiscussant.discussant) return res.status(404).json({ error: 'No discussant is configured for this case', code: 'no_discussant' });
            const resolvedId = serverDiscussant.discussant.templateId;
            if (resolvedId !== agentTemplateId) {
                agentTemplateId = resolvedId;
                agentTemplate = await dbAdapter.get(
                    `SELECT agent_type, llm_provider, llm_model, llm_api_key, llm_endpoint, llm_temperature, llm_max_tokens
                       FROM agent_templates WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
                    [resolvedId, tenantId(req)]
                );
            }
            agentType = 'discussant';
        } else if (agent_llm_config?.persona === 'patient' || (!caseAgent && agentTemplate?.agent_type === 'patient')) {
            // An ended case has no patient to talk to. The learner's client
            // locks the chat box, but nothing stopped a request that skipped
            // it from reaching the provider (FI-0010 review F09). Refused
            // before anything upstream is built; the debrief discussant keeps
            // its own gate below and speaks after the end.
            if (await isSessionEnded({ sessionId: session_id, tenant: tenantId(req) })) {
                (req.log || routesLlmLog).info('patient refused after the session ended', { session_id });
                return res.status(409).json({ error: 'This session has ended; the patient no longer answers', code: 'session_ended' });
            }
            serverPatient = await buildSessionPatientPrompt({ sessionId: session_id, tenant: tenantId(req) });
            if (!serverPatient) return res.status(404).json({ error: 'Session not found' });
            const resolvedId = serverPatient.template?.templateId ?? null;
            if (resolvedId !== agentTemplateId) {
                agentTemplateId = resolvedId;
                agentTemplate = resolvedId == null ? null : await dbAdapter.get(
                    `SELECT agent_type, llm_provider, llm_model, llm_api_key, llm_endpoint, llm_temperature, llm_max_tokens
                       FROM agent_templates WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
                    [resolvedId, tenantId(req)]
                );
            }
            agentType = 'patient';
        }
        const serverLocalization = agent_llm_config?.persona === 'localization';
        if (!caseAgent && !serverPatient && !serverDiscussant && !serverLocalization) {
            // A team template named by id alone (no case_agent_id) was the last
            // way to have the client's own system_prompt answered verbatim. A
            // team agent speaks from its case attachment, so name that.
            return res.status(400).json({ error: 'name a team agent by its case_agent_id', code: 'persona_required' });
        }
        // Every llm_request_log row after this point carries the tenant and
        // the agent the request spoke as (NULLs for a non-agent request).
        // Both agent values come from the server's own lookup above, never
        // from the request body.
        const logAttribution = () => [tenantId(req), agentType, caseAgent?.caseAgentId ?? null];
        if (agentTemplateId) {
            // Set even when the template overrides no LLM routing — the type
            // governs what the agent may be told, which is unrelated to which
            // model answers. Read from the DB, never from the request body.
            agentType = agentTemplate?.agent_type || null;
            if (agentTemplate && agentTemplate.llm_provider) {
                agentProvider = agentTemplate.llm_provider;
                agentModel = agentTemplate.llm_model;
                agentApiKey = agentTemplate.llm_api_key;
                agentEndpoint = agentTemplate.llm_endpoint;
                if (agentTemplate.llm_temperature !== null && Number.isFinite(agentTemplate.llm_temperature)) {
                    agentTemperature = clampTemperature(agentTemplate.llm_temperature).value;
                }
                if (agentTemplate.llm_max_tokens !== null && Number.isFinite(agentTemplate.llm_max_tokens)) {
                    // Bounded by the platform cap when that is higher, else
                    // by AGENT_MAX_OUTPUT_TOKENS_CAP — never unbounded.
                    agentMaxTokens = clampOutputTokens(agentTemplate.llm_max_tokens, {
                        platformMax: Math.max(parseInt(platformMaxTokens, 10) || 0, AGENT_MAX_OUTPUT_TOKENS_CAP),
                    }).value;
                }
                (req.log || routesLlmLog).info('using agent-template llm config', { agent_template_id: agentTemplateId, provider: agentProvider, temperature: agentTemperature ?? null, max_tokens: agentMaxTokens ?? null });
            }
            // Attribution: which agent this request spoke as. Every agent
            // request logs it, whether or not the template overrides routing.
            (req.log || routesLlmLog).info('llm request agent', {
                session_id: session_id ?? null,
                tenant_id: tenantId(req),
                agent_type: agentType,
                agent_template_id: agentTemplateId,
                case_agent_id: caseAgent?.caseAgentId ?? null,
                persona: 'server',
            });
        }

        // Rooms the case switched off (config.rooms, shared/caseRooms.js): the
        // debrief room off means there is no discussant to talk to, and a
        // specialist whose rooms are all off does not pick up the phone. The
        // learner's client hides both; this is the half it cannot skip.
        // Reviewers and above preview cases and pass.
        if (session_id != null && !hasRoleAtLeast(req.user, ROLE_RANKS.reviewer)
            && (agentType === 'discussant' || isSpecialistType(agentType))) {
            const roomsConfig = await loadSessionCaseConfig(session_id, tenantId(req));
            if (roomsConfig && agentType === 'discussant' && !isRoomEnabled(roomsConfig, 'consultant')) {
                return res.status(403).json({ error: 'This room is switched off for this case', code: 'room_disabled' });
            }
            if (roomsConfig && isSpecialistType(agentType) && !specialistAnswers(agentType, roomsConfig)) {
                return res.status(409).json({ error: 'No answer', code: 'no_answer' });
            }
        }

        // The debrief tutor holds the answer key (config.knowledge.answerKey),
        // so it speaks only once the case has ended — unless the educator set
        // `unlock_trigger: 'always'`. The client enforced this alone: a tutor
        // attached to the case showed as a chat tab, and its case_agent_id (or
        // `persona: 'discussant'`) reached it mid-case. Either route, same gate.
        if (session_id != null && agentType === 'discussant' && !hasRoleAtLeast(req.user, ROLE_RANKS.reviewer)) {
            const unlockTrigger = (caseAgent?.config ?? serverDiscussant?.discussant?.config ?? {}).unlock_trigger || 'after_case_ended';
            if (unlockTrigger !== 'always') {
                const ended = await dbAdapter.get('SELECT end_time FROM sessions WHERE id = ? AND tenant_id = ?', [session_id, tenantId(req)]);
                if (!ended?.end_time) {
                    (req.log || routesLlmLog).info('discussant refused before the case ended', { session_id, case_agent_id: caseAgent?.caseAgentId ?? null });
                    return res.status(403).json({ error: 'The debrief opens when the case ends', code: 'discussant_locked' });
                }
            }
        }

        // Priority: agent > session > platform.
        //
        // What a SESSION may say about routing (security audit 2026-10-24,
        // LLM-2): its baseUrl is honoured only when it is the platform's own
        // URL, or when the requester is educator+, the URL passes
        // validateOutboundUrl and the session ships its own apiKey. The
        // write paths (POST /sessions, PUT /users/preferences) enforce the
        // same rule, but rows written before the fix did not pass it, so it
        // is re-checked here. A session provider is meaningful only with
        // such a custom endpoint — on the platform URL it would just change
        // the payload shape — so it is honoured only alongside one.
        const stripSlash = (u) => String(u || '').trim().replace(/\/+$/, '');
        const platformBaseNormalised = stripSlash(platformBaseUrl);
        const requesterIsEducator = hasRoleAtLeast(req.user, ROLE_RANKS.educator);
        // A session apiKey counts only for educator+ (the write paths drop it
        // below that); a pre-fix student row's key is ignored like its URL.
        const sessionKey = (requesterIsEducator && typeof sessionLlmSettings?.apiKey === 'string' && sessionLlmSettings.apiKey.trim()) || null;
        let sessionCustomBase = null;      // validated, non-platform URL to use
        let sessionBaseIsPlatform = false;
        if (sessionLlmSettings?.baseUrl && String(sessionLlmSettings.baseUrl).trim()) {
            const sessionBase = stripSlash(sessionLlmSettings.baseUrl);
            if (sessionBase === platformBaseNormalised) {
                sessionBaseIsPlatform = true;
            } else {
                const checked = validateOutboundUrl(sessionBase);
                let refusal = null;
                if (!requesterIsEducator) refusal = 'requester is below educator';
                else if (!checked.ok) refusal = checked.reason;
                else if (!sessionKey) refusal = 'no session-supplied apiKey';   // F-002
                if (refusal) {
                    (req.log || routesLlmLog).warn('ignoring custom session baseUrl', {
                        user_id: userId, session_id: session_id ?? null, reason: refusal
                    });
                } else {
                    sessionCustomBase = checked.url;
                }
            }
        }
        const sessionProvider = sessionCustomBase && typeof sessionLlmSettings?.provider === 'string'
            ? sessionLlmSettings.provider.trim() || null
            : null;
        if (!sessionProvider && !agentProvider && sessionLlmSettings?.provider) {
            (req.log || routesLlmLog).info('ignoring session provider without a custom endpoint', { session_id: session_id ?? null });
        }
        let provider = agentProvider || sessionProvider || platformProvider;
        // A session model is honoured only when it is in the catalogue for the
        // provider, equals the platform model, or goes to the educator's own
        // endpoint (LLM-3); anything else falls back to the platform model.
        let baseModel = agentModel || platformModel;
        if (!agentModel && sessionLlmSettings?.model) {
            const picked = resolveSessionModel({
                requested: sessionLlmSettings.model, provider, platformModel, customEndpoint: Boolean(sessionCustomBase)
            });
            baseModel = picked.model;
            if (!picked.honoured) {
                (req.log || routesLlmLog).info('session model not in catalogue; using platform model', {
                    session_id: session_id ?? null, provider, requested: String(sessionLlmSettings.model).slice(0, 80)
                });
            }
        }

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
                apiKey = agentApiKey || platformApiKey;
            } else if (agentProvider === 'anthropic') {
                baseUrl = 'https://api.anthropic.com/v1';
                apiKey = agentApiKey || platformApiKey;
            } else if (agentProvider === 'openrouter') {
                baseUrl = 'https://openrouter.ai/api/v1';
                apiKey = agentApiKey || platformApiKey;
            } else if (agentProvider === 'custom' && agentEndpoint) {
                // An educator-typed URL. The platform key goes ONLY to the
                // platform's own URL (LLM-1): on any other host the agent
                // uses its own key or none. The URL is re-checked here —
                // templates saved before 2026-10-24 were never validated —
                // and a refused one falls back to the platform endpoint and
                // key, as a session URL without a key always has.
                const agentBase = stripSlash(agentEndpoint);
                if (agentBase === platformBaseNormalised) {
                    apiKey = agentApiKey || platformApiKey;
                } else {
                    const checked = validateOutboundUrl(agentBase);
                    if (checked.ok) {
                        baseUrl = checked.url;
                        apiKey = agentApiKey || '';
                    } else {
                        (req.log || routesLlmLog).warn('agent endpoint refused; using the platform endpoint', {
                            agent_template_id: agentTemplateId, reason: checked.reason
                        });
                    }
                }
            } else {
                apiKey = agentApiKey || platformApiKey;
            }
        } else if (sessionCustomBase) {
            // Educator+, validated URL, own key (checked above).
            baseUrl = sessionCustomBase;
            apiKey = sessionKey;
        } else if (sessionBaseIsPlatform) {
            // Same endpoint as platform — safe to reuse platform key.
            apiKey = sessionKey || platformApiKey;
        } else {
            apiKey = sessionKey || platformApiKey;
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
        const sessionMaxTokensRaw = sessionLlmSettings?.maxOutputTokens;
        const sessionTemperatureRaw = sessionLlmSettings?.temperature;
        const maxTokensFromSession = agentMaxTokens == null && Boolean(sessionMaxTokensRaw);
        const temperatureFromSession = agentTemperature == null
            && sessionTemperatureRaw !== undefined && sessionTemperatureRaw !== null && sessionTemperatureRaw !== '';
        const maxOutputTokensRaw = agentMaxTokens ?? (sessionMaxTokensRaw || platformMaxTokens);
        const temperatureRaw = agentTemperature ?? (temperatureFromSession ? sessionTemperatureRaw : platformTemperature);
        let maxOutputTokens = maxOutputTokensRaw !== null && maxOutputTokensRaw !== undefined && maxOutputTokensRaw !== ''
            ? parseInt(maxOutputTokensRaw, 10)
            : null;
        if (!Number.isFinite(maxOutputTokens)) maxOutputTokens = null;
        // A session value is user-controlled (LLM-3): bound it by the
        // platform's configured cap (DEFAULT_MAX_OUTPUT_TOKENS_CAP when none).
        if (maxTokensFromSession && maxOutputTokens !== null) {
            const bounded = clampOutputTokens(maxOutputTokens, { platformMax: platformMaxTokens });
            if (bounded.clamped) {
                (req.log || routesLlmLog).info('session maxOutputTokens clamped', {
                    session_id: session_id ?? null, requested: maxOutputTokens, cap: bounded.value
                });
            }
            maxOutputTokens = bounded.value;
        }
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
        if (temperatureFromSession && temperature !== null) {
            const bounded = clampTemperature(temperature);
            if (bounded.clamped) {
                (req.log || routesLlmLog).info('session temperature clamped', {
                    session_id: session_id ?? null, requested: temperature, value: bounded.value
                });
            }
            temperature = bounded.value;
        }

        // Debug logging
        (req.log || routesLlmLog).info('llm final settings resolved', { provider, model: model || null, base_url: baseUrl });
        if (sessionLlmSettings && Object.keys(sessionLlmSettings).length > 0) {
            (req.log || routesLlmLog).info('using session llm overrides', { session_id, override_keys: Object.keys(sessionLlmSettings).filter(k => sessionLlmSettings[k]) });
        }

        const budgetProvider = `llm-${provider || 'unknown'}`;

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
        // WHAT THIS AGENT KNOWS. Resolved once, before anything reads it, from
        // config.knowledge over the type default over the legacy
        // context_filter column (shared/agentKnowledge.js). It decides three
        // things below: whether the encounter record may be compiled in,
        // whether the client's situation is used or dropped, and which
        // server-built block replaces it.
        //
        // The template-id branch (the discussant) has no caseAgent, so its
        // config is fetched by type — otherwise an educator's per-case setting
        // would govern the case context the browser builds and be ignored by
        // the record gate here, and the tutor's knowledge would depend on
        // which side of the wire you asked.
        let agentKnowledge = null;
        if (agentType) {
            let knowledgeSource = null;
            if (caseAgent) {
                knowledgeSource = { config: caseAgent.config, contextFilter: caseAgent.contextFilter };
            } else if (session_id && agentMaySeeRecord(agentType)) {
                knowledgeSource = await loadSessionAgentKnowledge({
                    sessionId: session_id, agentType, tenant: tenantId(req),
                });
            }
            const resolved = normalizeKnowledge({
                knowledge: knowledgeSource?.config?.knowledge,
                agentType,
                contextFilter: knowledgeSource?.contextFilter,
            });
            if (resolved.errors.length > 0) {
                // Stored overrides are validated on write; a template config is
                // not. Invalid fields keep the default rather than costing the
                // learner a reply.
                (req.log || routesLlmLog).warn('agent knowledge config invalid; defaults applied', {
                    session_id: session_id ?? null, agent_type: agentType, errors: resolved.errors,
                });
            }
            agentKnowledge = resolved.value;
        }

        // The encounter record — what this learner has actually done. Read
        // from patient_record_events (which the client syncs as it goes) so
        // the debriefing tutor is not relying on the learner's own browser to
        // report their omissions. Allowlisted agent types only: a patient who
        // knows their own troponin is not a patient.
        //
        // `knowledge.record` narrows the allowlist further, per agent per
        // case. It has to: an agent set to know nothing about the patient, and
        // then handed the full list of everything ordered and given, is not
        // an agent that knows nothing. The allowlist says who MAY; the setting
        // says who DOES.
        let encounterRecordNote = '';
        if (session_id && agentMaySeeRecord(agentType) && agentKnowledge?.record === true) {
            const recordRows = await new Promise((resolve) => {
                dbAdapter.all(
                    `SELECT verb, time_elapsed, category, region, item, content, finding, value, unit, abnormal
                     FROM patient_record_events WHERE session_id = ?
                     ORDER BY time_elapsed ASC, id ASC`,
                    [session_id],
                    (err, rows) => {
                        // A failed read must not take the conversation down
                        // with it: the agent simply proceeds without the
                        // record, exactly as it did before this existed. Logged
                        // rather than swallowed — a silent [] here would look
                        // identical to "the learner did nothing", which is the
                        // one wrong answer this block can give.
                        if (err) (req.log || routesLlmLog).warn('encounter record read failed', { error: err.message, session_id });
                        resolve(err ? [] : (rows || []));
                    }
                );
            });
            encounterRecordNote = renderEncounterRecord(recordRows);
            if (encounterRecordNote) {
                (req.log || routesLlmLog).info('encounter record routed', {
                    session_id, agent_type: agentType, events: recordRows.length
                });
            }
        }
        // On-call specialists get a server-built CASE BRIEF from the session's
        // case document (services/specialistBrief.js): the findings when the
        // disclosure gate is open, never the diagnosis. `specialistGuard`
        // (buildReplyGuard) feeds the reply guard further down — on the
        // non-streamed reply AND sentence by sentence on a streamed one. The brief is passed to
        // buildAgentPersonaPrompt as its own argument, which places it after
        // the persona and its dos/donts and before any client text -- so the
        // educator's persona leads and the brief is the last word on what may
        // be disclosed.
        let specialistGuard = null;
        // The server-built block that goes in buildAgentPersonaPrompt's `brief`
        // slot: a specialist's CASE BRIEF, or the unbriefed / handover block
        // for a scoped team agent. One slot, because they are mutually
        // exclusive and all three are the last word on what the agent knows.
        let serverBrief = '';
        // The client situation for a specialist is DROPPED, not appended. Two
        // reasons, either of which alone is enough. The browser builds it from
        // the whole case (buildDiscussionCaseContext, 'full'), which carries
        // the diagnosis and every report's interpretation — appending it
        // handed the specialist the answer the brief exists to withhold. And
        // it carries the patient: demographics, history, vitals. A specialist
        // read one room's material and never met the patient, so there is no
        // case frame to replace it with; the brief is findings alone.
        let situation = system_prompt;
        if (caseAgent && isSpecialistType(caseAgent.agentType)) {
            if (typeof system_prompt === 'string' && system_prompt.trim()) {
                (req.log || routesLlmLog).info('specialist client situation dropped', {
                    session_id, agent_type: caseAgent.agentType, chars: system_prompt.length,
                });
            }
            situation = '';
            const specialty = specialtyFor(caseAgent.agentType);
            const disclosure = normalizeDisclosure(caseAgent.config?.disclosure);
            if (disclosure.errors.length > 0) {
                // Stored overrides are validated on write; a template config is
                // not. Invalid fields keep the registry default.
                (req.log || routesLlmLog).warn('specialist disclosure config invalid; defaults applied', {
                    case_agent_id: caseAgent.caseAgentId, errors: disclosure.errors
                });
            }
            // `requireRoomActivity` is only read by the after_effort gate, so
            // the learning_events probe is skipped unless the config asks for
            // it — one query saved on every on_request/never turn.
            const needsRoomProbe = disclosure.value.findings === 'after_effort'
                && disclosure.value.requireRoomActivity === true;
            const [caseData, studentTurns, roomActive] = await Promise.all([
                loadSpecialistCaseData({ sessionId: session_id, tenant: tenantId(req) }),
                countAnsweredStudentTurns({ sessionId: session_id, tenant: tenantId(req), agentType: caseAgent.agentType, caseAgentId: caseAgent.caseAgentId }),
                needsRoomProbe
                    ? hasRoomActivity({ sessionId: session_id, tenant: tenantId(req), roomKeys: roomKeysOf(specialty) })
                    : Promise.resolve(false),
            ]);
            const config = caseData?.config || {};
            const findings = extractFindings(specialty.domain, config);
            const state = disclosureState({ disclosure: disclosure.value, studentTurns, roomActive });
            serverBrief = buildSpecialistBrief({ specialty, findings, disclosureState: state });
            // The guard's language (stemming, fallback question) is the
            // case's own, read here from the snapshot; the body's
            // case_language only stands in for a legacy case without one.
            specialistGuard = buildReplyGuard(specialty.domain, config, { fallbackLanguage: case_language });
            (req.log || routesLlmLog).info('specialist brief routed', {
                session_id,
                agent_type: caseAgent.agentType,
                findings_count: findings.length,
                findings_allowed: state.findingsAllowed,
                disclosure_reason: state.reason,
                student_turns: studentTurns,
                room_active: needsRoomProbe ? roomActive : null,
                answer_terms: specialistGuard.phrases.length,
                answer_stems: specialistGuard.stems.length,
                answer_class_terms: specialistGuard.classRoots.length + specialistGuard.classWords.length,
                guard_language: specialistGuard.language,
            });
        } else if (caseAgent && agentKnowledge && !serverBuildsSituation(agentKnowledge.scope)) {
            // `summary`, `history`, `chart`: the situation is built here from
            // the session's case, vitals and team log (services/agentSituation.js)
            // instead of taken from the browser, which had to hold the whole
            // case to build it (Phase 2, 2026-10-04).
            if (typeof system_prompt === 'string' && system_prompt.trim()) {
                (req.log || routesLlmLog).info('client situation dropped for team agent', {
                    session_id, agent_type: caseAgent.agentType, knowledge_scope: agentKnowledge.scope, chars: system_prompt.length,
                });
            }
            situation = await buildTeamAgentSituation({
                sessionId: session_id, tenant: tenantId(req), agentType: caseAgent.agentType, knowledge: agentKnowledge,
            });
        } else if (caseAgent && serverBuildsSituation(agentKnowledge?.scope)) {
            // `none` and `handover`: the same move the specialist branch makes
            // above, for the same reason. The browser assembles its situation
            // from the whole case, so appending it would hand a colleague who
            // is supposed to know nothing the entire chart — and a learner who
            // tampered with their own client could do exactly that on purpose.
            // Drop it, and build the block here from rows the server read.
            if (typeof system_prompt === 'string' && system_prompt.trim()) {
                (req.log || routesLlmLog).info('client situation dropped for scoped agent', {
                    session_id,
                    agent_type: caseAgent.agentType,
                    knowledge_scope: agentKnowledge.scope,
                    chars: system_prompt.length,
                });
            }
            situation = '';
            if (agentKnowledge.scope === 'handover') {
                const [caseData, vitalsRow] = await Promise.all([
                    loadHandoverCaseData({ sessionId: session_id, tenant: tenantId(req) }),
                    latestVitals({ sessionId: session_id, tenant: tenantId(req) }),
                ]);
                serverBrief = buildHandoverBrief({
                    patient: caseData?.patient,
                    reason: caseData?.reason,
                    vitals: formatVitals(vitalsRow),
                });
            } else {
                serverBrief = buildUnbriefedBlock();
            }
            (req.log || routesLlmLog).info('scoped situation brief routed', {
                session_id,
                agent_type: caseAgent.agentType,
                knowledge_scope: agentKnowledge.scope,
                record_allowed: agentKnowledge.record,
                brief_chars: serverBrief.length,
            });
        }
        // A server-resolved case agent speaks from its authored prompt; what
        // the client sent is only the situation it reported (none, for a
        // specialist — see above).
        if ((serverPatient || serverDiscussant || serverLocalization) && typeof system_prompt === 'string' && system_prompt.trim()) {
            (req.log || routesLlmLog).info('client persona prompt dropped', { session_id, persona: agentType, chars: system_prompt.length });
        }
        const casePrompt = serverPatient
            ? serverPatient.prompt
            : serverDiscussant
                ? serverDiscussant.prompt
                : serverLocalization
                    ? LOCALIZATION_SYSTEM_PROMPT
                    : buildAgentPersonaPrompt(caseAgent, situation, serverBrief);
        // The patient speaks the CASE's language (pinned at creation); the
        // body's case_language is used only for a legacy case without one.
        const promptLanguage = serverPatient && isKnownLanguage(serverPatient.patientCase.config?.case_language)
            ? serverPatient.patientCase.config.case_language
            : case_language;
        // The localization persona is not a clinical voice: no platform persona
        // template, no case-language lead, no encounter record, no affect.
        let fullSystemPrompt = serverLocalization
            ? casePrompt
            : assembleSystemPrompt({ system_prompt: casePrompt, systemPromptTemplate, caseLanguage: promptLanguage, encounterRecordNote, studentAffectNote });

        // 9a. The conversation sent upstream. A team agent's assistant turns
        // must be ones it actually said (verifiedTeamHistory); the patient's
        // and the discussant's history is still the client's (residual, see
        // done-C notes: their transcript is client-written end to end).
        const conversationMessages = caseAgent
            ? await verifiedTeamHistory({
                sessionId: session_id, tenant: tenantId(req), agentType: caseAgent.agentType,
                messages: chat.messages, log: req.log || routesLlmLog,
            })
            : chat.messages;

        // 9. Build request based on provider type
        let llmHeaders = { 'Content-Type': 'application/json' };
        let requestPayload = {};
        let endpoint = '';

        if (provider === 'anthropic') {
            // Anthropic Claude API format
            llmHeaders['x-api-key'] = apiKey;
            llmHeaders['anthropic-version'] = '2023-06-01';

            // Only the validated conversation (step 0); the system prompt goes
            // in Anthropic's separate `system` field.
            requestPayload = {
                model: model || defaultModelFor('anthropic'),
                max_tokens: maxOutputTokens || 1024,
                messages: conversationMessages
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

            // The server-built system prompt is the only system message; the
            // rest is the validated conversation (step 0).
            const conversation = [];
            if (fullSystemPrompt) {
                conversation.push({ role: 'system', content: fullSystemPrompt });
            }
            conversation.push(...conversationMessages);

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
            // Thinking off (the default): a reasoning model answers at once. Its
            // thinking is never shown or spoken anyway (only delta.content is
            // read), but it delays the first word by seconds — the whole voice
            // turn waits.
            const noThinking = thinkingIsOff(platformThinking) ? thinkingOffParams(provider) : null;
            if (noThinking) Object.assign(requestPayload, noThinking);
            endpoint = `${baseUrl}/chat/completions`;
        }

        // 9b. Limits, checked and RESERVED in one step (F-06). The estimate is
        // the input this request sends (system prompt + conversation, ~4
        // characters a token) plus the output it may produce (the resolved
        // max tokens; the cap when none is set; never below
        // LLM_MIN_PREFLIGHT_TOKENS, so a tiny client value cannot slip under
        // a budget). The reservation is settled to the real usage — or given
        // back — when the call ends (the finally below).
        const inputChars = (fullSystemPrompt || '').length
            + conversationMessages.reduce((n, m) => n + m.content.length, 0);
        const estimatedInputTokens = estimateTokens(inputChars);
        const estimatedOutputTokens = Math.max(
            LLM_MIN_PREFLIGHT_TOKENS,
            provider === 'anthropic' ? (maxOutputTokens || 1024) : (maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS_CAP)
        );
        const pricing = (await dbAdapter.get(
            'SELECT input_cost_per_1k, output_cost_per_1k FROM llm_model_pricing WHERE provider = ? AND (model = ? OR model = ?) ORDER BY (model = ?) DESC LIMIT 1',
            [provider, model, 'default', model]
        )) || { input_cost_per_1k: 0, output_cost_per_1k: 0 };
        const costOf = (inTokens, outTokens) => (inTokens / 1000) * (Number(pricing.input_cost_per_1k) || 0)
            + (outTokens / 1000) * (Number(pricing.output_cost_per_1k) || 0);
        let quotaReservation = null;
        let budgetReservation = null;
        try {
            quotaReservation = await reserveLlmQuota({
                tenantId: tenantId(req),
                userId,
                date: today,
                limits: await readLlmLimits(getPlatformSetting),
                estimatedTokens: estimatedInputTokens + estimatedOutputTokens,
                estimatedCost: costOf(estimatedInputTokens, estimatedOutputTokens),
            });
            budgetReservation = await reserveBudget({
                tenantId: tenantId(req),
                userId,
                provider: budgetProvider,
                metric: 'tokens',
                amount: estimatedInputTokens + estimatedOutputTokens,
                minRequested: LLM_MIN_PREFLIGHT_TOKENS,
            });
        } catch (limitErr) {
            quotaReservation?.release();
            if (limitErr instanceof LlmQuotaRefusal) {
                await logRateLimit(limitErr.logMessage);
                return res.status(429).json(limitErr.body);
            }
            throw limitErr;
        }
        // Set by the paths that reach the provider, AFTER llm_usage and
        // llm_request_log are written; null gives the reservation back.
        let accountedTokens = null;
        try {

        // 10. Make LLM request
        (req.log || routesLlmLog).info('llm upstream request sending', { user_id: userId, provider, model: model || null, endpoint });

        // A request to anything but the platform's own URL never follows a
        // redirect (the redirect target was not validated — LLM-2d); a 3xx
        // from such an endpoint is an upstream error, answered as 502. It also
        // goes through secureFetch, which re-checks the host and refuses a
        // name that RESOLVES to a private or metadata address at connect time
        // (F-01). The platform URL is the platform admin's own setting and is
        // often a LAN model server, so it keeps plain fetch.
        const upstreamIsPlatform = stripSlash(baseUrl) === platformBaseNormalised;
        const upstreamFetch = upstreamIsPlatform ? fetch : secureFetch;
        const upstreamFetchOptions = upstreamIsPlatform ? {} : OUTBOUND_FETCH_OPTIONS;
        const upstreamRedirected = (upstream) => !upstreamIsPlatform && upstream.status >= 300 && upstream.status < 400;
        const logUpstreamFailure = (message, responseTime) => dbAdapter.run(
            `INSERT INTO llm_request_log (user_id, session_id, tenant_id, agent_type, case_agent_id, model, status, error_message, response_time_ms, request_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${SQL_NOW})`,
            [userId, session_id, ...logAttribution(), model, 'error', String(message).substring(0, 500), responseTime]
        ).catch((err) => routesLlmLog.warn('llm request log failed', { error: err.message }));
        const refuseRedirect = async (upstream, responseTime) => {
            let target = null;
            try { const loc = new URL(upstream.headers.get('location') || '', endpoint); target = `${loc.origin}${loc.pathname}`; } catch { /* unparseable Location */ }
            (req.log || routesLlmLog).error('llm upstream redirected; not followed', { status: upstream.status, target });
            try { await upstream.body?.cancel(); } catch { /* already closed */ }
            await logUpstreamFailure(`upstream redirected (${upstream.status})`, responseTime);
            return res.status(502).json({ error: 'The LLM endpoint redirected the request; redirects are not followed', code: 'upstream_redirect' });
        };
        // An upstream 4xx/5xx: the provider's text is logged, never shown to a
        // learner (it can echo the request, a key prefix, the model id). An
        // administrator still gets the provider's short message (L3 info).
        const answerUpstreamError = async (upstream, responseTime, label) => {
            const errText = await readTextCapped(upstream, MAX_UPSTREAM_ERROR_BYTES, { truncate: true });
            (req.log || routesLlmLog).error(label, { status: upstream.status, error: errText.slice(0, 500) });
            await logUpstreamFailure(errText, responseTime);
            return res.status(upstream.status).json({
                error: publicUpstreamError(upstream.status, errText, { detailed: hasRoleAtLeast(req.user, ROLE_RANKS.admin) }),
                code: 'upstream_error',
            });
        };
        // llm_usage is written with the tenant (F-18 / L3-08: it defaulted to
        // tenant 1) and awaited, so the quota reservation is released only
        // once the real spend is on disk.
        const writeUsageRows = async ({ promptTokens, completionTokens, totalTokens, cost, status, errorMessage, responseTime }) => {
            await dbAdapter.run(`INSERT INTO llm_usage (user_id, tenant_id, date, prompt_tokens, completion_tokens, total_tokens, estimated_cost, model, request_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, date) DO UPDATE SET
                prompt_tokens = llm_usage.prompt_tokens + excluded.prompt_tokens,
                completion_tokens = llm_usage.completion_tokens + excluded.completion_tokens,
                total_tokens = llm_usage.total_tokens + excluded.total_tokens,
                estimated_cost = llm_usage.estimated_cost + excluded.estimated_cost,
                request_count = llm_usage.request_count + 1,
                updated_at = CURRENT_TIMESTAMP`,
                [userId, tenantId(req), today, promptTokens, completionTokens, totalTokens, cost, model]);
            await dbAdapter.run(`INSERT INTO llm_request_log (user_id, session_id, tenant_id, agent_type, case_agent_id, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost, status, error_message, response_time_ms, request_timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${SQL_NOW})`,
                [userId, session_id, ...logAttribution(), model, promptTokens, completionTokens, totalTokens, cost, status, errorMessage ?? null, responseTime]);
        };
        // The agent's own words, remembered so POST .../conversation can tell
        // them from a learner-written assistant turn (L3-10).
        const rememberReply = (text) => {
            if (caseAgent) noteAgentReply({ tenantId: tenantId(req), sessionId: session_id, agentType: caseAgent.agentType }, text);
        };

        // Streaming branch — emit SSE deltas from the upstream provider.
        // Client requests it via Accept: text/event-stream OR ?stream=1.
        const wantStream = req.query.stream === '1'
            || req.body?.stream === true
            || (req.headers.accept || '').includes('text/event-stream');
        if (wantStream) {
            // A specialist's streamed reply is guarded sentence by sentence:
            // deltas are held until a sentence is complete, and a sentence
            // naming the answer is never written (createStreamReplyGuard).
            // Until 2026-10-14 this branch skipped the guard and only logged
            // it, so any client asking for a stream got the unguarded reply.
            // Think blocks are removed BEFORE the guard sees the text (F-22).
            const streamGuard = guardHasTerms(specialistGuard) ? createStreamReplyGuard(specialistGuard) : null;
            const thinkStripper = createThinkStripper();
            const streamPayload = { ...requestPayload, stream: true };
            // Ask for the usage block on the last chunk, so a streamed reply is
            // metered (L3-02: it was recorded as 0 tokens).
            if (provider !== 'anthropic' && STREAM_USAGE_PROVIDERS.has(provider)) {
                streamPayload.stream_options = { include_usage: true };
            }
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
                upstream = await upstreamFetch(endpoint, {
                    ...upstreamFetchOptions,
                    method: 'POST',
                    headers: llmHeaders,
                    body: JSON.stringify(streamPayload),
                    signal: streamController.signal
                });
            } finally {
                clearTimeout(connectTimer);
            }
            if (upstreamRedirected(upstream)) {
                clearTimeout(overallTimer);
                return await refuseRedirect(upstream, Date.now() - startTime);
            }
            if (!upstream.ok) {
                clearTimeout(overallTimer);
                return await answerUpstreamError(upstream, Date.now() - startTime, 'llm stream upstream error');
            }

            res.set('Content-Type', 'text/event-stream');
            res.set('Cache-Control', 'no-store');
            res.set('X-Accel-Buffering', 'no');
            res.flushHeaders?.();
            if (res.socket) res.socket.setNoDelay(true);

            const sse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
            // Every text delta goes through here: think blocks out first, then
            // the guard (when there is one) sees all of it before any of it is
            // written. `replyText` is exactly what the learner received.
            let replyText = '';
            let upstreamChars = 0;
            const emit = (out) => {
                if (!out) return;
                replyText += out;
                sse({ delta: out });
            };
            const writeDelta = (text) => {
                upstreamChars += text.length;
                const visible = thinkStripper.push(text);
                if (!visible) return;
                emit(streamGuard ? streamGuard.push(visible) : visible);
            };

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
                streamLoop:
                for await (const chunk of upstream.body) {
                    buffered += decoder.decode(chunk, { stream: true });
                    // One SSE event may not outgrow MAX_SSE_BUFFER_CHARS, and a
                    // whole reply may not outgrow MAX_STREAM_REPLY_CHARS
                    // (L3-07: both grew without bound).
                    if (buffered.length > MAX_SSE_BUFFER_CHARS || upstreamChars > MAX_STREAM_REPLY_CHARS) {
                        streamInterrupted = true;
                        streamErrMessage = 'upstream_stream_too_large';
                        streamController.abort(new Error('upstream_stream_too_large'));
                        break;
                    }
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
                        if (dataStr === '[DONE]') break streamLoop;
                        let evt;
                        try { evt = JSON.parse(dataStr); } catch { continue; }

                        // Anthropic format
                        if (provider === 'anthropic') {
                            if (eventName === 'content_block_delta' && evt?.delta?.type === 'text_delta') {
                                const t = evt.delta.text || '';
                                if (t) writeDelta(t);
                            } else if (eventName === 'message_delta' && evt?.usage) {
                                completionTokens = evt.usage.output_tokens || completionTokens;
                            } else if (eventName === 'message_start' && evt?.message?.usage) {
                                promptTokens = evt.message.usage.input_tokens || 0;
                            }
                        } else {
                            // OpenAI / OpenAI-compatible. Only delta.content
                            // is read: reasoning fields never reach the client.
                            const delta = evt?.choices?.[0]?.delta?.content;
                            if (typeof delta === 'string' && delta) writeDelta(delta);
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
                streamErrMessage = streamErrMessage || streamErr?.message?.slice(0, 500) || 'stream_error';
            } finally {
                clearTimeout(overallTimer);
            }
            const strippedTail = thinkStripper.end();
            if (!res.writableEnded) {
                if (strippedTail) emit(streamGuard ? streamGuard.push(strippedTail) : strippedTail);
                if (streamGuard) {
                    // The last, unterminated sentence — or, when every sentence
                    // was dropped, the fallback question in the case language.
                    emit(streamGuard.end());
                }
            }
            if (streamGuard?.removed > 0) {
                (req.log || routesLlmLog).warn('specialist reply guarded', {
                    session_id, agent_type: agentType, removed_sentences: streamGuard.removed, streamed: true
                });
            }
            if (!streamInterrupted) rememberReply(replyText);

            // Final usage + log. A provider that sent no usage is metered from
            // the characters in and out, never as 0 (L3-02).
            const metered = usageOrEstimate({ promptTokens, completionTokens, inputChars, outputChars: upstreamChars });
            if (metered.estimated) {
                (req.log || routesLlmLog).info('llm stream usage estimated from characters', { provider, prompt_tokens: metered.promptTokens, completion_tokens: metered.completionTokens });
            }
            // Schema's status CHECK whitelists ('success','error','rate_limited').
            // Stream interrupts (upstream error mid-stream OR client disconnect)
            // get logged as 'error' with error_message disambiguating the cause.
            await writeUsageRows({
                ...metered,
                cost: costOf(metered.promptTokens, metered.completionTokens),
                status: streamInterrupted ? 'error' : 'success',
                errorMessage: streamErrMessage,
                responseTime: Date.now() - startTime,
            });
            accountedTokens = metered.totalTokens;

            if (!res.writableEnded) {
                sse({ done: true, usage: { prompt_tokens: metered.promptTokens, completion_tokens: metered.completionTokens, total_tokens: metered.totalTokens } });
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
            response = await upstreamFetch(endpoint, {
                ...upstreamFetchOptions,
                method: 'POST',
                headers: llmHeaders,
                body: JSON.stringify(requestPayload),
                signal: nonStreamController.signal
            });

            const responseTime = Date.now() - startTime;

            if (upstreamRedirected(response)) {
                return await refuseRedirect(response, responseTime);
            }
            if (!response.ok) {
                return await answerUpstreamError(response, responseTime, 'llm upstream error');
            }

            // At most MAX_UPSTREAM_JSON_BYTES (L3-07).
            rawData = await readJsonCapped(response);
        } finally {
            clearTimeout(nonStreamTimer);
        }

        const responseTime = Date.now() - startTime;

        // 11. Rebuild the reply from the fields the client uses, nothing else
        // (F-22): no reasoning_content / reasoning, no provider extras, think
        // blocks stripped from the content.
        const upstreamText = upstreamReplyText(provider, rawData);
        const rawUsage = provider === 'anthropic'
            ? { prompt_tokens: rawData?.usage?.input_tokens, completion_tokens: rawData?.usage?.output_tokens }
            : rawData?.usage;
        const metered = usageOrEstimate({
            promptTokens: rawUsage?.prompt_tokens,
            completionTokens: rawUsage?.completion_tokens,
            inputChars,
            outputChars: upstreamText.length,
        });
        const data = shapeReply({
            content: upstreamText,
            finishReason: provider === 'anthropic' ? (rawData?.stop_reason || 'stop') : rawData?.choices?.[0]?.finish_reason,
            usage: { prompt_tokens: metered.promptTokens, completion_tokens: metered.completionTokens, total_tokens: metered.totalTokens },
            model: typeof rawData?.model === 'string' ? rawData.model : (model || null),
        });

        // 12-14. Cost, daily usage (upsert) and the request log.
        const estimatedCost = costOf(metered.promptTokens, metered.completionTokens);
        await writeUsageRows({ ...metered, cost: estimatedCost, status: 'success', responseTime });
        accountedTokens = metered.totalTokens;

        (req.log || routesLlmLog).info('llm usage recorded', { user_id: userId, total_tokens: metered.totalTokens, estimated: metered.estimated, estimated_cost: Number(estimatedCost.toFixed(4)), response_time_ms: responseTime });

        // 15. Guard a specialist's reply: drop any sentence naming the answer
        // (services/specialistBrief.js guardSpecialistReply), on the FINAL
        // content — after think blocks are gone, so nothing hidden in one
        // survives in the text the guard never saw.
        if (guardHasTerms(specialistGuard)) {
            const guarded = guardSpecialistReply(data.choices[0].message.content, specialistGuard);
            data.choices[0].message.content = guarded.text;
            if (guarded.removed > 0) {
                (req.log || routesLlmLog).warn('specialist reply guarded', {
                    session_id, agent_type: agentType, removed_sentences: guarded.removed
                });
            }
        }
        rememberReply(data.choices[0].message.content);

        // 16. Return response
        res.json(data);
        } finally {
            // Settle the reservations to what was recorded, or give them back
            // when the provider was never reached (accountedTokens null).
            try {
                if (accountedTokens == null) await budgetReservation?.release();
                else await budgetReservation?.settle(accountedTokens);
            } catch (settleErr) {
                (req.log || routesLlmLog).warn('llm budget settle failed', { error: settleErr.message });
            }
            quotaReservation?.release();
        }
    } catch (err) {
        if (err instanceof BudgetExceededError) {
            return res.status(429).json(budgetExceededResponse(err));
        }
        (req.log || routesLlmLog).error('llm proxy failed', { error: err.message, cause: err.cause?.code || null });
        if (res.headersSent) {
            if (!res.writableEnded) res.end();
            return;
        }
        // An educator endpoint whose host is, or resolves to, a refused
        // address (secureFetch, F-01).
        if (err?.cause instanceof OutboundBlockedError) {
            return res.status(502).json({ error: 'The LLM endpoint is not an allowed destination', code: 'upstream_blocked' });
        }
        if (err instanceof UpstreamBodyTooLargeError) {
            return res.status(502).json({ error: 'The LLM endpoint sent a reply that is too large', code: 'upstream_too_large' });
        }
        // The provider could not be reached at all (DNS, refused, reset):
        // undici's fetch rejects with a TypeError "fetch failed". That is an
        // upstream failure, not this server's — 502, as sendSynthesisError
        // answers for TTS. Found by the API fuzzer (scripts/fuzz-api.sh),
        // which runs with no provider configured.
        if (err instanceof TypeError && err.message === 'fetch failed') {
            return res.status(502).json({ error: 'LLM provider unreachable', details: err.cause?.code || err.message });
        }
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
        // ?scope=all: every user of the install for a platform administrator,
        // every user of their own tenant for a tenant administrator (L3-08).
        const isAdmin = hasRoleAtLeast(req.user, ROLE_RANKS.admin);
        const scopeAll = isAdmin && req.query.scope === 'all';
        const installWide = scopeAll && isPlatformAdmin(req.user);
        const userFilter = scopeAll ? (installWide ? '' : 'AND tenant_id = ?') : 'AND user_id = ?';
        const userParam = scopeAll ? (installWide ? [] : [tenantId(req)]) : [req.user.id];

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
            tenant_only: scopeAll && !installWide,
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

// GET /api/tts/voices - voice catalogues (Voice 2.0, docs/design/voice-2.0-plan.md §5.6).
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
                WHERE tenant_id = ? AND deleted_at IS NULL AND config LIKE '%case_voice%'
                UNION ALL
                SELECT 'case' AS kind, id, name, config FROM cases
                WHERE tenant_id = ? AND deleted_at IS NULL AND config LIKE '%case_voice%'
            `, [tenantId(req), tenantId(req)], (err, r) => err ? reject(err) : resolve(r || []));
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

// Voice 2.0 (docs/design/voice-2.0-plan.md §5.3): validation of a (provider, voice) pair
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

// Stamped with the tenant (F-18 / L3-08: rows defaulted to tenant 1, so
// tenant 1's admins saw every tenant's usage and the others saw none).
function recordTtsUsage(userId, tenant, provider, charCount) {
    if (!userId || !provider || !charCount) return;
    const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
    const rate = TTS_COST_PER_M_CHARS[provider] ?? 0;
    const cost = (charCount / 1_000_000) * rate;
    dbAdapter.run(
        `INSERT INTO tts_usage (user_id, tenant_id, date, provider, char_count, request_count, estimated_cost, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, date, provider) DO UPDATE SET
            char_count    = tts_usage.char_count    + excluded.char_count,
            request_count = tts_usage.request_count + 1,
            estimated_cost = tts_usage.estimated_cost + excluded.estimated_cost,
            updated_at    = CURRENT_TIMESTAMP`,
        [userId, tenant, today, provider, charCount, cost],
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
// Voice 2.0 + sovereignty (docs/design/voice-2.0-plan.md v1.4): THE VOICE OWNS ITS ENGINE,
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
//
// Bounded (F-07): ttsRateLimiter (per user per minute), then the synthesis
// queue and the overall deadline inside handleTtsSynthesis (lib/ttsLimits.js).
router.post('/tts', authenticateToken, ttsRateLimiter, async (req, res) => {
    return handleTtsSynthesis(req, res, { isPreview: false });
});

// Admin preview: accepts a `provider` override on the body so the Voice
// settings tab can audition any voice without touching the runtime path.
// Same literal-or-error semantics as the main route.
router.post('/tts/preview', authenticateToken, requireAdmin, ttsRateLimiter, async (req, res) => {
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

    // A place in the synthesis queue before anything is reserved or spent.
    // Full (too many running and waiting, overall or for this user) → 429 at
    // once. A client that leaves while queued gives its place up.
    const leftQueue = new AbortController();
    const onLeave = () => leftQueue.abort(new Error('client_disconnected'));
    req.once('close', onLeave);
    let releaseSlot;
    try {
        releaseSlot = await ttsGate.acquire(`user:${req.user?.id ?? req.ip}`, { signal: leftQueue.signal });
    } catch (err) {
        req.off('close', onLeave);
        if (err instanceof GateFullError) {
            (req.log || routesLlmLog).warn('tts refused: synthesis queue full', { scope: err.scope });
            return res.status(429).json({ error: 'Speech synthesis is busy. Please try again in a moment.', code: 'tts_busy' });
        }
        if (leftQueue.signal.aborted) return undefined;   // nobody left to answer
        throw err;
    }
    req.off('close', onLeave);
    try {
        // Check AND reserve the characters in one step (F-07: the check and
        // the record were two steps, so parallel requests all passed). Paid
        // engines bill on submission, not delivery, so the reservation is the
        // record; local rows are $0 but keep per-user volume visible.
        try {
            await reserveBudget({
                tenantId: tenantId(req),
                userId: req.user?.id,
                provider: `tts-${plan.provider}`,
                metric: 'characters',
                amount: text.length
            });
        } catch (err) {
            if (err instanceof BudgetExceededError) {
                return res.status(429).json(budgetExceededResponse(err));
            }
            throw err;
        }
        recordTtsUsage(req.user?.id, tenantId(req), plan.provider, text.length);

        // The whole synthesis has a deadline. Past it, an uncommitted
        // response is answered 504; a stream already flowing is ended.
        const deadline = setTimeout(() => {
            (req.log || routesLlmLog).warn('tts synthesis deadline reached', { provider: plan.provider, timeout_ms: TTS_TIMEOUT_MS });
            if (!res.headersSent) res.status(504).json({ error: 'Speech synthesis took too long', code: 'tts_timeout' });
            // destroy, not end: the engine may still write, and a write after
            // end() on a live response is an 'error' event nobody listens to.
            else if (!res.writableEnded) res.destroy();
        }, TTS_TIMEOUT_MS);
        deadline.unref?.();
        try {
            return await synthesizeToResponse(req, res, plan, { text, rate, pitch });
        } catch (err) {
            // A runtime engine failure (quota, network, 5xx) is an honest error
            // — the configured voice is literal, so there is no retry onto a
            // stand-in (owner directive, docs/design/voice-2.0-plan.md v1.4). The first-chunk
            // pre-flight keeps the response uncommitted until the engine
            // actually delivers, so the client gets a real JSON error instead
            // of a dead stream.
            if (res.headersSent && (res.writableEnded || res.destroyed)) return undefined;   // the deadline answered
            return sendSynthesisError(req, res, plan.provider, err);
        } finally {
            clearTimeout(deadline);
        }
    } finally {
        // The slot is held until the engine has finished, not merely until
        // the deadline answered: the CPU is busy until then.
        releaseSlot();
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

// First-chunk pre-flight (docs/design/voice-2.0-plan.md §5.3): pull the first upstream
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
    // A private directory of our own (mkdtemp: unguessable, mode 0700) and an
    // exclusive create ('wx'): a pre-planted file or symlink at a guessable
    // name in the shared tmpdir can neither be overwritten nor followed.
    let tmpDir;
    let tmpFile;
    try {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-tts-'));
        tmpFile = path.join(tmpDir, 'input.txt');
        fs.writeFileSync(tmpFile, text, { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
        routesLlmLog.error('piper temp input write failed', { error: err.message });
        if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
        throw publicError('Failed to prepare TTS input');
    }
    const removeTmp = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } };

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
        removeTmp();
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

        const cleanup = removeTmp;

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

        // The limits exactly as the proxy enforces them (0 = no limit) —
        // lib/llmLimits.js, the one definition (F-24).
        const limits = await readLlmLimits(getPlatformSetting);

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
                 WHERE lu.date = ? AND lu.tenant_id = ?
                 ORDER BY lu.total_tokens DESC`,
                [today, tenantId(req)],
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

// GET /api/llm/usage/platform - today's usage totals (Admin only).
// Install-wide for a platform administrator; a tenant administrator sees
// their own tenant's totals against the tenant limits (L3-08: every tenant
// admin used to read the whole install's spend).
router.get('/llm/usage/platform', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const installWide = isPlatformAdmin(req.user);

        const platformUsage = (await dbAdapter.get(
            `SELECT
                SUM(total_tokens) as total_tokens,
                SUM(estimated_cost) as total_cost,
                SUM(request_count) as total_requests,
                COUNT(DISTINCT user_id) as active_users
             FROM llm_usage WHERE date = ? ${installWide ? '' : 'AND tenant_id = ?'}`,
            installWide ? [today] : [today, tenantId(req)]
        )) || { total_tokens: 0, total_cost: 0, total_requests: 0, active_users: 0 };

        // The limits exactly as the proxy enforces them (0 = no limit).
        const enforced = await readLlmLimits(getPlatformSetting);
        const limits = installWide
            ? { tokensPlatformDaily: enforced.tokensPlatformDaily, costPlatformDaily: enforced.costPlatformDaily }
            : { tokensPlatformDaily: enforced.tokensTenantDaily, costPlatformDaily: enforced.costTenantDaily };

        res.json({
            scope: installWide ? 'install' : 'tenant',
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

// PUT /api/llm/pricing - Update model pricing (platform admin only: the
// pricing table has no tenant, so a tenant admin zeroing a price disabled the
// cost limits of every tenant — F-02 / L3-09).
router.put('/llm/pricing', authenticateToken, requirePlatformAdmin, async (req, res) => {
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
