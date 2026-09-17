// RPS-1 §11a.2a — array-aware learner projection paths and conditional strips.
//
// Regression lock: the PACS manifest declared `learnerOmit: ['rubric']`, but
// the PACS document is `{ version, worklist[] }` with the rubric on each
// worklist entry. `omitPath` only walked dotted object paths, so the server
// stripped nothing and every PACS answer key — and every report the author had
// deliberately NOT released — reached the learner's network payload on
// GET /cases, GET /cases/:id and the session snapshot.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import {
    omitDocumentPath, omitDocumentWhen, projectPluginDocumentsForRole, projectCaseSnapshotForRole,
    learnerOmitPaths, learnerOmitWhenRules,
} from '../../server/shared/pluginDocument.js';
// Loaded for its side effect: it registers the core verb names
// validateManifest checks `vocabulary.coreVerbs` against (setCoreVerbNames).
// Without it room3d's PERFORMED_PHYSICAL_EXAM reads as unknown — the same
// order the server boots in.
import '../../server/shared/learningVerbs.js';
import { parseDocumentPath, validateManifest } from '../../server/shared/pluginRegistry.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';

const RUBRIC_SECRET = 'RUBRIC-SECRET-saddle-pulmonary-embolus';
const WITHHELD_FINDINGS = 'WITHHELD-FINDINGS-filling-defect';
const WITHHELD_IMPRESSION = 'WITHHELD-IMPRESSION-acute-PE';
const RELEASED_FINDINGS = 'RELEASED-FINDINGS-clear-lungs';

const pacsDoc = () => ({
    version: 1,
    worklist: [
        {
            id: 'ctpa', studyId: 'ct_chest_pe', description: 'CTPA',
            baseline: { kind: 'archive', ref: 'normal-ctpa' },
            substitutions: [],
            report: { findings: WITHHELD_FINDINGS, impression: WITHHELD_IMPRESSION, reportedBy: 'Dr Withheld', released: false },
            rubric: { expected: [RUBRIC_SECRET], keyImages: [12] },
        },
        {
            id: 'cxr', studyId: 'cxr_pa', description: 'CXR',
            baseline: { kind: 'archive', ref: 'normal-cxr' },
            substitutions: [],
            report: { findings: RELEASED_FINDINGS, impression: 'Normal', reportedBy: 'Dr Released', released: true },
        },
    ],
});

const deepCopy = (value) => JSON.parse(JSON.stringify(value));

describe('parseDocumentPath — the learnerOmit grammar', () => {
    it('parses dotted and [] segments', () => {
        expect(parseDocumentPath('rubric')).toEqual([{ key: 'rubric', each: false }]);
        expect(parseDocumentPath('manifest.answers')).toEqual([{ key: 'manifest', each: false }, { key: 'answers', each: false }]);
        expect(parseDocumentPath('worklist[].rubric')).toEqual([{ key: 'worklist', each: true }, { key: 'rubric', each: false }]);
        expect(parseDocumentPath('a[].b[].c')).toEqual([{ key: 'a', each: true }, { key: 'b', each: true }, { key: 'c', each: false }]);
    });

    it('rejects malformed paths', () => {
        for (const bad of ['', '[]', 'a[]b', 'a..b', '.a', 'a.', 'a[][]', 'a[0].b', 'a b', 42, null, undefined]) {
            expect(parseDocumentPath(bad), String(bad)).toBeNull();
        }
    });
});

describe('omitDocumentPath / omitDocumentWhen', () => {
    it('keeps plain dotted paths working unchanged', () => {
        expect(omitDocumentPath({ a: 1, rubric: 2 }, 'rubric')).toEqual({ a: 1 });
        expect(omitDocumentPath({ manifest: { answers: [1], id: 'x' } }, 'manifest.answers')).toEqual({ manifest: { id: 'x' } });
    });

    it('strips inside every element, including nested arrays', () => {
        const doc = { a: [{ b: [{ c: 1, keep: 1 }, { c: 2 }], keep: true }, { keep: false }] };
        expect(omitDocumentPath(doc, 'a[].b[].c')).toEqual({ a: [{ b: [{ keep: 1 }, {}], keep: true }, { keep: false }] });
    });

    it('missing keys, non-arrays under [] and non-object elements are left alone (same reference)', () => {
        const noList = { version: 1 };
        expect(omitDocumentPath(noList, 'worklist[].rubric')).toBe(noList);
        const notArray = { worklist: { rubric: 1 } };
        expect(omitDocumentPath(notArray, 'worklist[].rubric')).toBe(notArray);
        const scalars = { worklist: [1, 'two', null, [3]] };
        expect(omitDocumentPath(scalars, 'worklist[].rubric')).toBe(scalars);
        const mixed = { worklist: [1, { rubric: 'x', id: 'y' }] };
        expect(omitDocumentPath(mixed, 'worklist[].rubric')).toEqual({ worklist: [1, { id: 'y' }] });
    });

    it('never mutates its input, and shares untouched branches', () => {
        const doc = pacsDoc();
        const before = deepCopy(doc);
        const stripped = omitDocumentPath(doc, 'worklist[].rubric');
        const withheld = omitDocumentWhen(stripped, { path: 'worklist[].report', when: { released: false }, omit: ['findings', 'impression', 'reportedBy'] });
        expect(doc).toEqual(before);
        expect(stripped.worklist[1]).toBe(doc.worklist[1]);                   // no rubric there: not cloned
        expect(withheld.worklist[0].report).toEqual({ released: false });
        expect(withheld.worklist[1].report).toBe(doc.worklist[1].report);     // released: untouched
    });

    it('a when rule matches strictly (absent or non-false released is not withheld)', () => {
        const rule = { path: 'worklist[].report', when: { released: false }, omit: ['findings'] };
        const doc = { worklist: [{ report: { findings: 'a' } }, { report: { findings: 'b', released: 'false' } }] };
        expect(omitDocumentWhen(doc, rule)).toBe(doc);
    });
});

// Regression lock: the strippers fail OPEN on a malformed rule — an
// unparseable learnerOmit path or learnerOmitWhen rule strips nothing, and a
// non-string entry is filtered out before it is even tried, so the answer key
// ships with no error. pluginDocument.js is under server/shared/ (imported by a
// client-project test too), so it takes no server logger; this test is the
// guard. Every SHIPPED manifest must validate, and every rule it declares must
// reach the stripper intact and parse.
describe('every shipped manifest carries strip rules the stripper can apply', () => {
    it('has manifests to check', () => {
        expect(PLUGIN_MANIFESTS.length).toBeGreaterThan(0);
    });

    it.each(PLUGIN_MANIFESTS.map((m) => [m.id, m]))('%s passes validateManifest', (_id, manifest) => {
        expect(() => validateManifest(manifest)).not.toThrow();
    });

    it.each(PLUGIN_MANIFESTS.map((m) => [m.id, m]))('%s learnerOmit paths all parse and none is dropped', (_id, manifest) => {
        const declared = manifest.document?.learnerOmit ?? [];
        expect(learnerOmitPaths(manifest)).toHaveLength(declared.length);
        for (const path of declared) {
            const steps = parseDocumentPath(path);
            expect(steps, String(path)).not.toBeNull();
            expect(steps.at(-1).each, String(path)).toBe(false);
        }
    });

    it.each(PLUGIN_MANIFESTS.map((m) => [m.id, m]))('%s learnerOmitWhen rules all parse and none is dropped', (_id, manifest) => {
        const declared = manifest.document?.learnerOmitWhen ?? [];
        expect(learnerOmitWhenRules(manifest)).toHaveLength(declared.length);
        for (const rule of declared) {
            expect(parseDocumentPath(rule.path), JSON.stringify(rule)).not.toBeNull();
            expect(Array.isArray(rule.omit) && rule.omit.length > 0, JSON.stringify(rule)).toBe(true);
            expect(rule.when && typeof rule.when === 'object' && !Array.isArray(rule.when), JSON.stringify(rule)).toBe(true);
        }
    });

    it('at least one shipped manifest declares strip rules, so the checks above are not vacuous', () => {
        expect(PLUGIN_MANIFESTS.some((m) => (m.document?.learnerOmit ?? []).length > 0)).toBe(true);
        expect(PLUGIN_MANIFESTS.some((m) => (m.document?.learnerOmitWhen ?? []).length > 0)).toBe(true);
    });
});

describe('the manifest validator accepts the path syntax and the when rules', () => {
    const pacs = PLUGIN_MANIFESTS.find((m) => m.id === 'pacs');
    const withDocument = (document) => validateManifest({ ...pacs, document });

    it('accepts array paths and well-formed when rules', () => {
        expect(() => withDocument({ learnerOmit: ['rubric', 'worklist[].rubric', 'a[].b[].c'] })).not.toThrow();
        expect(() => withDocument({ learnerOmitWhen: [{ path: 'worklist[].report', when: { released: false }, omit: ['findings'] }] })).not.toThrow();
    });

    it('rejects malformed paths and rules', () => {
        for (const bad of ['[]', 'a[]b', 'a..b', 'worklist[]']) {
            expect(() => withDocument({ learnerOmit: [bad] }), bad).toThrow(/learnerOmit/);
        }
        const rule = { path: 'worklist[].report', when: { released: false }, omit: ['findings'] };
        for (const bad of [
            [], {}, [{ ...rule, path: 'a..b' }], [{ ...rule, when: {} }], [{ ...rule, when: { released: { no: 1 } } }],
            [{ ...rule, omit: [] }], [{ ...rule, omit: ['a.b'] }], [{ ...rule, extra: 1 }], [{ path: rule.path, omit: rule.omit }],
        ]) {
            expect(() => withDocument({ learnerOmitWhen: bad }), JSON.stringify(bad)).toThrow(/learnerOmitWhen/);
        }
    });

    it('PACS declares the worklist rubric and the unreleased report', () => {
        expect(pacs.document.learnerOmit).toEqual(['rubric', 'worklist[].rubric']);
        expect(pacs.document.learnerOmitWhen).toEqual([
            { path: 'worklist[].report', when: { released: false }, omit: ['findings', 'impression', 'reportedBy'] },
        ]);
    });

    it('projectPluginDocumentsForRole strips PACS for students only, and snapshots round-trip', () => {
        const config = { pacs: pacsDoc() };
        const before = deepCopy(config);
        const text = JSON.stringify(projectPluginDocumentsForRole(config, PLUGIN_MANIFESTS, 'student'));
        expect(text).not.toContain(RUBRIC_SECRET);
        expect(text).not.toContain(WITHHELD_FINDINGS);
        expect(text).not.toContain(WITHHELD_IMPRESSION);
        expect(text).toContain(RELEASED_FINDINGS);
        expect(config).toEqual(before);
        for (const role of ['reviewer', 'educator', 'admin']) {
            expect(projectPluginDocumentsForRole(config, PLUGIN_MANIFESTS, role)).toBe(config);
        }
        const snap = JSON.stringify({ config });
        expect(projectCaseSnapshotForRole(snap, PLUGIN_MANIFESTS, 'student')).not.toContain(RUBRIC_SECRET);
    });
});

async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

function dbRun(dbPath, sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (openErr) => {
            if (openErr) return reject(openErr);
            db.run(sql, params, function done(err) { db.close(() => (err ? reject(err) : resolve(this))); });
        });
    });
}

describe('live server: a STUDENT never receives the PACS rubric or an unreleased report', () => {
    let server;
    const as = {};
    let caseId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const hash = await bcrypt.hash('Passw0rd!', 4);
        for (const role of ['student', 'reviewer', 'educator']) {
            await dbRun(server.dbPath,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status) VALUES (?, ?, ?, ?, ?, 1, 'active')`,
                [`pacs-${role}`, `pacs-${role}`, `pacs-${role}@example.com`, hash, role]);
        }
        const authed = (token) => (path, init = {}) => fetch(`${server.baseUrl}${path}`, {
            ...init,
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
        });
        as.admin = authed(await login(server.baseUrl, 'admin', 'admin123'));
        as.student = authed(await login(server.baseUrl, 'pacs-student', 'Passw0rd!'));
        as.reviewer = authed(await login(server.baseUrl, 'pacs-reviewer', 'Passw0rd!'));
        as.educator = authed(await login(server.baseUrl, 'pacs-educator', 'Passw0rd!'));

        const created = await as.admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({
                name: 'pacs-projection-case', description: 'lock', system_prompt: 'You are a patient.',
                config: { demographics: { gender: 'Male', age: 60 }, patient_name: 'P', pacs: pacsDoc() },
            }),
        });
        expect(created.status).toBe(200);
        caseId = (await created.json()).id;
        expect((await as.admin(`/api/cases/${caseId}/availability`, { method: 'PUT', body: JSON.stringify({ is_available: true }) })).status).toBe(200);
    }, 90_000);

    afterAll(async () => { if (server) await server.close(); });

    const expectStripped = (text) => {
        expect(text).not.toContain(RUBRIC_SECRET);
        expect(text).not.toContain(WITHHELD_FINDINGS);
        expect(text).not.toContain(WITHHELD_IMPRESSION);
        expect(text).toContain(RELEASED_FINDINGS);
    };
    const expectWhole = (text) => {
        expect(text).toContain(RUBRIC_SECRET);
        expect(text).toContain(WITHHELD_FINDINGS);
        expect(text).toContain(WITHHELD_IMPRESSION);
    };

    it('GET /api/cases/:id and GET /api/cases', async () => {
        const one = await as.student(`/api/cases/${caseId}`);
        expect(one.status).toBe(200);
        const body = await one.json();
        expect(body.config.pacs.worklist).toHaveLength(2);
        expect(body.config.pacs.worklist[0].report).toEqual({ released: false });
        expectStripped(JSON.stringify(body));

        const list = await as.student('/api/cases');
        expect(list.status).toBe(200);
        const listed = (await list.json()).cases.find((c) => c.id === caseId);
        expect(listed).toBeTruthy();
        expectStripped(JSON.stringify(listed));

        for (const role of ['reviewer', 'educator']) {
            const staff = await as[role](`/api/cases/${caseId}`);
            expect(staff.status, role).toBe(200);
            expectWhole(JSON.stringify(await staff.json()));
        }
    });

    it('the session snapshot a student is pinned to', async () => {
        const start = await as.student('/api/sessions', { method: 'POST', body: JSON.stringify({ case_id: caseId }) });
        expect(start.status).toBe(200);
        const { id: sessionId } = await start.json();

        const own = await as.student(`/api/sessions/${sessionId}`);
        expect(own.status).toBe(200);
        const ownText = JSON.stringify(await own.json());
        expect(ownText).toContain('worklist');
        expectStripped(ownText);

        const detail = await as.student(`/api/analytics/sessions/${sessionId}`);
        expect(detail.status).toBe(200);
        expectStripped(JSON.stringify(await detail.json()));

        const staff = await as.admin(`/api/sessions/${sessionId}`);
        expect(staff.status).toBe(200);
        expectWhole(JSON.stringify(await staff.json()));
    });
});
