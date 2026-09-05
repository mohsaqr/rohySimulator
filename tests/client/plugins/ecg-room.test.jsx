/**
 * The integration gate on the ECG room (cardoyon).
 *
 * Same posture as pacs-room.test.jsx: the upstream Cardoyon node tests prove
 * the signal pipeline and the document model in isolation and stay green
 * whether or not the room actually mounts in rohy. This test drives the real
 * plugin descriptor — available(), validate(), summarize(), props(), the
 * learner projection — and renders the real room with the host chrome, so a
 * broken prop seam is a red test here rather than a blank room in a session.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Read from disk rather than imported: the jsdom project stubs every .css
// request to an empty string (`css: false`), `?raw` included, and gives
// `import.meta.url` an http origin no file URL can be built from. `cwd` is
// vitest's `root`, which is this repo.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import descriptor from '../../../src/plugins/ecg/index.jsx';
import { create_case_document } from '../../../src/components/ecg/caseDocument.js';

const CASE_DOCUMENT = create_case_document({
    id: 'anterior-stemi-drill',
    title: 'Anterior STEMI drill',
    preset_id: 'anterior_injury_pattern',
    review: { status: 'approved', reviewed_by: 'Dr. Reviewer' },
});

const ctx = {
    pluginId: 'ecg',
    data: CASE_DOCUMENT,
    // The narrowed logger (RPS-1 1.6): the adapter hands `{ log: ctx.log }` to
    // create_ecg_logger.
    log: vi.fn(),
    t: (key, fallback) => fallback ?? key,
    session: { examMode: false },
};
const persist = { state: {}, save: vi.fn() };

beforeAll(() => {
    // jsdom has no canvas backend; the ECG paper must still mount and drive
    // its layout logic without one (same stub the PACS gate uses).
    HTMLCanvasElement.prototype.getContext = () => ({
        setTransform: () => {}, fillRect: () => {}, drawImage: () => {},
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: () => {}, save: () => {}, restore: () => {}, beginPath: () => {},
        moveTo: () => {}, lineTo: () => {}, stroke: () => {}, arc: () => {},
        fillText: () => {}, measureText: () => ({ width: 10 }), clearRect: () => {},
        scale: () => {}, translate: () => {}, closePath: () => {}, fill: () => {},
        setLineDash: () => {}, strokeRect: () => {}, rect: () => {}, clip: () => {},
    });
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

describe('ECG room — the end-to-end thin slice', () => {
    it('the descriptor gates on real material, not on a key existing', () => {
        expect(descriptor.available(ctx)).toBe(true);
        expect(descriptor.available({ data: null })).toBe(false);
        expect(descriptor.available({ data: {} })).toBe(false);
        // Total by construction: a malformed document must not take the room
        // navigator down for every other case.
        expect(() => descriptor.available({ data: { manifest: 'nonsense' } })).not.toThrow();
    });

    it('validates and summarises the authored document', () => {
        expect(descriptor.validate(CASE_DOCUMENT).filter((i) => i.level === 'error')).toEqual([]);
        expect(descriptor.summarize(CASE_DOCUMENT)).toEqual({ count: 1, labelKey: 'ecg_summary_recording' });
    });

    it('the rubric never leaves the host', () => {
        const props = descriptor.props(ctx, persist);
        expect(props.ecg_case).toBeTruthy();
        const serialised = JSON.stringify(props);
        // The rubric carries the expected read — rate ranges, rhythm, axis.
        expect(serialised).not.toContain('rubric');
        expect(serialised).not.toContain('rate_range_bpm');
        expect(serialised).not.toContain('interval_ranges_ms');
    });

    it('the learner work round-trips through per-session persistence', () => {
        const props = descriptor.props(ctx, { state: { notes: ['seed'] }, save: persist.save });
        expect(props.initial_work).toEqual({ notes: ['seed'] });
        props.on_work_change({ interpretation: 'sinus rhythm' });
        expect(persist.save).toHaveBeenCalledWith({ interpretation: 'sinus rhythm' });
    });

    it('renders the room with the host chrome: case title, top-bar controls, room nav', () => {
        const props = descriptor.props(ctx, persist);
        const Room = descriptor.component;
        render(
            <Room
                {...props}
                caseTitle="Anterior STEMI drill"
                topBarControls={<button type="button">host-control</button>}
                roomNav={<nav data-testid="host-room-nav" />}
            />
        );

        // The vendored workstation mounted…
        expect(screen.getAllByText(/Cardoyon/).length).toBeGreaterThan(0);
        // …with rohy's chrome threaded through the adapter wrapper.
        expect(screen.getByText('Anterior STEMI drill')).toBeInTheDocument();
        expect(screen.getByText('host-control')).toBeInTheDocument();
        expect(screen.getByTestId('host-room-nav')).toBeInTheDocument();
    });

    // Regression lock: the room was unscrollable and its navigator unreachable.
    // `.ecg-screen` defaults to `height: 100vh` because standalone Cardoyon owns
    // the viewport; rohy's room does not — the same column carries the room
    // navigator, so the pane is a navigator SHORTER than the viewport. Left at
    // the default the shell overflowed its pane by exactly the navigator's
    // height, the package's own `overflow: auto` panes went slack, and the
    // workstation became one tall document that scrolled its top bar (and
    // rohy's controls with it) away. Upstream made the height an embedding seam
    // (`--ecg-shell-height`, INTEGRATION.md); this asserts the host declares it.
    //
    // jsdom has no layout engine, so this is a check on the structure and the
    // declaration, not on measured pixels — the browser drive that found the
    // bug cannot run here.
    it('declares the shell height so the workstation fills its pane instead of overflowing it', () => {
        const props = descriptor.props(ctx, persist);
        const Room = descriptor.component;
        const { container } = render(
            <Room {...props} roomNav={<nav data-testid="host-room-nav" />} />
        );

        const shell = container.firstChild;
        expect(shell.className).toContain('flex-col');

        const pane = [...shell.children].find((child) => child.className.includes('flex-1'));
        expect(pane).toBeTruthy();
        expect(pane.style.getPropertyValue('--ecg-shell-height')).toBe('100%');
        expect(pane.className).toContain('min-h-0');
        // The package scrolls internally now, so the host pane must NOT: a host
        // scrollbar here would hide a slack shell rather than surface it.
        expect(pane.className).toContain('overflow-hidden');
        expect(pane.querySelector('.ecg-screen')).toBeTruthy();
    });

    it('the room navigator sits outside the workstation pane and cannot be shrunk away', () => {
        const props = descriptor.props(ctx, persist);
        const Room = descriptor.component;
        const { container } = render(
            <Room {...props} roomNav={<nav data-testid="host-room-nav" />} />
        );

        const shell = container.firstChild;
        const navSlot = screen.getByTestId('host-room-nav').parentElement;
        expect(navSlot.parentElement).toBe(shell);
        expect(navSlot.className).toContain('shrink-0');

        const pane = [...shell.children].find((child) => child.className.includes('flex-1'));
        expect(pane.contains(navSlot)).toBe(false);
    });

    // The other half of the same contract, on the vendored side: a re-vendor
    // from an upstream that went back to `min-height: 100vh` would leave the
    // host declaration above intact and silently restore the bug, because a
    // min-height the host cannot override wins over the height it declares.
    it('the vendored stylesheet takes the shell height from the host seam', () => {
        const css = readFileSync(
            join(process.cwd(), 'src/components/ecg-styles/package.css'), 'utf8',
        );
        const shellRule = css.split('\n').find((line) => line.trimStart().startsWith('.ecg-screen {'));
        expect(shellRule).toBeTruthy();
        expect(shellRule).toContain('height: var(--ecg-shell-height, 100vh)');
        expect(shellRule).not.toContain('min-height: 100vh');
        // The row that hands the workspace and the rail a bounded height. An
        // implicit `auto` row is sized to max-content and `align-content:
        // stretch` can only grow it, so neither pane would ever scroll.
        const roomRule = css.split('\n').find((line) => line.trimStart().startsWith('.ecg-room {'));
        expect(roomRule).toContain('grid-template-rows: minmax(0, 1fr)');
    });
});

describe('ECG authoring studio — the host shell', () => {
    // Regression lock: PluginAuthorSurface hands Done/Discard down as
    // camelCase `topBarControls`; the vendored CaseAuthor only knows
    // snake_case `top_bar_controls`. Mounting CaseAuthor directly dropped
    // the controls — an educator could neither save nor leave the studio —
    // and the fixed overlay had no scrolling element.
    it('threads the host controls into the studio and provides the scroller', () => {
        const Author = descriptor.authorComponent;
        const { container } = render(
            <Author
                topBarControls={<button type="button">host-done</button>}
                caseTitle="Anterior STEMI drill"
                initial_document={CASE_DOCUMENT}
                on_change={() => {}}
            />
        );
        expect(screen.getByText('host-done')).toBeInTheDocument();
        expect(screen.getByText('Anterior STEMI drill')).toBeInTheDocument();
        // The studio must sit inside the host's scroll pane — the overlay
        // parent it mounts into cannot scroll.
        const studio = container.querySelector('.ecg-author');
        expect(studio).toBeTruthy();
        const scroller = studio.closest('.overflow-y-auto');
        expect(scroller).toBeTruthy();
    });
});
