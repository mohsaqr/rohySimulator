// Batching contract for the per-event state log transport.
//
// The properties a bug would hide behind: events stay off the wire when the
// consent gate is closed, a session change never posts old events under the new
// session, only typing and voice leave the browser, and flush() really waits.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../../services/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('./clientLogger', () => ({ oyonClientLog: vi.fn() }));

const { createSignalEventTransport } = await import('./signalEventTransport.js');

let index = 0;
function logged(modality = 'typing', state = 'insert', extra = {}) {
    index += 1;
    return {
        event_id: `evt_${index}`,
        capture_id: 'cap_1',
        session_id: 'oyon-internal',
        modality,
        state,
        source: 'user',
        sequence_index: index,
        timestamp: 1_790_000_000_000 + index,
        monotonic_ms: index,
        state_vocabulary: `${modality}-states-v1`,
        target: 'composer',
        detail: { offset: index, length: 1, op: state },
        ...extra,
    };
}

/** Manual timers so the 2 s flush is driven by the test, not the clock. */
function manualTimers() {
    const timers = [];
    return {
        setTimer: (fn) => { timers.push(fn); return timers.length; },
        clearTimer: (id) => { timers[id - 1] = null; },
        fire: () => timers.splice(0).forEach(fn => fn && fn()),
    };
}

beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, inserted: 0 });
});

describe('createSignalEventTransport', () => {
    it('refuses to be built without a context reader', () => {
        expect(() => createSignalEventTransport()).toThrow(TypeError);
    });

    it('posts a full batch at once, in order, under rohy\'s session', async () => {
        const t = createSignalEventTransport(() => ({ persist: true, sessionId: 42 }), { batchSize: 3 });
        const events = [logged(), logged('typing', 'pause'), logged('voice', 'speech')];
        events.forEach(t.write);
        await t.flush();

        expect(apiFetch).toHaveBeenCalledTimes(1);
        const [path, { method, json }] = apiFetch.mock.calls[0];
        expect(path).toBe('/addons/oyon/signal-events');
        expect(method).toBe('POST');
        expect(json.session_id).toBe('42');
        expect(json.events.map(e => e.sequence_index)).toEqual(events.map(e => e.sequence_index));
        // Only the fields the route reads — not Oyon's internal session or target.
        expect(Object.keys(json.events[0]).sort()).toEqual(
            ['capture_id', 'detail', 'modality', 'sequence_index', 'source', 'state', 'state_vocabulary', 'timestamp'],
        );
    });

    it('sends a partial batch when the timer fires', async () => {
        const timers = manualTimers();
        const t = createSignalEventTransport(() => ({ persist: true, sessionId: 's' }), { batchSize: 50, ...timers });
        t.write(logged());
        t.write(logged());
        expect(apiFetch).not.toHaveBeenCalled();
        timers.fire();
        await t.flush();
        expect(apiFetch).toHaveBeenCalledTimes(1);
        expect(apiFetch.mock.calls[0][1].json.events).toHaveLength(2);
    });

    it('sends nothing while the consent gate is closed or there is no session', async () => {
        let ctx = { persist: false, sessionId: 's' };
        const t = createSignalEventTransport(() => ctx);
        t.write(logged());
        ctx = { persist: true, sessionId: null };
        t.write(logged());
        await t.flush();
        expect(apiFetch).not.toHaveBeenCalled();
    });

    it('forwards typing and voice only', async () => {
        const t = createSignalEventTransport(() => ({ persist: true, sessionId: 's' }));
        t.write(logged('interaction', 'click'));
        t.write(logged('discourse', 'question'));
        t.write(logged('voice', 'silence'));
        await t.flush();
        expect(apiFetch.mock.calls[0][1].json.events.map(e => e.modality)).toEqual(['voice']);
    });

    // Regression lock: buffered events must never be posted under the next session.
    it('flushes before switching session', async () => {
        let ctx = { persist: true, sessionId: 'first' };
        const t = createSignalEventTransport(() => ctx);
        t.write(logged());
        ctx = { persist: true, sessionId: 'second' };
        t.write(logged());
        await t.flush();
        expect(apiFetch.mock.calls.map(c => [c[1].json.session_id, c[1].json.events.length]))
            .toEqual([['first', 1], ['second', 1]]);
    });

    it('logs a failed post without throwing into the capture', async () => {
        apiFetch.mockRejectedValueOnce(new Error('offline'));
        const t = createSignalEventTransport(() => ({ persist: true, sessionId: 's' }), { batchSize: 1 });
        expect(() => t.write(logged())).not.toThrow();
        await expect(t.flush()).resolves.toBeUndefined();
    });
});
