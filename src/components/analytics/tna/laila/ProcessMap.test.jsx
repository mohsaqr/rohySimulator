// Component contract for the Process Map (DFG) tab — the carmdash port
// (ProcessMap.jsx). Model/threshold/geometry math is locked in
// processMapUtils.test.js; these tests lock the React surface: metric pills,
// auto/manual threshold, status line, zoom/pan transform, node drag.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ProcessMap from './ProcessMap';

// jsdom has no PointerEvent: testing-library then falls back to a plain Event
// and silently drops clientX/clientY, so drags would never move. A MouseEvent
// subclass restores the coordinate plumbing the component's drag math needs.
if (typeof window.PointerEvent === 'undefined') {
    window.PointerEvent = class PointerEvent extends MouseEvent {
        constructor(type, init = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
            this.pointerType = init.pointerType ?? 'mouse';
        }
    };
}

// Same hand-computed fixture as processMapUtils.test.js:
//   edges (absolute): Start→a 2, Start→b 1, a→b 2, b→c 2, b→End 1, c→End 2
//   auto threshold (absolute, 95%) = 1 → all 6 edges survive
const SEQS = [['a', 'b', 'c'], ['a', 'b'], ['b', 'c']];
const LABELS = ['a', 'b', 'c'];

const renderMap = () => render(<ProcessMap sequences={SEQS} labels={LABELS} colorMap={{ a: '#ff0000' }} />);

// The status line's lucide icon is also an <svg> (with a viewBox, even), so
// never grab the map with a bare 'svg' selector — use the canvas testid.
const mapSvg = (container) => container.querySelector('[data-testid="process-map-canvas"]');
const rootG = (container) => container.querySelector('[data-testid="process-map-canvas"] > g');

describe('ProcessMap', () => {
    it('renders Start/End sentinels, activity nodes, and the status line', () => {
        const { container } = renderMap();
        expect(screen.getByText('Start')).toBeTruthy();
        expect(screen.getByText('End')).toBeTruthy();
        for (const id of LABELS) expect(screen.getByText(id)).toBeTruthy();
        expect(container.textContent).toContain('3 activities · 6 edges · 3 sessions · 4 transitions');
    });

    it('shows no-data message without sequences', () => {
        const { container } = render(<ProcessMap sequences={[]} labels={[]} />);
        expect(mapSvg(container)).toBeNull();
        expect(container.textContent.trim().length).toBeGreaterThan(0);
    });

    it('metric pills switch the formatted labels (absolute counts → percentages)', () => {
        renderMap();
        // absolute: node b shows its occurrence count
        expect(screen.getAllByText('3').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Relative' }));
        // node b = 3/7 occurrences → 42.9%; Start→a edge = 2/3 → 66.7%
        expect(screen.getByText('42.9%')).toBeTruthy();
        expect(screen.getAllByText('66.7%').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Case' }));
        // case formats with 0 decimals: b present in all sequences → 100%
        expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
    });

    it('threshold input prunes edges; metric change returns to the auto threshold', () => {
        const { container } = renderMap();
        // Raise threshold to 2 → Start→b and b→End (abs 1) drop
        fireEvent.change(screen.getByLabelText('Threshold value'), { target: { value: '2' } });
        expect(container.textContent).toContain('3 activities · 4 edges');

        // Metric change resets to auto (case-metric auto keeps all 6 edges)
        fireEvent.click(screen.getByRole('button', { name: 'Case' }));
        expect(container.textContent).toContain('3 activities · 6 edges');
    });

    it('threshold slider mirrors into pruning too', () => {
        // Bigger fixture: with SEQS the slider max is ceil(2·0.5) = 1 (the
        // source slider deliberately covers only the lower half of the edge
        // range), so 2 would clamp. Here: Start→a 4, a→b 3, b→End 3,
        // a→c 1, c→End 1 → sliderMax = 2.
        const { container } = render(
            <ProcessMap
                sequences={[['a', 'b'], ['a', 'b'], ['a', 'b'], ['a', 'c']]}
                labels={['a', 'b', 'c']}
            />,
        );
        expect(container.textContent).toContain('3 activities · 5 edges · 4 sessions · 4 transitions');
        fireEvent.change(screen.getByLabelText('Threshold'), { target: { value: '2' } });
        // a→c and c→End drop; c becomes isolated and is pruned with them
        expect(container.textContent).toContain('2 activities · 3 edges · 4 sessions · 4 transitions');
    });

    it('zoom and pan sliders drive the root <g> transform; Reset View restores it', () => {
        const { container } = renderMap();
        expect(rootG(container).getAttribute('transform')).toBe('translate(0,0) scale(1)');

        fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '200' } });
        fireEvent.change(screen.getByLabelText('Pan X'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Pan Y'), { target: { value: '-50' } });
        expect(rootG(container).getAttribute('transform')).toBe('translate(100,-50) scale(2)');

        fireEvent.click(screen.getByRole('button', { name: 'Reset View' }));
        expect(rootG(container).getAttribute('transform')).toBe('translate(0,0) scale(1)');
    });

    it('dragging a node moves it; Reset Layout restores the dagre position', () => {
        const { container } = renderMap();
        const nodeG = screen.getByText('Start').closest('g');
        const before = nodeG.getAttribute('transform');
        const svg = mapSvg(container);

        fireEvent.pointerDown(nodeG, { clientX: 10, clientY: 10 });
        fireEvent.pointerMove(svg, { clientX: 60, clientY: 40 });
        fireEvent.pointerUp(svg);

        const after = screen.getByText('Start').closest('g').getAttribute('transform');
        expect(after).not.toBe(before);

        fireEvent.click(screen.getByRole('button', { name: 'Reset Layout' }));
        expect(screen.getByText('Start').closest('g').getAttribute('transform')).toBe(before);
    });

    it('background drag pans the canvas', () => {
        const { container } = renderMap();
        const svg = mapSvg(container);
        fireEvent.pointerDown(svg, { clientX: 0, clientY: 0 });
        fireEvent.pointerMove(svg, { clientX: 30, clientY: -20 });
        fireEvent.pointerUp(svg);
        expect(rootG(container).getAttribute('transform')).toBe('translate(30,-20) scale(1)');
    });
});

describe('ProcessMap exports', () => {
    // jsdom ships neither URL.createObjectURL nor a real canvas — stub the
    // blob plumbing so the CSV path runs end-to-end and capture the blob.
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    afterEach(() => {
        URL.createObjectURL = origCreate;
        URL.revokeObjectURL = origRevoke;
    });

    it('Export CSV downloads the pruned edge set with the locked column order', async () => {
        const blobs = [];
        URL.createObjectURL = vi.fn((blob) => { blobs.push(blob); return 'blob:test'; });
        URL.revokeObjectURL = vi.fn();

        renderMap();
        fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

        expect(blobs).toHaveLength(1);
        // jsdom's Blob has no .text(); FileReader is the supported read path.
        const csv = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(blobs[0]);
        });
        const lines = csv.split('\r\n');
        expect(lines[0]).toBe('from,to,absoluteCount,relativeCount,caseCount');
        // Fixture prunes to 6 edges (auto threshold keeps all): header + 6 rows.
        expect(lines).toHaveLength(7);
        expect(lines.some((l) => l.startsWith('Start,a,2,'))).toBe(true);
    });

    it('Export PNG button renders and the click path does not throw (canvas mocked away by jsdom)', () => {
        renderMap();
        const btn = screen.getByRole('button', { name: /Export PNG/ });
        expect(btn).toBeTruthy();
        // jsdom never fires Image.onload for data URLs, so the handler must
        // return cleanly after serializing the SVG.
        expect(() => fireEvent.click(btn)).not.toThrow();
    });
});
