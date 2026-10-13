// useReportProblem — the menu's three report rows driving the REAL vendored Prova widget (1.4.0), with only
// apiFetch faked. Locks: "Request a feature…" opens the dialog as a feature request and sends `kind: 'feature'`
// with no recent errors; "Report a problem…" always opens a problem report, even right after a feature
// request; several screenshots go as `screenshots: [...]` (never the old single `screenshot`); the dialog
// never asks for /report/subjects, a route Rohy does not mount; My reports' "Write to the team" opens the
// report's conversation from /reports/<id>/messages?seen=1 and a reply POSTs `{ body }` to /reports/<id>/messages.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../services/apiClient.js', () => ({ apiFetch: vi.fn() }));

const { apiFetch } = await import('../services/apiClient.js');
const { useReportProblem } = await import('./useReportProblem.js');
const { VERSION } = await import('../vendor/prova-report.js');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const threadPosts = () => apiFetch.mock.calls.filter(([url, init = {}]) => url.includes('/messages') && init.method === 'POST');
const sentBodies = () => apiFetch.mock.calls.filter(([url]) => url === '/report').map(([, init]) => JSON.parse(init.body));
const dialog = () => document.querySelector('[data-prova-dialog="report"]');

function type(text) {
    const what = document.querySelector('textarea[name="what_happened"]');
    what.value = text;
    what.dispatchEvent(new Event('input', { bubbles: true }));
}

function dropImages(files) {
    const drop = document.querySelector('[data-prova-drop]');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    drop.dispatchEvent(event);
}

async function send() {
    document.querySelector('[data-prova-send]').click();
    await waitFor(() => expect(document.querySelector('[data-prova-sent]')).not.toBeNull());
    document.querySelector('[data-prova-done]').click();
}

describe('useReportProblem with the vendored widget', () => {
    beforeEach(() => {
        let n = 0;
        apiFetch.mockImplementation(async (url, init = {}) => {
            if (url === '/report' && init.method === 'POST') { n += 1; return json(201, { id: `AR-${n}`, status: 'received' }); }
            if (url.startsWith('/reports/mine')) {
                return json(200, { reports: [{ id: 'AR-3', kind: 'problem', title: 'The monitor froze', status: 'received', reported_at: '2026-10-13T08:00:00Z', messages: 0, questions: 0, unread: 0 }], news: 0 });
            }
            if (url.startsWith('/reports/AR-3/messages') && init.method === 'POST') return json(201, { id: 42, from: 'you', kind: 'message', body: JSON.parse(init.body).body });
            if (url.startsWith('/reports/AR-3/messages')) return json(200, { id: 'AR-3', kind: 'problem', title: 'The monitor froze', status: 'received', can_reply: true, messages: [] });
            return json(404, { error: 'no such route' });
        });
        URL.createObjectURL = vi.fn(() => 'blob:shot');
        URL.revokeObjectURL = vi.fn();
    });
    afterEach(() => { document.querySelectorAll('[data-prova-report]').forEach((n) => n.remove()); });

    const mount = async () => {
        const hook = renderHook(() => useReportProblem({ username: 'beyza' }, () => 'Case 12 · chat', '3.0.0'));
        await waitFor(() => expect(hook.result.current.available).toBe(true));
        return hook;
    };

    it('vendors widget 1.4.0', () => {
        expect(VERSION).toBe('1.4.0');
    });

    it('Request a feature… sends kind "feature", no recent errors, and two screenshots as a list', async () => {
        const { result } = await mount();
        act(() => result.current.openFeature());
        expect(dialog().dataset.provaKindNow).toBe('feature');
        expect(document.querySelector('[data-prova-kind-choice="feature"]').getAttribute('aria-checked')).toBe('true');
        type('Let me pause the case clock while I read the labs');
        dropImages([new File(['a'.repeat(10)], 'one.png', { type: 'image/png' }), new File(['b'.repeat(20)], 'two.png', { type: 'image/png' })]);
        await waitFor(() => expect(document.querySelectorAll('[data-prova-remove]')).toHaveLength(2));
        await send();
        const [body] = sentBodies();
        expect(body.kind).toBe('feature');
        expect(body.what_happened).toBe('Let me pause the case clock while I read the labs');
        expect(body.technical.errors).toEqual([]);
        expect(body.technical.page).toBe('Case 12 · chat');
        expect(body.steps).toBeUndefined();
        expect(body.chunk).toBeUndefined();
        expect(body.screenshot).toBeUndefined();
        expect(body.screenshots.map((s) => [s.name, s.media_type, atob(s.data)])).toEqual([
            ['one.png', 'image/png', 'a'.repeat(10)],
            ['two.png', 'image/png', 'b'.repeat(20)],
        ]);
    });

    it('Report a problem… opens a problem report even after the dialog was switched to a feature request', async () => {
        const { result } = await mount();
        act(() => result.current.openFeature());
        type('A feature request left unsent');   // the draft keeps its kind when the dialog is closed
        act(() => document.querySelector('[data-prova-cancel]').click());
        act(() => result.current.open());
        expect(dialog().dataset.provaKindNow).toBe('problem');
        type('The monitor froze after I ordered a CBC');
        await send();
        const [body] = sentBodies();
        expect(body.kind).toBeUndefined();   // a problem goes without `kind`, as before
        expect(body.what_happened).toBe('The monitor froze after I ordered a CBC');
    });

    it('never asks this server for a subject list (Rohy mounts no /report/subjects)', async () => {
        const { result } = await mount();
        act(() => result.current.open());
        await act(async () => { await Promise.resolve(); });
        expect(apiFetch.mock.calls.map(([url]) => url).filter((url) => url.includes('subjects'))).toEqual([]);
    });

    it('My reports: "Write to the team" opens the conversation, and a reply POSTs { body } to /reports/<id>/messages', async () => {
        const { result } = await mount();
        act(() => result.current.openMine());
        await waitFor(() => expect(document.querySelector('[data-prova-open-thread="AR-3"]')).not.toBeNull());
        const link = document.querySelector('[data-prova-open-thread="AR-3"]');
        expect(link.textContent).toBe('Write to the team');
        act(() => link.click());
        await waitFor(() => expect(document.querySelector('[data-prova-reply]')).not.toBeNull());
        expect(document.querySelector('[data-prova-dialog="thread"]')).not.toBeNull();
        expect(document.querySelector('[data-prova-thread="AR-3"]')).not.toBeNull();
        expect(apiFetch.mock.calls.map(([url]) => url)).toContain('/reports/AR-3/messages?seen=1');
        const box = document.querySelector('[data-prova-reply]');
        box.value = '  It happens on Safari too  ';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        act(() => document.querySelector('[data-prova-send-reply]').click());
        await waitFor(() => expect(threadPosts()).toHaveLength(1));
        const [[url, init]] = threadPosts();
        expect(url).toBe('/reports/AR-3/messages');
        expect(JSON.parse(init.body)).toEqual({ body: 'It happens on Safari too' });
    });
});
