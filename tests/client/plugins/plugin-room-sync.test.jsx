// PluginRoom on the server-backed store (F06): a conflict reloads the room from
// the server's copy and tells the learner; opening a room does not write back
// what it just read.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useState } from 'react';

const server = { document: { notes: ['saved'] }, revision: 1, puts: [] };
vi.mock('../../../src/services/apiClient.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        apiFetch: vi.fn(async (url, options = {}) => {
            if ((options.method ?? 'GET') === 'GET') return { document: server.document, revision: server.revision };
            server.puts.push(options.json);
            if (options.json.expectedRevision !== server.revision) {
                throw new actual.ApiError('conflict', { status: 409, code: 'plugin_state_conflict', body: { document: server.document, revision: server.revision } });
            }
            server.document = options.json.document;
            server.revision += 1;
            return { revision: server.revision };
        }),
    };
});

let seeds = [];
let editRef = null;
function Room({ initialNotes, onNotes }) {
    // Seeds ONCE, as the pathology room does.
    const [notes, setNotes] = useState(() => { seeds.push(initialNotes); return initialNotes ?? []; });
    editRef = (next) => { setNotes(next); onNotes(next); };
    return <div data-testid="room">{notes.join(',')}</div>;
}
const descriptor = {
    manifest: { id: 'pathology', room: { key: 'pathology' }, vocabulary: { verbs: {} }, capabilities: ['persist'] },
    component: Room,
    available: () => true,
    props: (_ctx, persist) => ({ initialNotes: persist.state.notes, onNotes: (notes) => persist.save({ notes }) }),
    authorProps: () => ({}),
};
vi.mock('../../../src/plugins/registry.js', () => ({ registry: { get: () => descriptor } }));

const { PluginRoom } = await import('../../../src/plugins/PluginRoom.jsx');
const { NotificationContextObject } = await import('../../../src/notifications/NotificationContextObject.js');

const session = { id: 42, caseId: 1, userId: 1, role: 'student', language: 'en', examMode: false };
const caseConfig = {};

describe('PluginRoom with the server-backed store', () => {
    beforeEach(() => {
        window.localStorage.clear();
        server.document = { notes: ['saved'] };
        server.revision = 1;
        server.puts = [];
        seeds = [];
    });

    it('seeds from the server copy and does not write it straight back', async () => {
        const view = render(<PluginRoom pluginId="pathology" session={session} caseConfig={caseConfig} eventLogger={{}} navigate={() => {}} />);
        expect((await view.findByTestId('room')).textContent).toBe('saved');
        await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
        expect(server.puts).toEqual([]);
        view.unmount();
    });

    it('reloads the room from the server and notifies on a conflict', async () => {
        // Regression lock: a stale tab's save must not silently win, and the learner must see the newer work
        const notify = vi.fn();
        const view = render(
            <NotificationContextObject.Provider value={{ notify }}>
                <PluginRoom pluginId="pathology" session={session} caseConfig={caseConfig} eventLogger={{}} navigate={() => {}} />
            </NotificationContextObject.Provider>,
        );
        expect((await view.findByTestId('room')).textContent).toBe('saved');
        // Another tab saves.
        server.document = { notes: ['other tab'] };
        server.revision = 2;
        // This tab edits, and its debounced save is refused.
        act(() => editRef(['stale']));
        await act(async () => { await new Promise((r) => setTimeout(r, 900)); });

        expect(server.document).toEqual({ notes: ['other tab'] });
        expect((await view.findByTestId('room')).textContent).toBe('other tab');
        // Remounted: the room seeded a second time, from the server copy.
        expect(seeds.at(-1)).toEqual(['other tab']);
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning', key: 'plugin-state-conflict:pathology' }));
        view.unmount();
    });
});
