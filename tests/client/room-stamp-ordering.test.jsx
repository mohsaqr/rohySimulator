// Regression lock: the active-room stamp on learning events.
//
// CONTRACT: EventLogger.room must already hold the DESTINATION room by the
// time the destination room's components run their mount effects. React runs
// child effects before parent effects, so stamping the room from a parent
// useEffect (the pre-fix App.jsx pattern) attributes every arrival event to
// the room the learner just left. App.jsx therefore stamps synchronously
// inside navigateToRoom(), the single entry point for room transitions —
// which also covers lab ↔ radiology, where the panel component is shared and
// never remounts, so no child mount effect fires at all.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { useEffect, useRef, useState } from 'react';

const { externalApiRef } = vi.hoisted(() => ({ externalApiRef: { current: null } }));

vi.mock('../../src/notifications/externalApi', () => ({
    setExternalApi: (api) => { externalApiRef.current = api; },
    getExternalApi: () => externalApiRef.current,
}));

const mountCenter = () => {
    const notify = vi.fn();
    externalApiRef.current = { notify };
    return notify;
};

const loadFreshLogger = async () => {
    vi.resetModules();
    const mod = await import('../../src/services/eventLogger.js');
    return mod.default;
};

// A minimal replica of App.jsx's room control plane: one parent owning
// `currentRoom`, one child panel that logs on mount. `stampMode` selects
// between the fixed pattern (stamp at commit time, inside navigateToRoom)
// and the pre-fix pattern (stamp from a parent effect).
function makeApp(log, stampMode) {
    // The room panel logs OPENED on mount, the way every room component does.
    // Keyed by the panel it belongs to, not the room: lab and radiology share
    // one investigations panel, so hopping between them never remounts it.
    function RoomPanel() {
        useEffect(() => { log.componentOpened('RoomPanel'); }, []);
        return <div>panel</div>;
    }

    return function ReplicaApp() {
        const [currentRoom, setCurrentRoom] = useState('chat');
        const prevRoomRef = useRef(currentRoom);

        useEffect(() => {
            if (stampMode === 'effect' && prevRoomRef.current !== currentRoom) {
                log.roomChanged(currentRoom);
            }
            prevRoomRef.current = currentRoom;
        }, [currentRoom]);

        const navigateToRoom = (target) => {
            if (target === currentRoom) return;
            if (stampMode === 'commit') {
                log.roomChanged(target);
                prevRoomRef.current = target;
            }
            setCurrentRoom(target);
        };

        const panelKey = (currentRoom === 'lab' || currentRoom === 'radiology')
            ? 'investigations'
            : currentRoom;

        return (
            <div>
                <button onClick={() => navigateToRoom('lab')}>go-lab</button>
                <button onClick={() => navigateToRoom('radiology')}>go-radiology</button>
                <RoomPanel key={panelKey} />
            </div>
        );
    };
}

const events = (notify) => notify.mock.calls.map((c) => ({
    verb: c[0].data.verb,
    room: c[0].data.room,
    context: c[0].data.context,
}));

beforeEach(() => { externalApiRef.current = null; });
afterEach(() => { cleanup(); externalApiRef.current = null; });

describe('room stamp ordering', () => {
    it('stamping at commit time attributes the arrival event to the room being entered', async () => {
        const notify = mountCenter();
        const log = await loadFreshLogger();
        log.setContext({ sessionId: 1, room: 'chat' });
        const App = makeApp(log, 'commit');
        render(<App />);
        notify.mockClear();

        act(() => { screen.getByText('go-lab').click(); });

        // NAVIGATED lands first, and the panel's mount event carries `lab`.
        expect(events(notify).map((e) => e.verb)).toEqual(['NAVIGATED', 'OPENED']);
        expect(events(notify).map((e) => e.room)).toEqual(['lab', 'lab']);
    });

    it('stamping from a parent effect misattributes it to the room just left', async () => {
        // Characterization of the pre-fix behaviour — this is what the commit
        // -time stamp exists to prevent. React runs the child's mount effect
        // BEFORE the parent's, so the panel logs while room is still `chat`.
        const notify = mountCenter();
        const log = await loadFreshLogger();
        log.setContext({ sessionId: 1, room: 'chat' });
        const App = makeApp(log, 'effect');
        render(<App />);
        notify.mockClear();

        act(() => { screen.getByText('go-lab').click(); });

        expect(events(notify).map((e) => e.verb)).toEqual(['OPENED', 'NAVIGATED']);
        expect(events(notify)[0].room).toBe('chat');
    });

    it('lab → radiology still emits the transition even though the panel never remounts', async () => {
        const notify = mountCenter();
        const log = await loadFreshLogger();
        log.setContext({ sessionId: 1, room: 'chat' });
        const App = makeApp(log, 'commit');
        render(<App />);
        act(() => { screen.getByText('go-lab').click(); });
        notify.mockClear();

        act(() => { screen.getByText('go-radiology').click(); });

        // The shared investigations panel does not remount → no OPENED event.
        // The transition itself must still be recorded, or the analytics layer
        // sees the learner sitting in `lab` for the whole visit.
        expect(events(notify)).toEqual([
            { verb: 'NAVIGATED', room: 'radiology', context: { fromRoom: 'lab', toRoom: 'radiology' } },
        ]);
        expect(log.getStatus().room).toBe('radiology');
    });
});

describe('App.jsx navigateToRoom', () => {
    // Source-level lock on the real call site: the replica above proves WHY
    // the stamp has to happen at commit time, but only this catches the stamp
    // sliding back into an effect in App.jsx itself.
    it('stamps the room synchronously inside navigateToRoom, not only in an effect', () => {
        const src = readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
        const start = src.indexOf('const navigateToRoom = (target) => {');
        expect(start).toBeGreaterThan(-1);
        const body = src.slice(start, src.indexOf('setCurrentRoom(target);', start));

        expect(body).toContain('EventLogger.roomChanged(target)');
    });
});
