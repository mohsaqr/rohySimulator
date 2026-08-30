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
    eventLogger: { log: vi.fn() },
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
});
