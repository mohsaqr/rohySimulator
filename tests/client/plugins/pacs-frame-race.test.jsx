/**
 * Regression lock: the bulk-path frame race that crashed the PACS room on
 * prod (ERROR_OCCURRED · plugin_render · "input must be a Uint8Array or
 * ArrayBuffer"). On a study switch useStudy clears its byte store while a
 * stale render can still hold the OLD series object and ask for its frames;
 * before the fix frameAt decoded `undefined` and threw mid-render. A missing
 * frame must be a loading state (null), never a throw.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useStudy } from '../../../src/components/pacs/useStudy.js';

// A minimal single-slice CT the vendored parser accepts (same builder idiom
// as pacs-room.test.jsx, trimmed to what buildSeries needs).
const enc = new TextEncoder();
function el(tag, vr, value, longForm = false) {
    const group = parseInt(tag.slice(0, 4), 16);
    const element = parseInt(tag.slice(4), 16);
    const body = value instanceof Uint8Array
        ? value
        : (() => {
            if (vr === 'US') { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, value, true); return b; }
            const s = Array.isArray(value) ? value.join('\\') : String(value);
            const b = enc.encode(s);
            if (b.length % 2 === 0) return b;
            const out = new Uint8Array(b.length + 1);
            out.set(b); out[b.length] = vr === 'UI' ? 0 : 0x20;
            return out;
        })();
    const head = new Uint8Array(longForm ? 12 : 8);
    const dv = new DataView(head.buffer);
    dv.setUint16(0, group, true);
    dv.setUint16(2, element, true);
    head[4] = vr.charCodeAt(0); head[5] = vr.charCodeAt(1);
    if (longForm) dv.setUint32(8, body.length, true); else dv.setUint16(6, body.length, true);
    const out = new Uint8Array(head.length + body.length);
    out.set(head); out.set(body, head.length);
    return out;
}
function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0; parts.forEach((p) => { out.set(p, at); at += p.length; });
    return out;
}
function ctSlice() {
    const stored = new Int16Array(16).fill(1024);
    return concat([
        el('00080016', 'UI', '1.2.840.10008.5.1.4.1.1.2'),
        el('00080018', 'UI', '1.2.3.9.1'),
        el('00080060', 'CS', 'CT'),
        el('0008103e', 'LO', 'AXIAL'),
        el('0020000d', 'UI', '1.2.3.0'),
        el('0020000e', 'UI', '1.2.3.9'),
        el('00200013', 'IS', '1'),
        el('00200032', 'DS', ['-250', '-250', '0']),
        el('00200037', 'DS', ['1', '0', '0', '0', '1', '0']),
        el('00280002', 'US', 1),
        el('00280004', 'CS', 'MONOCHROME2'),
        el('00280010', 'US', 4),
        el('00280011', 'US', 4),
        el('00280030', 'DS', ['0.7', '0.7']),
        el('00280100', 'US', 16),
        el('00280101', 'US', 16),
        el('00280102', 'US', 15),
        el('00280103', 'US', 1),
        el('00281052', 'DS', '-1024'),
        el('00281053', 'DS', '1'),
        el('7fe00010', 'OW', new Uint8Array(stored.buffer.slice(0)), true),
    ]);
}

describe('useStudy bulk frame race', () => {
    it('a stale series asked for frames after a study switch gets null, not a throw', async () => {
        // study-a resolves; study-b stays IN FLIGHT — that is the window in
        // which the byte store is already cleared and nothing has refilled it.
        const loadSeries = vi.fn((studyRef) => (studyRef === 'study-a'
            ? Promise.resolve([ctSlice()])
            : new Promise(() => {})));
        const { result, rerender } = renderHook(
            ({ studyRef }) => useStudy({ ref: studyRef, loadSeries }),
            { initialProps: { studyRef: 'study-a' } },
        );
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const staleSeries = result.current.series[0];
        expect(result.current.frameAt(staleSeries, 0)).toBeTruthy();

        // Switch studies: the hook clears its byte store...
        await act(async () => { rerender({ studyRef: 'study-b' }); });
        // ...and the OLD series object, still held by a stale render, asks
        // again. Before the fix: DicomError('bad_input') thrown mid-render.
        expect(() => result.current.frameAt(staleSeries, 0)).not.toThrow();
        expect(result.current.frameAt(staleSeries, 0)).toBeNull();
    });
});
