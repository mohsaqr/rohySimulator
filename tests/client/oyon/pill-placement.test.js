/**
 * Regression lock (QA-0023, external pilot v3.0.0-beta9): "the pan control in
 * the 3D patient bedside room overlaps with the oyon pill so three over four
 * commands of the pan tool (up, left, right) are not reachable".
 *
 * The immersive room package centres a 74px camera-nudge wheel in a 90px top
 * bar; the pill's historical spot was viewport top-centre at z-80, directly on
 * top of it, and the pill is the only host overlay that stacks above a plugin
 * room. The room is pinned and owns its own chrome, so the pill moves.
 */
import { describe, it, expect } from 'vitest';
import { oyonPillPlacement } from '../../../src/components/oyon/pillPlacement.js';

describe('oyonPillPlacement', () => {
    it('clears the immersive room top bar entirely', () => {
        const { centred, style } = oyonPillPlacement({ overOverlayRoom: true });
        expect(centred).toBe(false);
        // The nudge wheel spans roughly y8–y82 of a 90px bar, centred on the
        // viewport. Anything below the bar, off the centre line, is clear.
        expect(Number.parseInt(style.top, 10)).toBeGreaterThan(90);
        expect(style.left).toBe('16px');
    });

    it('an overlay room wins over the chat dock', () => {
        // Overlay rooms keep the chat layout mounted underneath, so both flags
        // can be true at once; the room the learner is looking at decides.
        const { style } = oyonPillPlacement({ overOverlayRoom: true, dockedOverMonitor: true });
        expect(style.left).toBe('16px');
    });

    it('still docks over the monitor column on the chat screen', () => {
        const { centred, style } = oyonPillPlacement({ dockedOverMonitor: true });
        expect(centred).toBe(true);
        expect(style.left).toContain('max(35vw, 350px)');
        expect(style.top).toBe('0.5rem');
    });

    it('keeps the historical top-centre spot everywhere else', () => {
        const { centred, style } = oyonPillPlacement();
        expect(centred).toBe(true);
        expect(style).toEqual({ top: '0.5rem', left: '50vw' });
    });
});
