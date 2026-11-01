// Regression lock: an OpenSeadragon viewer whose deferred construction fires
// after React detached its host (unmount committed, effect cleanup not yet
// run) must not be built into a null element — nightly monkey walk on rc.91,
// "TypeError: Cannot read properties of null (reading 'appendChild') at new
// n.Viewer" after pressing the Anatomia patologica room button.
//
// THE RACE. SlideCanvas and SpecimenTray (vendored pathoyon, not editable
// here) build their viewer in a setTimeout(0) and read `hostRef.current`
// when it fires, trusting a `disposed` flag that only the PASSIVE effect
// cleanup sets. React detaches refs in the commit's mutation phase, and for a
// non-sync update the passive cleanup of a deleted subtree runs in a later
// task. A timer that fires in that window sees disposed === false and
// hostRef.current === null. The harness below lands the timer in exactly that
// window by running it from a parent's layout effect, which React runs after
// the mutation phase (refs already detached) and before passive cleanup.
//
// The mock reproduces the two OpenSeadragon facts the guard depends on: the
// factory looks `OpenSeadragon.Viewer` up when it is called, and the
// constructor's first DOM write is `element.appendChild(container)`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLayoutEffect } from 'react';
import { render, cleanup } from '@testing-library/react';

const osd = vi.hoisted(() => ({ built: [] }));

vi.mock('openseadragon', () => {
    function Viewer(options) {
        const element = options.element ?? null;
        // The real constructor's line: `this.element.appendChild(this.container)`.
        element.appendChild(document.createElement('div'));
        this.element = element;
        this.options = options;
        this.destroyed = false;
        this.world = { getItemAt: () => null };
        osd.built.push(this);
    }
    Viewer.prototype.addHandler = function addHandler() {};
    Viewer.prototype.destroy = function destroy() { this.destroyed = true; };
    function OpenSeadragon(options) {
        return new OpenSeadragon.Viewer(options);
    }
    OpenSeadragon.Viewer = Viewer;
    OpenSeadragon.Point = function Point(x, y) { this.x = x; this.y = y; };
    return { default: OpenSeadragon };
});

// The adapter rohy actually loads — it is what installs the host guard.
await import('./index.jsx');
const { SlideCanvas } = await import('../../components/pathology/SlideCanvas.jsx');
const { SpecimenTray } = await import('../../components/pathology/SpecimenTray.jsx');

const slide = { id: 's1', label: 'Slide 1', dzi: '/api/plugins/pathology/_o/token.dzi' };
const specimens = [{ part: 'A', name: 'Part A', images: [{ id: 'p1', src: '/plate.jpg' }] }];
const logger = { specimenViewed: () => {}, plateOpened: () => {} };

const VIEWS = {
    SlideCanvas: () => <SlideCanvas slide={slide} startedAt={0} />,
    SpecimenTray: () => <SpecimenTray specimens={specimens} logger={logger} />,
};

/** Runs `onCommit` in the layout phase of every commit. */
function Harness({ show, view, onCommit }) {
    useLayoutEffect(() => { onCommit?.(); });
    const View = VIEWS[view];
    return show ? <View /> : null;
}

beforeEach(() => {
    osd.built.length = 0;
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe.each(Object.keys(VIEWS))('%s: viewer construction vs unmount', (view) => {
    it('a timer that fires after the host was detached does not throw or build into a missing host', () => {
        const { rerender } = render(<Harness show view={view} />);
        // Mounted, effect ran, construction is pending.
        expect(osd.built).toHaveLength(0);

        const thrown = [];
        rerender(
            <Harness
                show={false}
                view={view}
                onCommit={() => {
                    try { vi.runOnlyPendingTimers(); } catch (error) { thrown.push(error); }
                }}
            />,
        );

        expect(thrown.map((e) => e.message)).toEqual([]);
        // Whatever was constructed in the window is inert: no live host, no
        // slide fetched, and torn down by the cleanup that followed.
        osd.built.forEach((viewer) => {
            expect({
                connected: viewer.element.isConnected,
                tileSources: viewer.options.tileSources ?? null,
                destroyed: viewer.destroyed,
            }).toEqual({ connected: false, tileSources: null, destroyed: true });
        });
    });

    it('a viewer built while mounted goes into the real host and is destroyed on unmount', () => {
        const { unmount, container } = render(<Harness show view={view} />);
        vi.runOnlyPendingTimers();
        expect(osd.built).toHaveLength(1);
        const [viewer] = osd.built;
        expect(container.contains(viewer.element)).toBe(true);
        expect(viewer.options.tileSources).toBeTruthy();
        expect(viewer.destroyed).toBe(false);

        unmount();
        expect(viewer.destroyed).toBe(true);
    });

    it('unmounting before the deferred construction fires builds nothing', () => {
        const { unmount } = render(<Harness show view={view} />);
        unmount();
        vi.runOnlyPendingTimers();
        expect(osd.built).toHaveLength(0);
    });
});
