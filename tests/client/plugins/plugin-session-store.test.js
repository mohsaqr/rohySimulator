// The plugin store's server half (F06): a learner's room work syncs to
// /api/sessions/:sid/plugin-state/:plugin/:name with a revision check, and
// localStorage is only the offline draft cache.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSyncedStore, DRAFT_MARK, SYNC_DEBOUNCE_MS } from '../../../src/plugins/sessionStore.js';
import { createPluginContext } from '../../../src/plugins/context.js';
import { ApiError } from '../../../src/services/apiClient.js';

const KEY = 'rohy_plugin:pathology:42:state';
const URL = '/sessions/42/plugin-state/pathology/state';

/** An in-memory server with the route's compare-and-swap semantics. */
function fakeServer({ document = null, revision = 0 } = {}) {
    const server = { document, revision, puts: [], offline: false };
    server.fetcher = vi.fn(async (url, options = {}) => {
        if (server.offline) throw new ApiError('Network error', { status: 0, code: 'NETWORK' });
        expect(url).toBe(URL);
        if ((options.method ?? 'GET') === 'GET') return { document: server.document, revision: server.revision };
        const { document: next, expectedRevision } = options.json;
        server.puts.push(options.json);
        if (expectedRevision !== server.revision) {
            throw new ApiError('conflict', { status: 409, code: 'plugin_state_conflict', body: { document: server.document, revision: server.revision } });
        }
        server.document = next;
        server.revision += 1;
        return { revision: server.revision };
    });
    return server;
}

const draft = () => JSON.parse(window.localStorage.getItem(KEY));

describe('createSyncedStore', () => {
    beforeEach(() => { window.localStorage.clear(); vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('writes the local draft first, then syncs once with the revision it was based on', async () => {
        const server = fakeServer({ document: { reports: [] }, revision: 3 });
        const store = createSyncedStore({ pluginId: 'pathology', sessionId: 42, fetcher: server.fetcher });
        expect(await store.get('state', {})).toEqual({ reports: [] });

        await store.set('state', { reports: ['a'] });
        await store.set('state', { reports: ['a', 'b'] });
        // Before the debounce: on disk, dirty, not yet sent.
        expect(draft()).toMatchObject({ [DRAFT_MARK]: 1, value: { reports: ['a', 'b'] }, baseRevision: 3, dirty: true });
        expect(server.puts).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
        expect(server.puts).toEqual([{ document: { reports: ['a', 'b'] }, expectedRevision: 3 }]);
        expect(draft()).toMatchObject({ baseRevision: 4, dirty: false });
    });

    it('on a 409, takes the server copy and reports a conflict', async () => {
        // Regression lock: a second tab's save silently overwrote the first tab's work (last-writer-wins in localStorage)
        const server = fakeServer({ document: { reports: ['mine'] }, revision: 1 });
        const store = createSyncedStore({ pluginId: 'pathology', sessionId: 42, fetcher: server.fetcher });
        await store.get('state', {});
        // Another tab saves in the meantime.
        server.document = { reports: ['other tab'] };
        server.revision = 2;
        const events = [];
        store.subscribe((event) => events.push(event));

        await store.set('state', { reports: ['mine', 'stale edit'] });
        await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);

        expect(server.document).toEqual({ reports: ['other tab'] });
        expect(events).toContainEqual(expect.objectContaining({ type: 'conflict', name: 'state', value: { reports: ['other tab'] }, revision: 2 }));
        expect(draft()).toMatchObject({ value: { reports: ['other tab'] }, baseRevision: 2, dirty: false });
    });

    it('keeps the draft when offline, and pushes it on the next load', async () => {
        const server = fakeServer({ document: null, revision: 0 });
        const store = createSyncedStore({ pluginId: 'pathology', sessionId: 42, fetcher: server.fetcher });
        await store.get('state', {});
        server.offline = true;
        const events = [];
        store.subscribe((event) => events.push(event));
        await store.set('state', { reports: ['written offline'] });
        await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
        expect(events).toContainEqual(expect.objectContaining({ type: 'save_failed', offline: true }));
        expect(draft()).toMatchObject({ value: { reports: ['written offline'] }, baseRevision: 0, dirty: true });
        store.dispose();

        // The tab is reopened once the connection is back.
        server.offline = false;
        const reopened = createSyncedStore({ pluginId: 'pathology', sessionId: 42, fetcher: server.fetcher });
        expect(await reopened.get('state', {})).toEqual({ reports: ['written offline'] });
        await vi.advanceTimersByTimeAsync(0);
        expect(server.document).toEqual({ reports: ['written offline'] });
        expect(server.revision).toBe(1);
    });

    it('retries an offline save on a timer once the connection is back', async () => {
        const server = fakeServer();
        const store = createSyncedStore({ pluginId: 'pathology', sessionId: 42, fetcher: server.fetcher });
        await store.get('state', {});
        server.offline = true;
        await store.set('state', { n: 1 });
        await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
        server.offline = false;
        await vi.advanceTimersByTimeAsync(2000);
        expect(server.document).toEqual({ n: 1 });
    });

    it('migrates pre-server work that only ever lived in localStorage', async () => {
        // Regression lock: work saved before 0069 must reach the server rather than being shadowed by an empty server copy
        window.localStorage.setItem(KEY, JSON.stringify({ reports: ['from before'] }));
        const server = fakeServer({ document: null, revision: 0 });
        const store = createSyncedStore({ pluginId: 'pathology', sessionId: 42, fetcher: server.fetcher });
        expect(await store.get('state', {})).toEqual({ reports: ['from before'] });
        await vi.advanceTimersByTimeAsync(0);
        expect(server.puts).toEqual([{ document: { reports: ['from before'] }, expectedRevision: 0 }]);
        expect(server.document).toEqual({ reports: ['from before'] });
    });

    it('treats an offline draft that fell behind the server as a conflict: server wins', async () => {
        window.localStorage.setItem(KEY, JSON.stringify({ [DRAFT_MARK]: 1, value: { n: 'old' }, baseRevision: 1, dirty: true }));
        const server = fakeServer({ document: { n: 'newer' }, revision: 3 });
        const store = createSyncedStore({ pluginId: 'pathology', sessionId: 42, fetcher: server.fetcher });
        const events = [];
        store.subscribe((event) => events.push(event));
        expect(await store.get('state', {})).toEqual({ n: 'newer' });
        expect(events).toContainEqual(expect.objectContaining({ type: 'conflict', value: { n: 'newer' } }));
        await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
        expect(server.puts).toHaveLength(0);
    });

    it('a device with nothing local reads the server copy (another device\'s work)', async () => {
        const server = fakeServer({ document: { reports: ['from the laptop'] }, revision: 5 });
        const store = createSyncedStore({ pluginId: 'pathology', sessionId: 42, fetcher: server.fetcher });
        expect(await store.get('state', {})).toEqual({ reports: ['from the laptop'] });
    });

    it('offline on load falls back to the local draft', async () => {
        window.localStorage.setItem(KEY, JSON.stringify({ [DRAFT_MARK]: 1, value: { n: 1 }, baseRevision: 2, dirty: false }));
        const server = fakeServer();
        server.offline = true;
        const store = createSyncedStore({ pluginId: 'pathology', sessionId: 42, fetcher: server.fetcher });
        expect(await store.get('state', {})).toEqual({ n: 1 });
    });
});

describe('createPluginContext store selection', () => {
    const manifest = { id: 'pathology', capabilities: ['persist'], vocabulary: { verbs: {} } };
    it('syncs to the server when there is a session', () => {
        const ctx = createPluginContext({ manifest, session: { id: 7 }, eventLogger: {}, t: (k) => k });
        expect(typeof ctx.store.subscribe).toBe('function');
    });
    it('stays browser-only without a session', () => {
        const ctx = createPluginContext({ manifest, session: null, eventLogger: {}, t: (k) => k });
        expect(ctx.store.subscribe).toBeUndefined();
    });
});
