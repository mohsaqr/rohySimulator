import { describe, it, expect } from 'vitest';
import { eventsToSignalSequences } from './signalEventSequences.js';

let id = 0;
function ev(session, capture, index, state, modality = 'typing', occurred = '2026-09-16 10:00:00') {
    id += 1;
    return {
        id, session_id: String(session), capture_id: capture, sequence_index: index,
        modality, state, source: 'user', occurred_at: occurred,
        user_id: '7', student_name_snapshot: 'Ada', case_title_snapshot: 'Chest pain',
    };
}

describe('eventsToSignalSequences', () => {
    it('orders each capture by sequence_index, whatever the input order', () => {
        const rows = [ev(1, 'a', 2, 'delete'), ev(1, 'a', 0, 'start'), ev(1, 'a', 1, 'insert'), ev(1, 'a', 3, 'submit')];
        const { sequences, labels } = eventsToSignalSequences(rows, { modality: 'typing' });
        expect(sequences).toEqual([['Start', 'Insert', 'Delete', 'Send']]);
        expect(labels).toEqual(['Session 1 · Ada · Chest pain']);
    });

    it('keeps consecutive repeats — insert -> insert is fluent typing, not dwell', () => {
        const rows = [0, 1, 2].map((i) => ev(1, 'a', i, 'insert'));
        expect(eventsToSignalSequences(rows, { modality: 'typing' }).sequences).toEqual([['Insert', 'Insert', 'Insert']]);
    });

    // Regression lock: two captures in one session must not be joined, or the
    // network gains a transition that never happened (last of A -> first of B).
    it('chains per capture, never across captures of the same session', () => {
        const rows = [
            ev(1, 'a', 0, 'insert', 'typing', '2026-09-16 10:00:00'), ev(1, 'a', 1, 'submit', 'typing', '2026-09-16 10:00:00'),
            ev(1, 'b', 0, 'paste', 'typing', '2026-09-16 10:05:00'), ev(1, 'b', 1, 'abandon', 'typing', '2026-09-16 10:05:00'),
        ];
        const { sequences } = eventsToSignalSequences(rows, { modality: 'typing' });
        expect(sequences).toEqual([['Insert', 'Send'], ['Paste', 'Abandon']]);
        const joined = sequences.some((s) => s.join('>').includes('Send>Paste'));
        expect(joined).toBe(false);
    });

    it('keeps only the requested modality and readable voice names', () => {
        const rows = [
            ev(2, 'c', 0, 'start', 'voice'), ev(2, 'c', 1, 'insert', 'typing'), ev(2, 'c', 2, 'speech', 'voice'),
            ev(2, 'c', 3, 'playback', 'voice'), ev(2, 'c', 4, 'end', 'voice'),
        ];
        expect(eventsToSignalSequences(rows, { modality: 'voice' }).sequences)
            .toEqual([['Turn start', 'Speech', 'Patient speaking', 'Turn end']]);
    });

    it('drops single-state captures and orders sequences by start time', () => {
        const rows = [
            ev(3, 'late', 0, 'insert', 'typing', '2026-09-16 12:00:00'), ev(3, 'late', 1, 'pause', 'typing', '2026-09-16 12:00:00'),
            ev(4, 'lonely', 0, 'insert'),
            ev(5, 'early', 0, 'delete', 'typing', '2026-09-16 09:00:00'), ev(5, 'early', 1, 'insert', 'typing', '2026-09-16 09:00:00'),
        ];
        const { sequences, labels } = eventsToSignalSequences(rows, { modality: 'typing' });
        expect(sequences).toEqual([['Delete', 'Insert'], ['Insert', 'Pause']]);
        expect(labels.map((l) => l.split(' · ')[0])).toEqual(['Session 5', 'Session 3']);
    });

    it('is invariant to input order', () => {
        const rows = [
            ev(1, 'a', 0, 'start'), ev(1, 'a', 1, 'insert'), ev(1, 'a', 2, 'pause'),
            ev(2, 'b', 0, 'start', 'typing', '2026-09-16 11:00:00'), ev(2, 'b', 1, 'delete', 'typing', '2026-09-16 11:00:00'),
        ];
        const forward = eventsToSignalSequences(rows, { modality: 'typing' });
        const reversed = eventsToSignalSequences([...rows].reverse(), { modality: 'typing' });
        expect(reversed).toEqual(forward);
    });

    it('throws a RangeError for an unknown modality', () => {
        expect(() => eventsToSignalSequences([], { modality: 'emotion' })).toThrow(RangeError);
    });
});
