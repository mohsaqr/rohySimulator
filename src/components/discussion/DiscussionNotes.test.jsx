// Locks in DiscussionNotes's auto-save behaviour, in particular the
// unmount-flush path: when the user closes the notes drawer / exam screen
// while a debounced save is still pending, the latest characters they typed
// must reach the server rather than being dropped by clearTimeout.
//
// Codex review (2026-05) flagged the original behaviour: the debounce
// cleanup cancelled the timer without flushing. The fix added a separate
// unmount-only effect that fires saveSessionNote synchronously (fire-and-
// forget) when dirtyRef is true on unmount.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

const saveMock = vi.fn();
const fetchMock = vi.fn();
vi.mock('../../services/notesService', () => ({
    fetchSessionNote: (...a) => fetchMock(...a),
    saveSessionNote: (...a) => saveMock(...a),
}));

import DiscussionNotes from './DiscussionNotes.jsx';

beforeEach(() => {
    saveMock.mockReset().mockResolvedValue();
    fetchMock.mockReset().mockResolvedValue({ note_text: '' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('DiscussionNotes — unmount flush', () => {
    it('flushes the in-flight save when unmounted mid-debounce', async () => {
        const { unmount, getByPlaceholderText } = render(<DiscussionNotes sessionId="sess-1" />);
        // Initial fetch resolves
        await act(async () => { await Promise.resolve(); });

        const textarea = getByPlaceholderText(/Jot down/i);
        fireEvent.change(textarea, { target: { value: 'half-typed note' } });

        // Unmount BEFORE the 500ms debounce fires.
        unmount();

        // The unmount-flush should have called saveSessionNote with the
        // latest text. Without the flush, the timer would have been cleared
        // and the save dropped entirely.
        expect(saveMock).toHaveBeenCalled();
        const [sid, text] = saveMock.mock.calls.at(-1);
        expect(sid).toBe('sess-1');
        expect(text).toBe('half-typed note');
    });

    it('does not flush if the textarea was never edited (dirty stays false)', async () => {
        const { unmount } = render(<DiscussionNotes sessionId="sess-2" />);
        await act(async () => { await Promise.resolve(); });
        unmount();
        expect(saveMock).not.toHaveBeenCalled();
    });

    it('does not flush when sessionId is missing', async () => {
        const { unmount, getByPlaceholderText } = render(<DiscussionNotes sessionId={null} />);
        await act(async () => { await Promise.resolve(); });
        const textarea = getByPlaceholderText(/Jot down/i);
        fireEvent.change(textarea, { target: { value: 'orphan note' } });
        unmount();
        expect(saveMock).not.toHaveBeenCalled();
    });
});
