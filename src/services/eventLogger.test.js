// Phase 3 — eventLogger contract tests.
//
// CONTRACT: After the NotificationCenter migration, eventLogger is a thin
// producer. Every log() forwards a payload through getExternalApi().notify().
// xAPI verbs are preserved on payload.data.verb. When the center isn't
// mounted yet, events buffer up to 1000 (oldest dropped on overflow) and
// replay in FIFO order on the first center-bound log() after mount.
// Replays never duplicate. notify() throwing must NOT bubble out of log()
// (but the current implementation does bubble — see contract note in tests).
//
// We mock src/notifications/externalApi.js and toggle whether
// getExternalApi() returns null (pre-mount) or a notify spy (post-mount)
// per test. The eventLogger is a singleton; we re-import it fresh in each
// test via vi.resetModules() + dynamic import so internal state
// (preCenterBuffer, eventCounts, context) starts clean.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted spy + getter — vi.mock() factories run before the import, so the
// spies must be created via vi.hoisted() to be referenced inside the factory.
const { notifySpy, externalApiRef } = vi.hoisted(() => ({
    notifySpy: { fn: null },        // mutable holder so tests can swap impl
    externalApiRef: { current: null }, // null = pre-mount; object = mounted
}));

vi.mock('../notifications/externalApi', () => ({
    setExternalApi: (api) => { externalApiRef.current = api; },
    getExternalApi: () => externalApiRef.current,
}));

// Helper: mount the (mocked) center with a fresh notify spy.
const mountCenter = () => {
    const notify = vi.fn();
    notifySpy.fn = notify;
    externalApiRef.current = { notify };
    return notify;
};

// Helper: simulate pre-mount.
const unmountCenter = () => {
    externalApiRef.current = null;
    notifySpy.fn = null;
};

// Helper: load a fresh singleton + module exports.
const loadFreshLogger = async () => {
    vi.resetModules();
    return import('./eventLogger.js');
};

beforeEach(() => {
    unmountCenter();
});

afterEach(() => {
    unmountCenter();
});

describe('eventLogger — exported constants', () => {
    it('exports SEVERITY ladder with 5 levels', async () => {
        const m = await loadFreshLogger();
        expect(m.SEVERITY).toEqual({
            DEBUG: 'DEBUG',
            INFO: 'INFO',
            ACTION: 'ACTION',
            IMPORTANT: 'IMPORTANT',
            CRITICAL: 'CRITICAL',
        });
    });

    it('exports CATEGORIES, VERBS, OBJECT_TYPES, COMPONENTS', async () => {
        const m = await loadFreshLogger();
        expect(m.CATEGORIES.SESSION).toBe('SESSION');
        expect(m.VERBS.STARTED_SESSION).toBe('STARTED_SESSION');
        expect(m.OBJECT_TYPES.SESSION).toBe('session');
        expect(m.COMPONENTS.APP).toBe('App');
    });

    it('default export is the EventLogger singleton with log() and convenience methods', async () => {
        const m = await loadFreshLogger();
        expect(typeof m.default.log).toBe('function');
        expect(typeof m.default.sessionStarted).toBe('function');
        expect(typeof m.default.componentOpened).toBe('function');
        expect(typeof m.default.getStatus).toBe('function');
    });
});

describe('eventLogger — xAPI verb mapping (5+ representative verbs)', () => {
    // CONTRACT: log(verb, ...) forwards a notify payload whose data.verb
    // equals the input verb literally. xAPI semantics are preserved on the
    // wire even though severity is mapped to notification severity.
    it('forwards STARTED_SESSION verb', async () => {
        const notify = mountCenter();
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.STARTED_SESSION, OBJECT_TYPES.SESSION, { objectId: 's1' });
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0].data.verb).toBe('STARTED_SESSION');
    });

    it('forwards ATTEMPTED verb', async () => {
        const notify = mountCenter();
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.ATTEMPTED, OBJECT_TYPES.SCENARIO, { objectId: 'q1' });
        expect(notify.mock.calls[0][0].data.verb).toBe('ATTEMPTED');
    });

    it('forwards COMPLETED_SCENARIO verb', async () => {
        const notify = mountCenter();
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.COMPLETED_SCENARIO, OBJECT_TYPES.SCENARIO, { objectName: 'sepsis' });
        expect(notify.mock.calls[0][0].data.verb).toBe('COMPLETED_SCENARIO');
    });

    it('forwards ANSWERED verb', async () => {
        const notify = mountCenter();
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.ANSWERED, OBJECT_TYPES.CHAT_MESSAGE, { result: 'A' });
        expect(notify.mock.calls[0][0].data.verb).toBe('ANSWERED');
    });

    it('forwards ERROR_OCCURRED verb with critical severity mapping', async () => {
        const notify = mountCenter();
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.ERROR_OCCURRED, OBJECT_TYPES.COMPONENT, { result: 'boom' });
        const payload = notify.mock.calls[0][0];
        expect(payload.data.verb).toBe('ERROR_OCCURRED');
        // SEVERITY.CRITICAL → 'critical' on the wire.
        expect(payload.severity).toBe('critical');
    });

    it('forwards ORDERED_LAB verb tagged on payload.data.verb', async () => {
        const notify = mountCenter();
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.ORDERED_LAB, OBJECT_TYPES.LAB_TEST, { objectId: 'cbc' });
        expect(notify.mock.calls[0][0].data.verb).toBe('ORDERED_LAB');
    });

    it('preserves xAPI category on payload.data.category', async () => {
        const notify = mountCenter();
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.ORDERED_LAB, OBJECT_TYPES.LAB_TEST, { objectId: 'cbc' });
        expect(notify.mock.calls[0][0].data.category).toBe('CLINICAL');
    });

    it('forwards new observability verbs with the expected severity/category shape', async () => {
        const notify = mountCenter();
        const { default: log } = await loadFreshLogger();

        log.focusLost();
        log.focusResumed();
        log.unload();
        log.sttResult({ finalLength: 4, interimLength: 2, isFinal: true, lang: 'en-US' });
        log.sttError('no-speech', { lang: 'en-US' });
        log.ttsPlayed({ voice: 'voice-a', provider: 'piper' });

        const payloads = notify.mock.calls.map(c => c[0]);
        expect(payloads.map(p => p.data.verb)).toEqual([
            'LOST_FOCUS',
            'RESUMED_FOCUS',
            'UNLOAD',
            'STT_RESULT',
            'STT_ERROR',
            'TTS_PLAYED',
        ]);
        expect(payloads.find(p => p.data.verb === 'LOST_FOCUS').severity).toBe('debug');
        expect(payloads.find(p => p.data.verb === 'RESUMED_FOCUS').data.category).toBe('NAVIGATION');
        expect(payloads.find(p => p.data.verb === 'UNLOAD').data.category).toBe('SESSION');
        expect(payloads.find(p => p.data.verb === 'STT_RESULT').data.context).toMatchObject({
            finalLength: 4,
            interimLength: 2,
            isFinal: true,
            lang: 'en-US',
        });
        expect(payloads.find(p => p.data.verb === 'STT_ERROR').severity).toBe('warning');
        expect(payloads.find(p => p.data.verb === 'TTS_PLAYED').data.context).toMatchObject({
            voice: 'voice-a',
            provider: 'piper',
        });
    });
});

describe('eventLogger — app lifecycle window wiring', () => {
    it('registers blur/focus/beforeunload listeners and cleans them up', async () => {
        const notify = mountCenter();
        const { registerWindowLifecycleLogging } = await loadFreshLogger();

        const cleanup = registerWindowLifecycleLogging(window);
        window.dispatchEvent(new Event('blur'));
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('beforeunload'));

        expect(notify.mock.calls.map(c => c[0].data.verb)).toEqual([
            'LOST_FOCUS',
            'RESUMED_FOCUS',
            'UNLOAD',
        ]);

        cleanup();
        window.dispatchEvent(new Event('blur'));
        expect(notify).toHaveBeenCalledTimes(3);
    });
});

describe('eventLogger — session status transitions', () => {
    // CONTRACT: sessionStarted → sessionResumed → sessionEnded each fire one
    // notify, and clearContext() runs after sessionEnded so subsequent
    // sessionId in payload reflects the cleared state.
    it('sessionStarted fires exactly one event with STARTED_SESSION verb', async () => {
        const notify = mountCenter();
        const { default: log } = await loadFreshLogger();
        log.sessionStarted(42, 7, 'Sepsis Case');
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0].data.verb).toBe('STARTED_SESSION');
        expect(notify.mock.calls[0][0].data.objectId).toBe('42');
    });

    it('sessionResumed fires exactly one event with RESUMED_SESSION verb', async () => {
        const notify = mountCenter();
        const { default: log } = await loadFreshLogger();
        log.sessionResumed(99, 7, 'Resumed');
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0].data.verb).toBe('RESUMED_SESSION');
    });

    it('sessionEnded fires one event and clears context', async () => {
        const notify = mountCenter();
        const { default: log } = await loadFreshLogger();
        log.sessionStarted(42, 7, 'Sepsis');
        log.sessionEnded(1234);
        expect(notify).toHaveBeenCalledTimes(2);
        expect(notify.mock.calls[1][0].data.verb).toBe('ENDED_SESSION');
        expect(notify.mock.calls[1][0].data.durationMs).toBe(1234);
        // Context cleared after end.
        expect(log.getStatus().sessionId).toBeNull();
        expect(log.getStatus().caseId).toBeNull();
    });
});

describe('eventLogger — component lifecycle events', () => {
    // CONTRACT: componentOpened/Closed + modal/drawer wrappers each fire
    // exactly one notify with the right verb tag.
    it('componentOpened fires OPENED on COMPONENT object type', async () => {
        const notify = mountCenter();
        const { default: log, COMPONENTS } = await loadFreshLogger();
        log.componentOpened(COMPONENTS.CHAT_INTERFACE, 'Chat');
        expect(notify).toHaveBeenCalledTimes(1);
        const p = notify.mock.calls[0][0];
        expect(p.data.verb).toBe('OPENED');
        expect(p.data.objectType).toBe('component');
        expect(p.data.component).toBe('ChatInterface');
    });

    it('componentClosed fires CLOSED on COMPONENT object type', async () => {
        const notify = mountCenter();
        const { default: log, COMPONENTS } = await loadFreshLogger();
        log.componentClosed(COMPONENTS.CHAT_INTERFACE);
        expect(notify.mock.calls[0][0].data.verb).toBe('CLOSED');
        expect(notify.mock.calls[0][0].data.component).toBe('ChatInterface');
    });

    it('modalOpened/modalClosed fire one event each with MODAL object type', async () => {
        const notify = mountCenter();
        const { default: log } = await loadFreshLogger();
        log.modalOpened('lab-modal', 'LabResultsModal');
        log.modalClosed('lab-modal', 'LabResultsModal');
        expect(notify).toHaveBeenCalledTimes(2);
        expect(notify.mock.calls[0][0].data.verb).toBe('OPENED');
        expect(notify.mock.calls[0][0].data.objectType).toBe('modal');
        expect(notify.mock.calls[1][0].data.verb).toBe('CLOSED');
    });
});

describe('eventLogger — getStatus snapshot shape', () => {
    // CONTRACT: getStatus() returns
    // { sessionId, userId, caseId, isEnabled, preCenterBuffered }.
    it('returns the documented status shape', async () => {
        const { default: log } = await loadFreshLogger();
        const status = log.getStatus();
        expect(Object.keys(status).sort()).toEqual(
            ['caseId', 'isEnabled', 'preCenterBuffered', 'sessionId', 'userId'].sort()
        );
        expect(status.isEnabled).toBe(true);
        expect(status.preCenterBuffered).toBe(0);
    });

    it('preCenterBuffered increments while center is unmounted', async () => {
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: 'a' });
        log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: 'b' });
        expect(log.getStatus().preCenterBuffered).toBe(2);
    });

    it('setContext updates status snapshot', async () => {
        const { default: log } = await loadFreshLogger();
        log.setContext({ sessionId: 'S1', userId: 'U1', caseId: 'C1' });
        const s = log.getStatus();
        expect(s.sessionId).toBe('S1');
        expect(s.userId).toBe('U1');
        expect(s.caseId).toBe('C1');
    });
});

describe('eventLogger — pre-mount buffer', () => {
    // CONTRACT: When getExternalApi() returns null, payloads queue in
    // preCenterBuffer (cap 1000). On the first center-bound log() after
    // mount, the buffer flushes in FIFO order, then the new event fires.
    // Subsequent log() calls do NOT replay the buffer again.
    it('buffers events fired before center mount', async () => {
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        // No center yet.
        log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: 'a' });
        log.log(VERBS.CLICKED, OBJECT_TYPES.BUTTON, { objectId: 'b' });
        expect(log.getStatus().preCenterBuffered).toBe(2);
    });

    it('replays buffered events in FIFO order on first post-mount log()', async () => {
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: 'first' });
        log.log(VERBS.CLICKED, OBJECT_TYPES.BUTTON, { objectId: 'second' });
        // Now mount.
        const notify = mountCenter();
        // Trigger replay with a third event.
        log.log(VERBS.OPENED, OBJECT_TYPES.MODAL, { objectId: 'third' });
        // Buffered first, then third → 3 calls, FIFO.
        expect(notify).toHaveBeenCalledTimes(3);
        expect(notify.mock.calls[0][0].data.objectId).toBe('first');
        expect(notify.mock.calls[1][0].data.objectId).toBe('second');
        expect(notify.mock.calls[2][0].data.objectId).toBe('third');
    });

    it('buffer is drained after replay (preCenterBuffered → 0)', async () => {
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: 'x' });
        expect(log.getStatus().preCenterBuffered).toBe(1);
        mountCenter();
        log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: 'y' });
        expect(log.getStatus().preCenterBuffered).toBe(0);
    });

    it('does not duplicate replay on subsequent log() calls', async () => {
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: 'buffered' });
        const notify = mountCenter();
        log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: 'live1' });
        log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: 'live2' });
        // 1 replayed + 2 live = 3 (NOT 4 — the buffer must not re-fire).
        expect(notify).toHaveBeenCalledTimes(3);
        const ids = notify.mock.calls.map(c => c[0].data.objectId);
        expect(ids).toEqual(['buffered', 'live1', 'live2']);
    });

    it('drops oldest events when buffer exceeds 1000 cap', async () => {
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        // Push 1005 events while center is unmounted.
        for (let i = 0; i < 1005; i++) {
            log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: `e${i}` });
        }
        expect(log.getStatus().preCenterBuffered).toBe(1000);
        // Mount and replay; the oldest 5 should be dropped.
        const notify = mountCenter();
        log.log(VERBS.OPENED, OBJECT_TYPES.MODAL, { objectId: 'tail' });
        // 1000 replayed + 1 live = 1001.
        expect(notify).toHaveBeenCalledTimes(1001);
        // First replayed is e5 (e0..e4 dropped).
        expect(notify.mock.calls[0][0].data.objectId).toBe('e5');
        expect(notify.mock.calls[999][0].data.objectId).toBe('e1004');
        expect(notify.mock.calls[1000][0].data.objectId).toBe('tail');
    });
});

describe('eventLogger — failure isolation', () => {
    // CONTRACT NOTE: The current implementation does NOT wrap api.notify()
    // in try/catch — a throwing notify() will bubble up. We document that
    // here so any future try/catch addition is intentional. If/when
    // eventLogger gains isolation, flip these expectations.
    it('CURRENT BEHAVIOUR: a throwing notify propagates from log()', async () => {
        externalApiRef.current = { notify: () => { throw new Error('center down'); } };
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        expect(() => log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: 'x' }))
            .toThrow('center down');
    });

    it('respects isEnabled=false by suppressing notify entirely', async () => {
        const notify = mountCenter();
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.setEnabled(false);
        const ret = log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: 'x' });
        expect(ret).toBeNull();
        expect(notify).not.toHaveBeenCalled();
    });

    it('respects minimumSeverity threshold (filters DEBUG when min=IMPORTANT)', async () => {
        const notify = mountCenter();
        const { default: log, VERBS, OBJECT_TYPES, SEVERITY } = await loadFreshLogger();
        log.setMinimumSeverity(SEVERITY.IMPORTANT);
        // VIEWED is DEBUG → should be filtered out.
        log.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, { objectId: 'low' });
        // STARTED_SESSION is IMPORTANT → should pass.
        log.log(VERBS.STARTED_SESSION, OBJECT_TYPES.SESSION, { objectId: 's1' });
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0].data.verb).toBe('STARTED_SESSION');
    });
});

describe('eventLogger — payload shape contract', () => {
    // CONTRACT: every notify payload has source=telemetry, a key prefix
    // 'telemetry:<VERB>:<objectType>:<objectId>', and data.{verb,objectType,
    // category} populated. Locks the wire shape consumed downstream.
    it('payload uses SOURCES.TELEMETRY and prefixed key', async () => {
        const notify = mountCenter();
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.CLICKED, OBJECT_TYPES.BUTTON, { objectId: 'submit-btn' });
        const p = notify.mock.calls[0][0];
        expect(p.source).toBe('telemetry');
        expect(p.key).toBe('telemetry:CLICKED:button:submit-btn');
    });

    it('eventCounts increments per (verb,objectType) combo', async () => {
        mountCenter();
        const { default: log, VERBS, OBJECT_TYPES } = await loadFreshLogger();
        log.log(VERBS.CLICKED, OBJECT_TYPES.BUTTON, { objectId: 'a' });
        log.log(VERBS.CLICKED, OBJECT_TYPES.BUTTON, { objectId: 'b' });
        log.log(VERBS.OPENED, OBJECT_TYPES.MODAL, { objectId: 'm' });
        const counts = log.getEventCounts();
        expect(counts['CLICKED:button']).toBe(2);
        expect(counts['OPENED:modal']).toBe(1);
        log.resetEventCounts();
        expect(Object.keys(log.getEventCounts())).toHaveLength(0);
    });
});
