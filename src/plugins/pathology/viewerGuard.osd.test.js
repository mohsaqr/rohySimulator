// The guard against the REAL openseadragon bundle: proves the seam the guard
// relies on (the factory looks `OpenSeadragon.Viewer` up at call time) and that
// wrapping the constructor keeps OSD's own behaviour intact. The sibling
// viewerGuard.test.jsx covers the React race with a mocked OSD.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import OpenSeadragon from 'openseadragon';
import { installViewerHostGuard } from './viewerGuard.js';

const built = [];
// jsdom has no canvas: without this every drawer probe prints a "Not
// implemented" stack. A null context is what a browser without WebGL returns,
// and OSD falls back from it the same way. Per test, because the config's
// restoreMocks undoes a spy before each one.
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => {
    built.splice(0).forEach((viewer) => viewer.destroy());
    document.body.innerHTML = '';
});

const OPTIONS = { showNavigationControl: false, showNavigator: false };

describe('installViewerHostGuard (real OpenSeadragon)', () => {
    const Unguarded = OpenSeadragon.Viewer;

    it('without the guard, a null element throws the error the monkey walk hit', () => {
        // Non-vacuity: the unguarded constructor is the one that fails.
        expect(() => new Unguarded({ ...OPTIONS, element: null }))
            .toThrow(/Cannot read properties of null \(reading 'appendChild'\)/);
    });

    it('leaves an export with no Viewer constructor alone', () => {
        const factoryOnly = () => ({});
        expect(installViewerHostGuard(factoryOnly)).toBeNull();
        expect(factoryOnly.Viewer).toBeUndefined();
    });

    it('is installed by the factory path and is idempotent', () => {
        const first = installViewerHostGuard(OpenSeadragon);
        const second = installViewerHostGuard(OpenSeadragon);
        expect(second).toBe(first);
        expect(OpenSeadragon.Viewer).toBe(first);
        expect(first.prototype).toBe(Unguarded.prototype);
    });

    it('a null element builds an inert, destroyable viewer through the factory', () => {
        installViewerHostGuard(OpenSeadragon);
        const viewer = OpenSeadragon({ ...OPTIONS, element: null, tileSources: '/slide.dzi' });
        built.push(viewer);
        expect(viewer).toBeInstanceOf(Unguarded);
        expect(viewer.element.isConnected).toBe(false);
        expect(viewer.world.getItemCount()).toBe(0);
        expect(typeof viewer.addHandler).toBe('function');
    });

    it('a real host is used as given', () => {
        installViewerHostGuard(OpenSeadragon);
        const host = document.createElement('div');
        document.body.appendChild(host);
        const viewer = OpenSeadragon({ ...OPTIONS, element: host });
        built.push(viewer);
        expect(viewer.element).toBe(host);
        expect(host.contains(viewer.container)).toBe(true);
    });

    it('an element id is resolved as OSD resolves it, not treated as missing', () => {
        installViewerHostGuard(OpenSeadragon);
        const host = document.createElement('div');
        host.id = 'osd-host';
        document.body.appendChild(host);
        const viewer = OpenSeadragon({ ...OPTIONS, id: 'osd-host' });
        built.push(viewer);
        expect(viewer.element).toBe(host);
    });

    it('the navigator, which OSD builds with Viewer.apply(this), still works', () => {
        installViewerHostGuard(OpenSeadragon);
        const host = document.createElement('div');
        document.body.appendChild(host);
        const viewer = OpenSeadragon({ ...OPTIONS, element: host, showNavigator: true });
        built.push(viewer);
        expect(viewer.navigator).toBeTruthy();
        expect(viewer.navigator).toBeInstanceOf(OpenSeadragon.Navigator);
    });
});
