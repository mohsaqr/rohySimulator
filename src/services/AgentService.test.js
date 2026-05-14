// Phase-3 — AgentService client contract tests.
//
// Source under test: src/services/AgentService.js
//
// AgentService is a thin client wrapper around /api/agents/*, /api/cases/*,
// /api/sessions/*, and /api/proxy/llm. It pulls its bearer token directly
// from localStorage.getItem('token') (NOT via AuthService — see line ~20 of
// AgentService.js), so we seed localStorage and let the global jsdom storage
// in tests/setup.js hand it back.
//
// CONTRACT — what these tests lock in:
//   1. Method ↔ HTTP verb ↔ URL pairing for every read/write export.
//   2. Authorization: Bearer <token> header is present on every request.
//   3. Content-Type: application/json on every request.
//   4. Body shape for POST/PUT calls matches the documented argument list.
//   5. Server error responses ({ error: "..." }) bubble up as thrown Errors
//      with the server's message — for the methods that rethrow. Methods
//      that swallow errors (returning [] / null / { status: 'absent' }) are
//      tested for that fallback behaviour, since that is the public contract.
//   6. resetTemplateToDefault hits POST /api/agents/templates/:id/reset-to-default
//      with no body — the wrapper added to support the Reset-to-Default
//      flow that landed in commit bb34d88 and follow-up work.
//
// We intentionally do NOT modify tests/utils/mockTtsServer.js — msw is
// configured inline below via setupServer with a handler matrix scoped to
// the relative paths AgentService touches.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { AgentService } from './AgentService.js';
import AgentServiceDefault from './AgentService.js';

// Recorded request log so individual tests can assert on what was sent.
// Each entry: { method, path, search, headers, body }.
const sentRequests = [];

async function recordRequest(request) {
    let body = null;
    try {
        body = await request.clone().json();
    } catch {
        body = null;
    }
    const url = new URL(request.url);
    sentRequests.push({
        method: request.method,
        path: url.pathname,
        search: Object.fromEntries(url.searchParams.entries()),
        headers: Object.fromEntries(request.headers.entries()),
        body,
    });
    return body;
}

// `okJson` and `errJson` return 200 / non-200 responses respectively.
function okJson(body) {
    return HttpResponse.json(body, { status: 200 });
}
function errJson(message, status = 500) {
    return HttpResponse.json({ error: message }, { status });
}

// Per-test response controller. Tests can override this to return errors.
// Default returns `{}` for any matched endpoint. The route-specific handlers
// inspect the latest override and invoke it to build their response.
let nextResponse = null;

// Build msw handlers covering every endpoint AgentService.js touches.
// Order matters in msw — most specific first.
const handlers = [
    // ---- Templates ----
    http.get('*/api/agents/templates', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ templates: [{ id: 't1', name: 'Template One' }] });
    }),
    http.post('*/api/agents/templates', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ id: 'new-template', ok: true });
    }),
    http.get('*/api/agents/templates/:id', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ id: 'tpl-1', name: 'Sample' });
    }),
    http.put('*/api/agents/templates/:id', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ updated: true });
    }),
    http.delete('*/api/agents/templates/:id', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ deleted: true });
    }),
    http.post('*/api/agents/templates/:id/duplicate', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ id: 'dup-1', name: 'Copy' });
    }),
    http.post('*/api/agents/templates/:id/reset-to-default', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ reset: true, id: 'tpl-1' });
    }),
    http.post('*/api/agents/templates/:id/test-llm', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ ok: true, latency_ms: 123 });
    }),

    // ---- Case agents ----
    http.get('*/api/cases/:caseId/agents', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ agents: [{ id: 'a1', agent_type: 'nurse' }] });
    }),
    http.post('*/api/cases/:caseId/agents/add-defaults', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ added: 3 });
    }),
    http.post('*/api/cases/:caseId/agents', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ id: 'a-new' });
    }),
    http.put('*/api/cases/:caseId/agents/:agentId', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ updated: true });
    }),
    http.delete('*/api/cases/:caseId/agents/:agentId', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ removed: true });
    }),

    // ---- Session agents (most specific path components first) ----
    http.get('*/api/sessions/:sessionId/agents', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ agents: [{ agent_type: 'nurse', status: 'present' }] });
    }),
    http.post('*/api/sessions/:sessionId/agents/:agentType/page', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ paged: true });
    }),
    http.post('*/api/sessions/:sessionId/agents/:agentType/arrive', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ arrived: true });
    }),
    http.post('*/api/sessions/:sessionId/agents/:agentType/depart', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ departed: true });
    }),
    http.get('*/api/sessions/:sessionId/agents/:agentType/status', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ status: 'present' });
    }),
    http.get('*/api/sessions/:sessionId/agents/:agentType/conversation', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ messages: [{ role: 'user', content: 'hi' }] });
    }),
    http.post('*/api/sessions/:sessionId/agents/:agentType/conversation', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ added: true });
    }),
    http.delete('*/api/sessions/:sessionId/agents/:agentType/conversation', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ cleared: true });
    }),

    // ---- Team communications ----
    http.get('*/api/sessions/:sessionId/team-communications', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ log: [{ agent_type: 'nurse', key_points: 'k' }] });
    }),
    http.post('*/api/sessions/:sessionId/team-communications', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({ logged: true });
    }),

    // ---- LLM proxy (used by sendAgentMessage) ----
    http.post('*/api/proxy/llm', async ({ request }) => {
        await recordRequest(request);
        if (nextResponse) return nextResponse();
        return okJson({
            choices: [{ message: { content: 'agent reply.' } }],
        });
    }),
];

const server = setupServer(...handlers);

const BEARER = 'agent-service-test-token';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
    // Seed the token AgentService.getAuthHeaders() reads.
    window.localStorage.setItem('token', BEARER);
    // Silence the noisy console.error inside catch-blocks so the test output
    // stays readable. We assert behaviour, not log noise.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    server.resetHandlers();
    sentRequests.length = 0;
    nextResponse = null;
});
afterAll(() => server.close());

// Helper — find the most recent recorded request matching method + path
// suffix. Path suffix because BASE_URL prefix may be empty under test.
function lastRequest({ method, pathEndsWith } = {}) {
    for (let i = sentRequests.length - 1; i >= 0; i--) {
        const r = sentRequests[i];
        if (method && r.method !== method) continue;
        if (pathEndsWith && !r.path.endsWith(pathEndsWith)) continue;
        return r;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Module-shape sanity
// ---------------------------------------------------------------------------

describe('AgentService — module shape', () => {
    it('exports a named AgentService and a default that is the same object', () => {
        // CONTRACT: code imports both `import { AgentService }` and
        // `import AgentService from`, so default must be the same reference.
        expect(AgentService).toBeTruthy();
        expect(AgentServiceDefault).toBe(AgentService);
    });

    it('exposes every documented public method', () => {
        // getAuthHeaders was removed when AgentService migrated to apiFetch
        // (auth headers now come from the central client, not per-service).
        const expected = [
            'getTemplates', 'getTemplate', 'createTemplate', 'updateTemplate',
            'deleteTemplate', 'duplicateTemplate', 'resetTemplateToDefault', 'testLLM',
            'getCaseAgents', 'addAgentToCase', 'updateCaseAgent',
            'removeAgentFromCase', 'addDefaultAgentsToCase',
            'getSessionAgents', 'pageAgent', 'arriveAgent', 'departAgent', 'getAgentStatus',
            'getConversation', 'addMessage', 'clearConversation',
            'getTeamCommunications', 'addTeamCommunication',
            'buildDebriefingContext', 'buildAgentSystemPrompt',
            'sendAgentMessage', 'extractKeyPoints',
            'isAgentAvailable', 'calculateWaitTime', 'getAgentDisplayStatus',
        ];
        for (const name of expected) {
            expect(typeof AgentService[name], `${name} should be a function`).toBe('function');
        }
    });
});

// ---------------------------------------------------------------------------
// Templates: getTemplates / getTemplate / createTemplate / updateTemplate /
// deleteTemplate / duplicateTemplate / resetTemplateToDefault / testLLM
// ---------------------------------------------------------------------------

describe('AgentService templates — happy paths', () => {
    it('getTemplates: GET /api/agents/templates with bearer + returns templates array', async () => {
        const result = await AgentService.getTemplates();
        expect(result).toEqual([{ id: 't1', name: 'Template One' }]);

        const req = lastRequest({ method: 'GET', pathEndsWith: '/api/agents/templates' });
        expect(req).toBeTruthy();
        expect(req.headers.authorization).toBe(`Bearer ${BEARER}`);
        // apiFetch only sets Content-Type when a JSON body is sent; bodyless
        // GETs intentionally omit it to avoid lying about the request shape.
    });

    it('getTemplate: GET /api/agents/templates/:id returns the parsed body', async () => {
        const tpl = await AgentService.getTemplate('tpl-1');
        expect(tpl).toEqual({ id: 'tpl-1', name: 'Sample' });

        const req = lastRequest({ method: 'GET', pathEndsWith: '/api/agents/templates/tpl-1' });
        expect(req).toBeTruthy();
    });

    it('createTemplate: POST /api/agents/templates with the supplied body', async () => {
        const data = { name: 'New', system_prompt: 'You are X.' };
        const out = await AgentService.createTemplate(data);
        expect(out).toEqual({ id: 'new-template', ok: true });

        const req = lastRequest({ method: 'POST', pathEndsWith: '/api/agents/templates' });
        expect(req).toBeTruthy();
        expect(req.body).toEqual(data);
        expect(req.headers.authorization).toBe(`Bearer ${BEARER}`);
    });

    it('updateTemplate: PUT /api/agents/templates/:id with body', async () => {
        const updates = { name: 'Renamed' };
        const out = await AgentService.updateTemplate('tpl-9', updates);
        expect(out).toEqual({ updated: true });

        const req = lastRequest({ method: 'PUT', pathEndsWith: '/api/agents/templates/tpl-9' });
        expect(req).toBeTruthy();
        expect(req.body).toEqual(updates);
    });

    it('deleteTemplate: DELETE /api/agents/templates/:id', async () => {
        const out = await AgentService.deleteTemplate('tpl-9');
        expect(out).toEqual({ deleted: true });

        const req = lastRequest({ method: 'DELETE', pathEndsWith: '/api/agents/templates/tpl-9' });
        expect(req).toBeTruthy();
    });

    it('duplicateTemplate: POST /api/agents/templates/:id/duplicate with { name }', async () => {
        const out = await AgentService.duplicateTemplate('tpl-1', 'Clone');
        expect(out).toEqual({ id: 'dup-1', name: 'Copy' });

        const req = lastRequest({ method: 'POST', pathEndsWith: '/api/agents/templates/tpl-1/duplicate' });
        expect(req).toBeTruthy();
        expect(req.body).toEqual({ name: 'Clone' });
    });

    it('resetTemplateToDefault: POST /api/agents/templates/:id/reset-to-default with no body', async () => {
        // CONTRACT (commit bb34d88 + follow-up): the reset-to-default wrapper
        // hits the dedicated endpoint with method POST and NO request body.
        const out = await AgentService.resetTemplateToDefault('tpl-1');
        expect(out).toEqual({ reset: true, id: 'tpl-1' });

        const req = lastRequest({
            method: 'POST',
            pathEndsWith: '/api/agents/templates/tpl-1/reset-to-default',
        });
        expect(req).toBeTruthy();
        expect(req.body).toBeNull(); // no JSON body sent
        expect(req.headers.authorization).toBe(`Bearer ${BEARER}`);
    });

    it('testLLM: POST /api/agents/templates/:id/test-llm returns server payload', async () => {
        const out = await AgentService.testLLM('tpl-1');
        expect(out).toEqual({ ok: true, latency_ms: 123 });

        const req = lastRequest({ method: 'POST', pathEndsWith: '/api/agents/templates/tpl-1/test-llm' });
        expect(req).toBeTruthy();
        expect(req.body).toBeNull();
    });
});

describe('AgentService templates — error paths', () => {
    it('getTemplates: returns [] on non-200 (silently swallows the error)', async () => {
        nextResponse = () => errJson('boom', 500);
        const out = await AgentService.getTemplates();
        // CONTRACT: getTemplates() catches errors and returns [] — keeps the
        // settings UI rendering even when the server hiccups.
        expect(out).toEqual([]);
    });

    it('getTemplate: returns null on non-200', async () => {
        nextResponse = () => errJson('not found', 404);
        const out = await AgentService.getTemplate('nope');
        expect(out).toBeNull();
    });

    it('createTemplate: rethrows server { error } message', async () => {
        nextResponse = () => errJson('name taken', 400);
        await expect(AgentService.createTemplate({ name: 'x' })).rejects.toThrow('name taken');
    });

    it('updateTemplate: rethrows server { error } message', async () => {
        nextResponse = () => errJson('immutable', 400);
        await expect(AgentService.updateTemplate('id', {})).rejects.toThrow('immutable');
    });

    it('deleteTemplate: rethrows server { error } message', async () => {
        nextResponse = () => errJson('cannot delete default', 400);
        await expect(AgentService.deleteTemplate('id')).rejects.toThrow('cannot delete default');
    });

    it('duplicateTemplate: rethrows server { error } message', async () => {
        nextResponse = () => errJson('dup failed', 500);
        await expect(AgentService.duplicateTemplate('id', 'n')).rejects.toThrow('dup failed');
    });

    it('resetTemplateToDefault: rethrows server { error } message (e.g. custom template)', async () => {
        // Servers reject custom (non-default) templates with 400.
        nextResponse = () => errJson('only default templates can be reset', 400);
        await expect(AgentService.resetTemplateToDefault('custom-1'))
            .rejects.toThrow('only default templates can be reset');
    });

    it('testLLM: rethrows server { error } message', async () => {
        nextResponse = () => errJson('provider unreachable', 502);
        await expect(AgentService.testLLM('id')).rejects.toThrow('provider unreachable');
    });

    it('createTemplate: surfaces fetch network rejections as Error', async () => {
        // Override: the request handler throws, simulating a transport failure.
        server.use(http.post('*/api/agents/templates', () => HttpResponse.error()));
        await expect(AgentService.createTemplate({ name: 'x' })).rejects.toBeInstanceOf(Error);
    });
});

// ---------------------------------------------------------------------------
// Case agents: getCaseAgents / addAgentToCase / updateCaseAgent /
// removeAgentFromCase / addDefaultAgentsToCase
// ---------------------------------------------------------------------------

describe('AgentService case agents', () => {
    it('getCaseAgents: GET /api/cases/:caseId/agents returns agents array', async () => {
        const out = await AgentService.getCaseAgents('case-7');
        expect(out).toEqual([{ id: 'a1', agent_type: 'nurse' }]);

        const req = lastRequest({ method: 'GET', pathEndsWith: '/api/cases/case-7/agents' });
        expect(req).toBeTruthy();
        expect(req.headers.authorization).toBe(`Bearer ${BEARER}`);
    });

    it('getCaseAgents: returns [] on non-200 (does not throw)', async () => {
        nextResponse = () => errJson('boom', 500);
        const out = await AgentService.getCaseAgents('case-7');
        expect(out).toEqual([]);
    });

    it('addAgentToCase: POST /api/cases/:caseId/agents with config body', async () => {
        const cfg = { agent_template_id: 'tpl-1', enabled: true };
        const out = await AgentService.addAgentToCase('case-1', cfg);
        expect(out).toEqual({ id: 'a-new' });

        const req = lastRequest({ method: 'POST', pathEndsWith: '/api/cases/case-1/agents' });
        expect(req).toBeTruthy();
        expect(req.body).toEqual(cfg);
    });

    it('addAgentToCase: rethrows on server error', async () => {
        nextResponse = () => errJson('agent already added', 409);
        await expect(AgentService.addAgentToCase('case-1', {}))
            .rejects.toThrow('agent already added');
    });

    it('updateCaseAgent: PUT /api/cases/:caseId/agents/:agentId with updates', async () => {
        const updates = { enabled: false };
        const out = await AgentService.updateCaseAgent('case-1', 'a-1', updates);
        expect(out).toEqual({ updated: true });

        const req = lastRequest({ method: 'PUT', pathEndsWith: '/api/cases/case-1/agents/a-1' });
        expect(req).toBeTruthy();
        expect(req.body).toEqual(updates);
    });

    it('removeAgentFromCase: DELETE /api/cases/:caseId/agents/:agentId', async () => {
        const out = await AgentService.removeAgentFromCase('case-1', 'a-1');
        expect(out).toEqual({ removed: true });

        const req = lastRequest({ method: 'DELETE', pathEndsWith: '/api/cases/case-1/agents/a-1' });
        expect(req).toBeTruthy();
    });

    it('addDefaultAgentsToCase: POST /api/cases/:caseId/agents/add-defaults with no body', async () => {
        const out = await AgentService.addDefaultAgentsToCase('case-2');
        expect(out).toEqual({ added: 3 });

        const req = lastRequest({ method: 'POST', pathEndsWith: '/api/cases/case-2/agents/add-defaults' });
        expect(req).toBeTruthy();
        expect(req.body).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Session agents (runtime state)
// ---------------------------------------------------------------------------

describe('AgentService session agents', () => {
    it('getSessionAgents: GET /api/sessions/:id/agents returns agents array', async () => {
        const out = await AgentService.getSessionAgents('sess-1');
        expect(out).toEqual([{ agent_type: 'nurse', status: 'present' }]);

        const req = lastRequest({ method: 'GET', pathEndsWith: '/api/sessions/sess-1/agents' });
        expect(req).toBeTruthy();
    });

    it('getSessionAgents: returns [] on non-200', async () => {
        nextResponse = () => errJson('not found', 404);
        const out = await AgentService.getSessionAgents('sess-1');
        expect(out).toEqual([]);
    });

    it('pageAgent: POST /api/sessions/:id/agents/:type/page', async () => {
        const out = await AgentService.pageAgent('sess-1', 'nurse');
        expect(out).toEqual({ paged: true });

        const req = lastRequest({ method: 'POST', pathEndsWith: '/api/sessions/sess-1/agents/nurse/page' });
        expect(req).toBeTruthy();
        expect(req.body).toBeNull();
    });

    it('pageAgent: throws ApiError surfacing the server error on non-200', async () => {
        nextResponse = () => errJson('unavailable', 503);
        // apiFetch surfaces the real server message instead of a generic wrapper.
        await expect(AgentService.pageAgent('sess-1', 'nurse')).rejects.toThrow(/unavailable/);
    });

    it('arriveAgent: POST /api/sessions/:id/agents/:type/arrive', async () => {
        const out = await AgentService.arriveAgent('sess-1', 'nurse');
        expect(out).toEqual({ arrived: true });

        const req = lastRequest({ method: 'POST', pathEndsWith: '/api/sessions/sess-1/agents/nurse/arrive' });
        expect(req).toBeTruthy();
    });

    it('departAgent: POST /api/sessions/:id/agents/:type/depart', async () => {
        const out = await AgentService.departAgent('sess-1', 'nurse');
        expect(out).toEqual({ departed: true });

        const req = lastRequest({ method: 'POST', pathEndsWith: '/api/sessions/sess-1/agents/nurse/depart' });
        expect(req).toBeTruthy();
    });

    it('getAgentStatus: GET /api/sessions/:id/agents/:type/status', async () => {
        const out = await AgentService.getAgentStatus('sess-1', 'nurse');
        expect(out).toEqual({ status: 'present' });

        const req = lastRequest({ method: 'GET', pathEndsWith: '/api/sessions/sess-1/agents/nurse/status' });
        expect(req).toBeTruthy();
    });

    it('getAgentStatus: returns { status: "absent" } fallback on non-200', async () => {
        // CONTRACT: errors collapse to absent so the UI can still render.
        nextResponse = () => errJson('boom', 500);
        const out = await AgentService.getAgentStatus('sess-1', 'nurse');
        expect(out).toEqual({ status: 'absent' });
    });
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

describe('AgentService conversations', () => {
    it('getConversation: GET /api/sessions/:id/agents/:type/conversation returns messages', async () => {
        const out = await AgentService.getConversation('sess-1', 'nurse');
        expect(out).toEqual([{ role: 'user', content: 'hi' }]);

        const req = lastRequest({
            method: 'GET',
            pathEndsWith: '/api/sessions/sess-1/agents/nurse/conversation',
        });
        expect(req).toBeTruthy();
    });

    it('getConversation: returns [] on non-200', async () => {
        nextResponse = () => errJson('boom', 500);
        const out = await AgentService.getConversation('sess-1', 'nurse');
        expect(out).toEqual([]);
    });

    it('addMessage: POST conversation with { role, content }', async () => {
        const out = await AgentService.addMessage('sess-1', 'nurse', 'user', 'hello');
        expect(out).toEqual({ added: true });

        const req = lastRequest({
            method: 'POST',
            pathEndsWith: '/api/sessions/sess-1/agents/nurse/conversation',
        });
        expect(req).toBeTruthy();
        expect(req.body).toEqual({ role: 'user', content: 'hello' });
    });

    it('clearConversation: DELETE conversation', async () => {
        const out = await AgentService.clearConversation('sess-1', 'nurse');
        expect(out).toEqual({ cleared: true });

        const req = lastRequest({
            method: 'DELETE',
            pathEndsWith: '/api/sessions/sess-1/agents/nurse/conversation',
        });
        expect(req).toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// Team communications
// ---------------------------------------------------------------------------

describe('AgentService team communications', () => {
    it('getTeamCommunications: GET returns log array', async () => {
        const out = await AgentService.getTeamCommunications('sess-1');
        expect(out).toEqual([{ agent_type: 'nurse', key_points: 'k' }]);

        const req = lastRequest({ method: 'GET', pathEndsWith: '/api/sessions/sess-1/team-communications' });
        expect(req).toBeTruthy();
    });

    it('getTeamCommunications: returns [] on non-200', async () => {
        nextResponse = () => errJson('boom', 500);
        const out = await AgentService.getTeamCommunications('sess-1');
        expect(out).toEqual([]);
    });

    it('addTeamCommunication: POST with { agent_type, key_points }', async () => {
        const out = await AgentService.addTeamCommunication('sess-1', 'nurse', 'BP rising');
        expect(out).toEqual({ logged: true });

        const req = lastRequest({ method: 'POST', pathEndsWith: '/api/sessions/sess-1/team-communications' });
        expect(req).toBeTruthy();
        expect(req.body).toEqual({ agent_type: 'nurse', key_points: 'BP rising' });
    });
});

// ---------------------------------------------------------------------------
// Pure helpers — no network
// ---------------------------------------------------------------------------

describe('AgentService.buildDebriefingContext', () => {
    it('produces a string with patient + vitals + filtered team log sections', () => {
        const agent = {
            agent_type: 'nurse',
            context_filter: 'full',
            memory_access: { OBTAINED: true, EXAMINED: true },
        };
        const patientRecord = {
            record: {
                patient: { name: 'Jane Doe', age: 55, gender: 'F', chief_complaint: 'Chest pain' },
            },
        };
        const teamLog = [
            { agent_type: 'nurse', key_points: 'BP 140/90' },
            { agent_type: 'doctor', key_points: 'EKG ordered' },
        ];
        const vitals = { hr: 90, spo2: 96, bpSys: 140, bpDia: 90 };
        const out = AgentService.buildDebriefingContext(agent, patientRecord, teamLog, vitals);
        expect(out).toContain('PATIENT BRIEFING');
        expect(out).toContain('Jane Doe');
        expect(out).toContain('Chief Complaint: Chest pain');
        expect(out).toContain('CURRENT VITALS');
        expect(out).toContain('HR: 90bpm');
        expect(out).toContain('SpO2: 96%');
        expect(out).toContain('TEAM COMMUNICATIONS');
        expect(out).toContain('[doctor]: EKG ordered');
    });

    it('includes filtered authored case design when an active case is supplied', () => {
        const agent = { agent_type: 'nurse', context_filter: 'full' };
        const activeCase = {
            name: 'Configured Case',
            config: {
                patient_name: 'Alex Patient',
                demographics: { age: 44, gender: 'female' },
                structuredHistory: {
                    chiefComplaint: 'Shortness of breath',
                    hpi: 'Worse when lying flat',
                },
                initialVitals: { hr: 118, bpSys: 100, bpDia: 64, spo2: 90 },
                diagnosis: 'Pulmonary edema',
            },
        };
        const out = AgentService.buildDebriefingContext(agent, null, [], null, activeCase);
        expect(out).toContain('CASE CONTEXT');
        expect(out).toContain('Patient: Alex Patient');
        expect(out).toContain('History of Present Illness: Worse when lying flat');
        expect(out).toContain('HR: 118 bpm');
        expect(out).toContain('Expected diagnosis: Pulmonary edema');
    });

    it('honours context_filter="history" by dropping non-matching agent_type entries', () => {
        const agent = { agent_type: 'nurse', context_filter: 'history' };
        const teamLog = [
            { agent_type: 'doctor', key_points: 'doctor stuff' },
            { agent_type: 'nurse', key_points: 'nurse stuff' },
            { agent_type: 'relative', key_points: 'family update' },
        ];
        const out = AgentService.buildDebriefingContext(agent, null, teamLog, null);
        expect(out).toContain('nurse stuff');
        expect(out).toContain('family update'); // relative is always allowed
        expect(out).not.toContain('doctor stuff');
    });
});

describe('AgentService.buildAgentSystemPrompt', () => {
    it('joins the agent system prompt with the debriefing under the CURRENT SITUATION header', () => {
        const out = AgentService.buildAgentSystemPrompt(
            { system_prompt: 'You are a nurse.' },
            'PATIENT: Jane',
        );
        expect(out).toContain('You are a nurse.');
        expect(out).toContain('--- CURRENT SITUATION ---');
        expect(out).toContain('PATIENT: Jane');
    });

    it('omits the situation header when no debriefing context is supplied', () => {
        // Post-2026-05-14 enterprise-fix: the prompt now leads with a
        // role-anchor block (see src/utils/roleAnchor.js) before the
        // agent's authored system_prompt. The original assertion checked
        // an exact-equality "plain" — that was locking the absence of any
        // structural framing, which was the prior weakness. We now assert
        // both the anchor and the unchanged authored prose are present
        // and that the SITUATION header is still absent.
        const out = AgentService.buildAgentSystemPrompt(
            { system_prompt: 'plain' },
            '',
        );
        expect(out).toMatch(/## ROLE/);
        expect(out).toMatch(/Respond ONLY as/);
        expect(out).toContain('plain');
        expect(out).not.toContain('--- CURRENT SITUATION ---');
    });

    it('uses agent.role_title and agent.name in the role anchor when provided', () => {
        const out = AgentService.buildAgentSystemPrompt(
            { system_prompt: 'You are stoic.', role_title: 'Bedside nurse', name: 'Nurse Beth' },
            '',
        );
        expect(out).toMatch(/You are: Bedside nurse\./);
        expect(out).toMatch(/Your name: Nurse Beth\./);
    });

    it('falls back to agent.agent_type when role_title is missing', () => {
        const out = AgentService.buildAgentSystemPrompt(
            { system_prompt: '', agent_type: 'consultant' },
            '',
        );
        expect(out).toMatch(/You are: consultant\./);
    });
});

describe('AgentService.extractKeyPoints', () => {
    it('returns null for very short content', () => {
        expect(AgentService.extractKeyPoints('hi', 'nurse')).toBeNull();
    });

    it('returns the first sentence when one is present', () => {
        const out = AgentService.extractKeyPoints(
            'Patient stable. Continuing monitoring.',
            'nurse',
        );
        expect(out).toBe('Patient stable.');
    });

    it('falls back to first 100 chars when no sentence terminator is found', () => {
        const long = 'a'.repeat(150);
        const out = AgentService.extractKeyPoints(long, 'nurse');
        expect(out.endsWith('...')).toBe(true);
        expect(out.length).toBeLessThanOrEqual(103);
    });
});

describe('AgentService.isAgentAvailable', () => {
    it('returns false when not enabled', () => {
        expect(AgentService.isAgentAvailable({ enabled: false }, 0)).toBe(false);
    });

    it('returns false for absent availability_type', () => {
        expect(AgentService.isAgentAvailable(
            { enabled: true, availability_type: 'absent' }, 10)).toBe(false);
    });

    it('returns true for on-call agents regardless of elapsed time', () => {
        expect(AgentService.isAgentAvailable(
            { enabled: true, availability_type: 'on-call' }, 0)).toBe(true);
    });

    it('returns false before available_from_minute and true after', () => {
        const agent = {
            enabled: true,
            availability_type: 'present',
            available_from_minute: 5,
        };
        expect(AgentService.isAgentAvailable(agent, 4)).toBe(false);
        expect(AgentService.isAgentAvailable(agent, 5)).toBe(true);
    });

    it('returns false once depart_at_minute has been reached', () => {
        const agent = {
            enabled: true,
            availability_type: 'present',
            available_from_minute: 0,
            depart_at_minute: 30,
        };
        expect(AgentService.isAgentAvailable(agent, 29)).toBe(true);
        expect(AgentService.isAgentAvailable(agent, 30)).toBe(false);
    });
});

describe('AgentService.calculateWaitTime', () => {
    it('returns the min when min === max', () => {
        expect(AgentService.calculateWaitTime({ response_time_min: 5, response_time_max: 5 })).toBe(5);
    });

    it('returns the min when max <= min', () => {
        expect(AgentService.calculateWaitTime({ response_time_min: 8, response_time_max: 3 })).toBe(8);
    });

    it('returns a value within [min, max] when a valid range is given', () => {
        const agent = { response_time_min: 2, response_time_max: 6 };
        for (let i = 0; i < 20; i++) {
            const v = AgentService.calculateWaitTime(agent);
            expect(v).toBeGreaterThanOrEqual(2);
            expect(v).toBeLessThanOrEqual(6);
        }
    });
});

describe('AgentService.getAgentDisplayStatus', () => {
    it('disabled agent: returns disabled / Not Available / no actions', () => {
        const out = AgentService.getAgentDisplayStatus({ enabled: false }, 0);
        expect(out).toEqual({
            status: 'disabled', label: 'Not Available', canChat: false, canPage: false,
        });
    });

    it('present session status: canChat=true, canPage=false', () => {
        const out = AgentService.getAgentDisplayStatus(
            { enabled: true, status: 'present' }, 10);
        expect(out.status).toBe('present');
        expect(out.canChat).toBe(true);
        expect(out.canPage).toBe(false);
    });

    it('on-call config: returns on-call with canPage=true', () => {
        const out = AgentService.getAgentDisplayStatus(
            { enabled: true, availability_type: 'on-call' }, 10);
        expect(out.status).toBe('on-call');
        expect(out.canPage).toBe(true);
    });

    it('not-yet: pre-arrival shows minutes-until label', () => {
        const out = AgentService.getAgentDisplayStatus(
            { enabled: true, availability_type: 'present', available_from_minute: 10 },
            3,
        );
        expect(out.status).toBe('not-yet');
        expect(out.label).toMatch(/Available in 7 min/);
        expect(out.canChat).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// sendAgentMessage end-to-end (orchestrates addMessage + LLM proxy + log)
// ---------------------------------------------------------------------------

describe('AgentService.sendAgentMessage', () => {
    it('happy path: hits /api/proxy/llm with system_prompt + messages and returns assistant content', async () => {
        const agent = {
            id: 'a-1',
            agent_template_id: 'tpl-1',
            agent_type: 'nurse',
            name: 'Nurse Joy',
            system_prompt: 'You are a triage nurse.',
            llm_provider: 'openai',
            llm_model: 'gpt-4o-mini',
        };
        const out = await AgentService.sendAgentMessage(
            'sess-1',
            agent,
            'BP is rising',
            null,
            [],
            { hr: 90 },
            [{ role: 'assistant', content: 'previous reply' }],
            {
                name: 'Agent Case',
                config: {
                    patient_name: 'Case Patient',
                    structuredHistory: { chiefComplaint: 'Chest pain' },
                },
            },
        );
        expect(out).toBe('agent reply.');

        const llmReq = lastRequest({ method: 'POST', pathEndsWith: '/api/proxy/llm' });
        expect(llmReq).toBeTruthy();
        expect(llmReq.body.session_id).toBe('sess-1');
        expect(llmReq.body.system_prompt).toContain('You are a triage nurse.');
        expect(llmReq.body.system_prompt).toContain('Case: Agent Case');
        expect(llmReq.body.system_prompt).toContain('Chief Complaint: Chest pain');
        expect(llmReq.body.messages).toEqual([
            { role: 'assistant', content: 'previous reply' },
            { role: 'user', content: 'BP is rising' },
        ]);
        // Per-persona LLM routing (post-v2.1.0): only the template id is
        // forwarded. The server reads the template's llm_provider /
        // llm_model / llm_api_key / llm_endpoint from the DB. The client
        // never sends those fields — see the comment in
        // AgentService.sendAgentMessage for the security reason.
        expect(llmReq.body.agent_llm_config).toEqual({ agent_template_id: 'tpl-1' });
        expect(llmReq.body.agent_llm_config).not.toHaveProperty('provider');
        expect(llmReq.body.agent_llm_config).not.toHaveProperty('model');
        expect(llmReq.body.agent_llm_config).not.toHaveProperty('api_key');
        expect(llmReq.body.agent_llm_config).not.toHaveProperty('endpoint');
        expect(llmReq.headers.authorization).toBe(`Bearer ${BEARER}`);
    });

    it('falls back to agent.id when agent_template_id is missing', async () => {
        // CONTRACT: case_agents rows expose agent_template_id; raw templates
        // expose only `id`. Either way, the dispatched payload carries one
        // resolvable id so the server can look up the LLM config.
        const agent = {
            id: 'tpl-bare',
            agent_type: 'consultant',
            name: 'Dr. Lin',
            system_prompt: 'You are a consultant.',
        };
        await AgentService.sendAgentMessage(
            'sess-1', agent, 'hi', null, [], null, [],
        );
        const llmReq = lastRequest({ method: 'POST', pathEndsWith: '/api/proxy/llm' });
        expect(llmReq.body.agent_llm_config).toEqual({ agent_template_id: 'tpl-bare' });
    });

    it('LLM API failure: returns user-facing error string (does not throw)', async () => {
        // Force /proxy/llm to fail. addMessage still succeeds.
        server.use(http.post('*/api/proxy/llm', () => errJson('upstream blew up', 500)));
        const agent = {
            agent_type: 'nurse',
            name: 'Nurse Joy',
            system_prompt: 'You are a nurse.',
        };
        const out = await AgentService.sendAgentMessage(
            'sess-1', agent, 'hi', null, [], null, [],
        );
        // CONTRACT: sendAgentMessage swallows errors and returns a "Error: ..."
        // string so the chat UI can render it inline as an assistant turn.
        expect(out).toMatch(/^Error: Could not communicate with Nurse Joy/);
    });
});
