// What an agent knows about the case — end to end, browser to compiled prompt.
//
// `config.knowledge` ({ scope, answerKey, record }, server/shared/agentKnowledge.js)
// decides what the server puts in an agent's prompt before the conversation
// starts. The vitest suite covers the builders and the route; this spec covers
// the two things only a real browser against a real server can show:
//
//   1. The educator's path. The settings block is reachable, renders what is
//      STORED, and a save survives a reopen. A control that writes a value
//      nothing reads is exactly the defect this feature replaced — the old
//      per-case `context_filter` select was stored and never read — so
//      "it persisted and came back" is the assertion that matters.
//
//   2. The learner's path, as the MODEL sees it. A recording LLM stands in for
//      the provider and the platform is pointed at it, so every assertion below
//      is made against the literal system prompt the server sent upstream —
//      not against an intermediate the test constructed. That is the only
//      place the whole stack is visible at once: browser → client situation →
//      knowledge resolution → server-built brief → assembled prompt.
//
// Design notes, following the conventions in case-lifecycle.spec.js:
//   - ONE admin token per spec. Each `loginAs` is a real login and the server
//     caps 10 per 15 min per IP; a token per test cascade-429s the run.
//   - Heavy UI is driven through the UI where the UI IS the subject (the
//     settings block). The conversation turn goes through the same endpoint
//     the client posts to, because what is under test is the prompt the server
//     assembles, not the chat transcript widget.
//   - Every row this spec writes is tagged `e2e-know-<ts>` so it cannot
//     collide with another spec on the shared e2e database.
//   - Test titles are a public interface (Prova pins them, see
//     playwright.config.js). Renaming one breaks that link.

import { test, expect, waitForSeed } from './fixtures/index.js';
import { request as pwRequest } from '@playwright/test';
import { loginAs } from './fixtures/auth.js';
import http from 'node:http';

const RUN_TAG = `e2e-know-${Date.now()}`;

// --- shared admin context (see header) --------------------------------------
let _adminCtx;
async function adminCtx(baseURL) {
    if (!_adminCtx) {
        const { token } = await loginAs(baseURL, 'admin');
        _adminCtx = await pwRequest.newContext({
            baseURL,
            extraHTTPHeaders: { Authorization: `Bearer ${token}` },
        });
    }
    return _adminCtx;
}

// --- the recording LLM ------------------------------------------------------
// Stands in for the provider so the spec can read the system prompt the SERVER
// sent, which is the only view of the fully assembled prompt. Same shape as the
// helper the vitest server suite uses.
function startRecordingLlm() {
    const bodies = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            try { bodies.push(JSON.parse(raw || '{}')); } catch { bodies.push({ unparsed: raw }); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                choices: [{ message: { role: 'assistant', content: 'Understood.' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }));
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                baseUrl: `http://127.0.0.1:${port}/v1`,
                bodies,
                close: () => new Promise((r) => server.close(r)),
            });
        });
    });
}

let llm;

// The system prompt as the provider received it, for the most recent call.
const systemTextOf = (body) => (body?.messages || [])
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');

// --- fixtures written once for the whole spec -------------------------------
let caseId;
let sessionId;
let nurseAgentId;
let consultantAgentId;
let specialistAgentId;
let patientAgentId;   // attached so the panel can be checked against it
let nurseName;
let consultantName;
let specialistName;
let patientName;

const DIAGNOSIS = 'Anterior STEMI';
const HPI = 'two hours of crushing retrosternal pain';
const RECORD_ITEM = 'Troponin I';

test.beforeAll(async ({ baseURL }) => {
    await waitForSeed(baseURL);
    const api = await adminCtx(baseURL);

    llm = await startRecordingLlm();
    const llmRes = await api.put('/api/platform-settings/llm', {
        data: { provider: 'custom', baseUrl: llm.baseUrl, model: 'test-model', enabled: true, apiKey: 'e2e' },
    });
    expect(llmRes.ok(), 'point the platform at the recording LLM').toBeTruthy();

    // A case with a real patient, a real reason for presentation, and an
    // answer key — so every scope has something it must and must not carry.
    const caseRes = await api.post('/api/cases', {
        data: {
            name: `${RUN_TAG} chest pain`,
            description: 'knowledge-axis fixture',
            system_prompt: 'You are the patient.',
            patient_name: 'Ada Example',
            patient_age: 54,
            patient_gender: 'Female',
            chief_complaint: 'central chest pain',
            config: {
                patient_name: 'Ada Example',
                demographics: { age: 54, gender: 'Female' },
                structuredHistory: { chiefComplaint: 'central chest pain', hpi: HPI },
                diagnosis: DIAGNOSIS,
                treatment_plan: 'Primary PCI',
                learning_objectives: ['recognise STEMI'],
                initialVitals: { hr: 118, bpSys: 90, bpDia: 60, spo2: 91 },
            },
        },
    });
    expect(caseRes.ok(), await caseRes.text()).toBeTruthy();
    caseId = (await caseRes.json()).id;
    expect(Number.isInteger(caseId), 'fixture case id').toBeTruthy();

    // Attach one of each type we care about.
    // Attach one of each type we care about, and remember the DISPLAY NAME the
    // template actually carries. Hardcoding persona names here is how a spec
    // comes to hunt for "Default Patient" while the seeder handed it "Default
    // Female Patient" — a locator that then times out against a perfectly
    // correct page.
    const templates = await (await api.get('/api/agents/templates')).json();
    const attach = async (type) => {
        const tpl = templates.templates.find((t) => t.agent_type === type);
        expect(tpl, `no seeded template for ${type}`).toBeTruthy();
        const res = await api.post(`/api/cases/${caseId}/agents`, {
            data: { agent_template_id: tpl.id, enabled: true },
        });
        expect(res.ok(), `attach ${type}: ${await res.text()}`).toBeTruthy();
        return { id: (await res.json()).id, name: tpl.name };
    };
    ({ id: nurseAgentId, name: nurseName } = await attach('nurse'));
    ({ id: consultantAgentId, name: consultantName } = await attach('consultant'));
    ({ id: specialistAgentId, name: specialistName } = await attach('cardiologist'));
    ({ id: patientAgentId, name: patientName } = await attach('patient'));
    expect(Number.isInteger(patientAgentId)).toBeTruthy();

    // A session on that case, with something the learner did, so the
    // encounter-record gate has a record to gate.
    const sessRes = await api.post('/api/sessions', {
        data: { case_id: caseId, student_name: `${RUN_TAG}-learner` },
    });
    expect(sessRes.ok(), await sessRes.text()).toBeTruthy();
    sessionId = (await sessRes.json()).id;

    // POST /api/patient-record/sync is the endpoint the client's PatientRecord
    // subsystem posts to; `events[].id` and `.time` are its field names, not
    // the column names they land in.
    const recRes = await api.post('/api/patient-record/sync', {
        data: {
            session_id: sessionId,
            record_id: `${RUN_TAG}-rec`,
            events: [{
                id: `${RUN_TAG}-evt-1`, verb: 'ORDERED', time: 4,
                category: 'lab', item: RECORD_ITEM, content: RECORD_ITEM,
            }],
            // The same call upserts patient_record_documents, whose
            // patient_info column is NOT NULL — omitting these makes the whole
            // sync fail with a constraint error rather than just skipping the
            // document.
            patient_info: { name: 'Ada Example', age: 54, gender: 'Female' },
            current_state: { vitals: { hr: 118, spo2: 91 } },
            events_count: 1,
            document: { record_id: `${RUN_TAG}-rec` },
        },
    });
    expect(recRes.ok(), `seed the encounter record: ${await recRes.text()}`).toBeTruthy();

    // Live observations, as the monitor persists them.
    await api.post(`/api/sessions/${sessionId}/vitals`, {
        data: { elapsed_ms: 60000, hr: 118, spo2: 91, bp_sys: 90, bp_dia: 60, source: 'monitor' },
    });
});

test.afterAll(async () => {
    if (_adminCtx) await _adminCtx.dispose();
    _adminCtx = null;
    if (llm) await llm.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set an agent's knowledge straight through the API the editor PUTs to. */
async function setKnowledge(baseURL, agentId, knowledge) {
    const api = await adminCtx(baseURL);
    const res = await api.put(`/api/cases/${caseId}/agents/${agentId}`, {
        data: { config_override: { knowledge } },
    });
    expect(res.ok(), `set knowledge ${JSON.stringify(knowledge)}: ${await res.text()}`).toBeTruthy();
}

/**
 * Speak to a team agent and return the system prompt the SERVER sent upstream.
 *
 * The body is the one AgentService posts: a case agent id, and a situation
 * assembled from the whole case. Whether any of that situation survives is
 * precisely what the knowledge scope decides, so the situation deliberately
 * carries everything — diagnosis included.
 */
const FAT_SITUATION = [
    '=== CASE CONTEXT ===',
    '### Summary',
    'Patient: Ada Example',
    '### Structured History',
    `History of Present Illness: ${HPI}`,
    '### Authoring Expectations',
    `- Expected diagnosis: ${DIAGNOSIS}`,
    '=== END CONTEXT ===',
    '',
    '=== CURRENT VITALS ===',
    'HR: 90bpm',
].join('\n');

async function promptSentFor(baseURL, agentId) {
    const api = await adminCtx(baseURL);
    const before = llm.bodies.length;
    const res = await api.post('/api/proxy/llm', {
        data: {
            session_id: sessionId,
            messages: [{ role: 'user', content: 'Can you come and see this patient?' }],
            system_prompt: FAT_SITUATION,
            agent_llm_config: { case_agent_id: agentId },
        },
    });
    expect(res.ok(), `proxy/llm: ${await res.text()}`).toBeTruthy();
    expect(llm.bodies.length, 'the recording LLM received the call').toBe(before + 1);
    return systemTextOf(llm.bodies.at(-1));
}

/**
 * Drive the real settings UI to an agent's case-override panel.
 *
 * Anchored on the settings menu button, not on a username badge: this build's
 * header shows the PATIENT, not the logged-in user, so waiting for "admin" to
 * appear waits forever on a perfectly healthy page. (The spec that helper was
 * borrowed from is itself skipped, which is why the staleness had gone
 * unnoticed.)
 *
 * Every locator below is anchored on visible text AND on the control it must
 * contain, rather than on position. `.first()`/`.last()` over a bare tag
 * selector picks whichever nested div happens to match, which is the classic
 * way an e2e spec passes for the wrong reason.
 */
async function openOverrides(page, agentName) {
    // The first-run TOUR is a modal that covers the whole app and swallows
    // every click. globalSetup completes the platform-setup wizard and the
    // student welcome page, but not this — it is gated on localStorage, per
    // role, per TOUR_VERSION (src/help/useOnboarding.js), so it has to be
    // marked done BEFORE the app mounts rather than after navigation.
    await page.addInitScript(() => {
        try {
            for (const role of ['admin', 'educator', 'student']) {
                window.localStorage.setItem(`rohy.onboarding.${role}.v1`, 'done');
            }
            // The case editor auto-resumes from this stash. Left behind by a
            // previous visit it reopens the wizard mid-flight, so the Cases
            // LIST never renders and the row locator below waits forever. A
            // helper that has to be called twice in one test has to start from
            // the same place both times.
            window.localStorage.removeItem('rohy_editing_case');
        } catch { /* private mode — the tour just re-shows and the spec says so */ }
    });
    await page.goto('/');

    // Reaching the Cases list is the same INTENT from three different states:
    // the simulation view (top bar carries the menu), the settings panel on
    // another tab (sidebar carries Cases), or the settings panel already on
    // Cases. Which one you land in depends on what the previous visit left
    // behind, and the app can swap between them mid-frame while React
    // hydrates — a single instant check of one button races that and clicks a
    // node that is about to unmount. `toPass` retries the whole approach until
    // the goal state holds.
    const casesList = page.getByRole('heading', { name: /Manage Cases/i });
    const menu = page.getByRole('button', { name: /settings and profile menu/i });
    const sidebarCases = page.getByRole('button', { name: /^Cases$/i });

    await expect(async () => {
        if (await casesList.isVisible()) return;
        if (await menu.isVisible()) {
            await menu.click();
            await page.getByRole('menuitem', { name: /^Cases$/i }).click();
        } else if (await sidebarCases.first().isVisible()) {
            await sidebarCases.first().click();
        }
        await expect(casesList).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });

    // The fixture case's own row — never "the first row", which is whatever
    // the seeder happened to create.
    const caseRow = page.locator('div, li, tr')
        .filter({ hasText: `${RUN_TAG} chest pain` })
        .filter({ has: page.getByRole('button', { name: /^Edit$/i }) })
        .last();
    await caseRow.getByRole('button', { name: /^Edit$/i }).first().click();

    // The wizard step. There is also an "Agents" entry in the settings
    // sidebar (the template library); the emoji disambiguates.
    await page.getByRole('button', { name: /Agents/i }).filter({ hasText: '🤖' }).first().click();

    const card = page.locator('div, li')
        .filter({ hasText: agentName })
        .filter({ has: page.getByRole('button', { name: /Case overrides/i }) })
        .last();
    await card.getByRole('button', { name: /Case overrides/i }).first().click();

    await expect(page.getByRole('heading', { name: new RegExp(`Edit Agent: ${agentName}`, 'i') }))
        .toBeVisible({ timeout: 10_000 });
}

/**
 * Choose a scope and SAVE, confirming each step held.
 *
 * The confirmation is not decoration. `selectOption` followed straight away by
 * a click can outrun React's controlled select under load, and the save then
 * writes the value that was already there — a test that passes in isolation and
 * fails in a full run, reporting the old scope as though the feature were
 * broken. Asserting the control's value between the two turns that race into a
 * wait.
 */
async function chooseScopeAndSave(page, scope) {
    await scopeSelect(page).selectOption(scope);
    await expect(scopeSelect(page)).toHaveValue(scope);
    await page.getByRole('button', { name: /Save Changes/i }).click();
}

/** The knowledge the SERVER holds for an agent, polled until the PUT lands. */
async function storedKnowledge(baseURL, agentId) {
    const api = await adminCtx(baseURL);
    let cfg;
    await expect.poll(async () => {
        const agents = await (await api.get(`/api/cases/${caseId}/agents`)).json();
        cfg = agents.agents.find((a) => a.id === agentId)?.config;
        return cfg?.knowledge?.scope;
    }, { timeout: 10_000 }).toBeTruthy();
    return cfg;
}

const knowledgePanel = (page) => page.getByText('What this agent knows about the case');
const scopeSelect = (page) => page.locator('select').filter({ has: page.locator('option[value="handover"]') });
// Each control is found through the label that names it, so a block growing
// another checkbox cannot silently re-point these at the wrong input.
const answerKeyBox = (page) => page.locator('label')
    .filter({ hasText: 'Also give it the expected diagnosis' })
    .locator('input[type="checkbox"]');
const recordBox = (page) => page.locator('label')
    .filter({ hasText: 'Tell it what the learner has done' })
    .locator('input[type="checkbox"]');

// ---------------------------------------------------------------------------
// 1. The educator's path — the settings block
// ---------------------------------------------------------------------------

test.describe('the knowledge block in the case editor', () => {
    test('renders for a nurse and shows the value that is stored, not the shipped default', async ({ adminPage, baseURL }) => {
        await setKnowledge(baseURL, nurseAgentId, { scope: 'handover', answerKey: false, record: true });
        await openOverrides(adminPage, nurseName);

        await expect(knowledgePanel(adminPage)).toBeVisible();
        // `handover`, not the nurse's shipped `chart`.
        await expect(scopeSelect(adminPage)).toHaveValue('handover');
    });

    test('does not render for an on-call specialist, whose own disclosure gate is the control', async ({ adminPage }) => {
        // A specialist is `none` by definition: the server drops the client
        // situation and builds a findings-only brief. A scope dropdown here
        // would be a setting that changes nothing.
        await openOverrides(adminPage, specialistName);
        await expect(adminPage.getByText('On-call specialist')).toBeVisible();
        await expect(knowledgePanel(adminPage)).toHaveCount(0);
    });

    test('does not render for the patient, whose prompt is built by another path', async ({ adminPage }) => {
        await openOverrides(adminPage, patientName);
        await expect(knowledgePanel(adminPage)).toHaveCount(0);
    });

    test('a scope chosen in the UI survives a save and a reopen', async ({ adminPage, baseURL }) => {
        // The assertion that matters. The control this replaced was written to
        // the database and read by nothing, and it looked correct on reopen
        // because the panel echoed its own staged value. Reopening from a cold
        // page load is what tells the two apart.
        await setKnowledge(baseURL, consultantAgentId, { scope: 'chart', answerKey: false, record: true });
        await openOverrides(adminPage, consultantName);
        await chooseScopeAndSave(adminPage, 'none');

        await openOverrides(adminPage, consultantName);
        await expect(scopeSelect(adminPage)).toHaveValue('none');

        // And it is what the SERVER holds, not only what the panel redraws.
        expect((await storedKnowledge(baseURL, consultantAgentId)).knowledge)
            .toMatchObject({ scope: 'none' });
    });

    test('choosing "knows nothing" clears the encounter-record toggle', async ({ adminPage, baseURL }) => {
        // An agent told nothing about the patient, then handed the full list of
        // everything ordered and given, is a contradiction the learner cannot
        // see. The two stay independent in the data; the editor stops you
        // walking into it by accident.
        await setKnowledge(baseURL, nurseAgentId, { scope: 'chart', answerKey: false, record: true });
        await openOverrides(adminPage, nurseName);

        await expect(recordBox(adminPage)).toBeChecked();
        await scopeSelect(adminPage).selectOption('none');
        await expect(recordBox(adminPage)).not.toBeChecked();
    });

    test('the expected-diagnosis toggle is disabled below the chart scope', async ({ adminPage, baseURL }) => {
        await setKnowledge(baseURL, nurseAgentId, { scope: 'chart', answerKey: false, record: true });
        await openOverrides(adminPage, nurseName);

        await expect(answerKeyBox(adminPage)).toBeEnabled();
        await scopeSelect(adminPage).selectOption('history');
        await expect(answerKeyBox(adminPage)).toBeDisabled();
    });

    test('a save keeps config keys the panel does not edit', async ({ adminPage, baseURL }) => {
        // config_override is a FULL REPLACE server-side. v2.9.98's
        // show_encounter_record vanished on the next save of any field because
        // the blob was rebuilt from the controls alone.
        await setKnowledge(baseURL, nurseAgentId, { scope: 'chart', answerKey: false, record: true });
        await openOverrides(adminPage, nurseName);
        await chooseScopeAndSave(adminPage, 'summary');

        const cfg = await storedKnowledge(baseURL, nurseAgentId);
        expect(cfg.knowledge).toMatchObject({ scope: 'summary' });
        expect(cfg.voice, 'a key no control here knows about').toBeTruthy();
        expect(Array.isArray(cfg.dos), 'the authored dos survive the save').toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// 2. The learner's path — the prompt the model actually received
// ---------------------------------------------------------------------------

test.describe('the compiled prompt, as the model receives it', () => {
    test('scope "chart" keeps the client situation and withholds the answer key', async ({ baseURL }) => {
        await setKnowledge(baseURL, nurseAgentId, { scope: 'chart', answerKey: false, record: true });
        const system = await promptSentFor(baseURL, nurseAgentId);

        expect(system).toContain('## ROLE');
        expect(system).toContain('--- CURRENT SITUATION ---');
        expect(system).toContain(HPI);
        // The situation carried the diagnosis and it is still there, because
        // at `chart` the browser's block is passed through untouched — the
        // answer key is filtered where the browser BUILDS it. What this asserts
        // is that the server does not add one, and does not drop the situation.
        expect(system).not.toContain('## WHAT YOU KNOW (server)');
        expect(system).not.toContain('## HANDOVER (server)');
    });

    test('scope "none" drops the whole client situation and says the agent knows nothing', async ({ baseURL }) => {
        await setKnowledge(baseURL, consultantAgentId, { scope: 'none', answerKey: false, record: false });
        const system = await promptSentFor(baseURL, consultantAgentId);

        expect(system).toContain('## WHAT YOU KNOW (server)');
        expect(system).toMatch(/nobody has briefed you on them/i);
        expect(system).toMatch(/never fill a gap with what a case like this usually looks like/i);

        // Not one word of what the browser sent.
        expect(system).not.toContain('--- CURRENT SITUATION ---');
        expect(system).not.toContain('=== CASE CONTEXT ===');
        expect(system).not.toContain(DIAGNOSIS);
        expect(system).not.toContain(HPI);
        expect(system).not.toContain('Ada Example');
        expect(system).not.toContain('HR: 90bpm');
    });

    test('scope "none" with the record off carries no action log either', async ({ baseURL }) => {
        await setKnowledge(baseURL, consultantAgentId, { scope: 'none', answerKey: false, record: false });
        const system = await promptSentFor(baseURL, consultantAgentId);
        expect(system).not.toContain('WHAT THE LEARNER ACTUALLY DID');
        expect(system).not.toContain(RECORD_ITEM);
    });

    test('scope "handover" carries identity and the vitals the SERVER read, not the browser\'s', async ({ baseURL }) => {
        await setKnowledge(baseURL, nurseAgentId, { scope: 'handover', answerKey: false, record: true });
        const system = await promptSentFor(baseURL, nurseAgentId);

        expect(system).toContain('## HANDOVER (server)');
        expect(system).toContain('Ada Example');
        expect(system).toContain('central chest pain');
        // From session_vitals. The browser sent "HR: 90bpm" and it is gone.
        expect(system).toContain('HR 118/min');
        expect(system).not.toContain('HR: 90bpm');
        // An unrecorded vital is absent, not invented as a zero.
        expect(system).not.toMatch(/EtCO2 0/);
        // Handed a patient, not a workup.
        expect(system).not.toContain(HPI);
        expect(system).not.toContain(DIAGNOSIS);
        expect(system).not.toContain('--- CURRENT SITUATION ---');
    });

    test('the encounter record follows knowledge.record, not only the type allowlist', async ({ baseURL }) => {
        // encounterRecord.js says a nurse MAY see it; the setting says whether
        // it DOES. Both directions, same agent, same session.
        await setKnowledge(baseURL, nurseAgentId, { scope: 'chart', answerKey: false, record: true });
        expect(await promptSentFor(baseURL, nurseAgentId)).toContain(RECORD_ITEM);

        await setKnowledge(baseURL, nurseAgentId, { scope: 'chart', answerKey: false, record: false });
        expect(await promptSentFor(baseURL, nurseAgentId)).not.toContain(RECORD_ITEM);
    });

    test('an on-call specialist is still briefed on findings and never on the patient', async ({ baseURL }) => {
        // The specialist path is unchanged by the knowledge axis; `none` is
        // simply what it always did. This is the regression lock on that.
        const system = await promptSentFor(baseURL, specialistAgentId);
        expect(system).toContain('## CASE BRIEF (server)');
        expect(system).toMatch(/You have not seen the patient/i);
        expect(system).not.toContain('--- CURRENT SITUATION ---');
        expect(system).not.toContain(DIAGNOSIS);
        expect(system).not.toContain(HPI);
    });

    test('the role anchor and the authored persona still lead every prompt', async ({ baseURL }) => {
        // The five-way order contract: anchor → persona → dos/donts → brief →
        // situation. A server-built brief must not displace the educator's text.
        await setKnowledge(baseURL, consultantAgentId, { scope: 'none', answerKey: false, record: false });
        const system = await promptSentFor(baseURL, consultantAgentId);

        const anchor = system.indexOf('## ROLE');
        const brief = system.indexOf('## WHAT YOU KNOW (server)');
        expect(anchor).toBeGreaterThanOrEqual(0);
        expect(brief).toBeGreaterThan(anchor);
        expect(system).toMatch(/You are: .*\./);
    });
});

// ---------------------------------------------------------------------------
// 3. Validation and the upgrade path
// ---------------------------------------------------------------------------

test.describe('the server refuses what it cannot honour', () => {
    test('an unknown scope is refused with invalid_knowledge and nothing is stored', async ({ baseURL }) => {
        const api = await adminCtx(baseURL);
        await setKnowledge(baseURL, nurseAgentId, { scope: 'chart', answerKey: false, record: true });

        const res = await api.put(`/api/cases/${caseId}/agents/${nurseAgentId}`, {
            data: { config_override: { knowledge: { scope: 'everything' } } },
        });
        expect(res.status()).toBe(400);
        expect((await res.json()).code).toBe('invalid_knowledge');

        const agents = await (await api.get(`/api/cases/${caseId}/agents`)).json();
        expect(agents.agents.find((a) => a.id === nurseAgentId)?.config?.knowledge)
            .toMatchObject({ scope: 'chart' });
    });

    test('an unknown knowledge field is refused rather than carried', async ({ baseURL }) => {
        // A stored setting that never fires is worse than no setting — the
        // lesson of `requireInterpretation`.
        const api = await adminCtx(baseURL);
        const res = await api.put(`/api/cases/${caseId}/agents/${nurseAgentId}`, {
            data: { config_override: { knowledge: { scope: 'none', revealDiagnosis: true } } },
        });
        expect(res.status()).toBe(400);
        expect((await res.json()).error).toMatch(/unknown knowledge field: revealDiagnosis/);
    });

    test('an agent with no stored knowledge keeps the behaviour its legacy column gave it', async ({ baseURL }) => {
        // The upgrade path. Clearing the override drops the agent back to the
        // template config; if that carried no knowledge either, the legacy
        // `context_filter` column decides, so nothing silently narrows on a
        // release. The seeded nurse ships `context_filter: 'full'`.
        const api = await adminCtx(baseURL);
        const clear = await api.put(`/api/cases/${caseId}/agents/${nurseAgentId}`, {
            data: { config_override: null },
        });
        expect(clear.ok()).toBeTruthy();

        const system = await promptSentFor(baseURL, nurseAgentId);
        // Still a full-chart agent: the situation is used, not replaced.
        expect(system).toContain('--- CURRENT SITUATION ---');
        expect(system).not.toContain('## WHAT YOU KNOW (server)');
        expect(system).not.toContain('## HANDOVER (server)');
    });
});
