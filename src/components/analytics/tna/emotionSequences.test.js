// Unit tests for the emotion→TNA sequence builder (Stage 3). Locks the
// contract: group by session_id, restore chronological order from the
// API's newest-first delivery, skip null dominants, drop sequences
// shorter than 2, map raw→affective states, and build readable labels.

import { describe, it, expect } from 'vitest';
import {
    EMOTION_DIMENSIONS,
    EMOTION_STATE_MAP,
    recordsToEmotionSequences,
} from './emotionSequences';

// Newest-first factory, matching the API's delivery order.
function rec(sessionId, windowStart, dominant, extra = {}) {
    return {
        session_id: sessionId,
        window_start: windowStart,
        dominant_emotion: dominant,
        ...extra,
    };
}

describe('EMOTION_STATE_MAP', () => {
    it('covers the 8 stored dominant-emotion classes plus the legacy angry alias', () => {
        expect(Object.keys(EMOTION_STATE_MAP).sort()).toEqual(
            ['anger', 'angry', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'],
        );
    });

    it('maps onto the 4 clinical affect states', () => {
        expect(new Set(Object.values(EMOTION_STATE_MAP))).toEqual(
            new Set(['engaged', 'stressed', 'discouraged', 'composed']),
        );
    });

    it('groups contempt with sad (negative-deactivating), not neutral', () => {
        expect(EMOTION_STATE_MAP.contempt).toBe('discouraged');
        expect(EMOTION_STATE_MAP.contempt).toBe(EMOTION_STATE_MAP.sad);
        expect(EMOTION_STATE_MAP.contempt).not.toBe(EMOTION_STATE_MAP.neutral);
    });

    it('exports the two supported dimensions', () => {
        expect(EMOTION_DIMENSIONS).toEqual(['raw', 'affective']);
    });
});

describe('recordsToEmotionSequences — grouping + ordering', () => {
    it('groups records by session and restores chronological order from newest-first input', () => {
        const records = [
            rec('1', '2026-07-01 10:00:20', 'neutral'),
            rec('2', '2026-07-01 09:00:10', 'fear'),
            rec('1', '2026-07-01 10:00:10', 'sad'),
            rec('2', '2026-07-01 09:00:00', 'happy'),
            rec('1', '2026-07-01 10:00:00', 'happy'),
        ];
        const { sequences } = recordsToEmotionSequences(records, { dimension: 'raw' });
        expect(sequences).toEqual([
            ['happy', 'fear'],                // session 2 started earlier
            ['happy', 'sad', 'neutral'],      // session 1
        ]);
    });

    it('orders sessions by their earliest window', () => {
        const records = [
            rec('late', '2026-07-02 12:00:10', 'sad'),
            rec('late', '2026-07-02 12:00:00', 'happy'),
            rec('early', '2026-07-01 08:00:10', 'fear'),
            rec('early', '2026-07-01 08:00:00', 'neutral'),
        ];
        const { labels } = recordsToEmotionSequences(records, { dimension: 'raw' });
        expect(labels[0]).toContain('Session early');
        expect(labels[1]).toContain('Session late');
    });

    it('falls back to reversed input order when timestamps are unparseable', () => {
        // Input is newest-first, so with no usable timestamps the sequence
        // is the reversed input order.
        const records = [
            rec('1', null, 'sad'),
            rec('1', null, 'fear'),
            rec('1', null, 'happy'),
        ];
        const { sequences } = recordsToEmotionSequences(records, { dimension: 'raw' });
        expect(sequences).toEqual([['happy', 'fear', 'sad']]);
    });
});

describe('recordsToEmotionSequences — filtering', () => {
    it('skips windows with null or empty dominant_emotion', () => {
        const records = [
            rec('1', '2026-07-01 10:00:30', 'sad'),
            rec('1', '2026-07-01 10:00:20', ''),
            rec('1', '2026-07-01 10:00:10', null),
            rec('1', '2026-07-01 10:00:00', 'happy'),
        ];
        const { sequences } = recordsToEmotionSequences(records, { dimension: 'raw' });
        expect(sequences).toEqual([['happy', 'sad']]);
    });

    it('drops sequences shorter than 2 (including after skipping nulls)', () => {
        const records = [
            rec('solo', '2026-07-01 11:00:00', 'happy'),
            rec('nully', '2026-07-01 10:00:10', null),
            rec('nully', '2026-07-01 10:00:00', 'sad'),
            rec('ok', '2026-07-01 09:00:10', 'fear'),
            rec('ok', '2026-07-01 09:00:00', 'neutral'),
        ];
        const { sequences, labels } = recordsToEmotionSequences(records, { dimension: 'raw' });
        expect(sequences).toEqual([['neutral', 'fear']]);
        expect(labels).toHaveLength(1);
        expect(labels[0]).toContain('Session ok');
    });

    it('skips malformed entries and rows without a session_id', () => {
        const records = [
            null,
            'not-a-record',
            rec(null, '2026-07-01 10:00:10', 'happy'),
            rec('1', '2026-07-01 09:00:10', 'sad'),
            rec('1', '2026-07-01 09:00:00', 'happy'),
        ];
        const { sequences } = recordsToEmotionSequences(records, { dimension: 'raw' });
        expect(sequences).toEqual([['happy', 'sad']]);
    });
});

describe('recordsToEmotionSequences — dimensions', () => {
    it('raw keeps the stored 8-class labels as-is', () => {
        const records = [
            rec('1', '2026-07-01 10:00:10', 'contempt'),
            rec('1', '2026-07-01 10:00:00', 'surprise'),
        ];
        const { sequences } = recordsToEmotionSequences(records, { dimension: 'raw' });
        expect(sequences).toEqual([['surprise', 'contempt']]);
    });

    it('affective maps each window through EMOTION_STATE_MAP', () => {
        const records = [
            rec('1', '2026-07-01 10:00:40', 'neutral'),
            rec('1', '2026-07-01 10:00:30', 'contempt'),
            rec('1', '2026-07-01 10:00:20', 'fear'),
            rec('1', '2026-07-01 10:00:10', 'surprise'),
            rec('1', '2026-07-01 10:00:00', 'happy'),
        ];
        const { sequences } = recordsToEmotionSequences(records, { dimension: 'affective' });
        expect(sequences).toEqual([
            ['engaged', 'engaged', 'stressed', 'discouraged', 'composed'],
        ]);
    });

    it('canonicalizes upstream anger and legacy angry into one raw label', () => {
        const records = [
            rec('1', '2026-07-01 10:00:10', 'angry'),
            rec('1', '2026-07-01 10:00:00', 'anger'),
        ];
        const raw = recordsToEmotionSequences(records, { dimension: 'raw' });
        const affective = recordsToEmotionSequences(records, { dimension: 'affective' });
        expect(raw.sequences).toEqual([['anger', 'anger']]);
        expect(affective.sequences).toEqual([['stressed', 'stressed']]);
    });

    it('affective passes unknown labels through literally', () => {
        const records = [
            rec('1', '2026-07-01 10:00:10', 'perplexed'),
            rec('1', '2026-07-01 10:00:00', 'happy'),
        ];
        const { sequences } = recordsToEmotionSequences(records, { dimension: 'affective' });
        expect(sequences).toEqual([['engaged', 'perplexed']]);
    });

    it('defaults to raw when no dimension is given', () => {
        const records = [
            rec('1', '2026-07-01 10:00:10', 'happy'),
            rec('1', '2026-07-01 10:00:00', 'sad'),
        ];
        const { sequences } = recordsToEmotionSequences(records);
        expect(sequences).toEqual([['sad', 'happy']]);
    });

    it('throws loudly on an unknown dimension', () => {
        expect(() => recordsToEmotionSequences([], { dimension: 'valence' }))
            .toThrow(/Unknown emotion dimension/);
    });
});

describe('recordsToEmotionSequences — labels', () => {
    it('builds "Session · user · case" labels from snapshot fields', () => {
        const records = [
            rec('42', '2026-07-01 10:00:10', 'sad', {
                username: 'alice', case_title_snapshot: 'Chest pain',
            }),
            rec('42', '2026-07-01 10:00:00', 'happy', {
                username: 'alice', case_title_snapshot: 'Chest pain',
            }),
        ];
        const { labels } = recordsToEmotionSequences(records, { dimension: 'raw' });
        expect(labels).toEqual(['Session 42 · alice · Chest pain']);
    });

    it('falls back to snapshot name, #user_id, and case id when fields are missing', () => {
        const records = [
            rec('7', '2026-07-01 10:00:10', 'sad', { student_name_snapshot: 'Bob S.', case_id: 3 }),
            rec('7', '2026-07-01 10:00:00', 'happy', { student_name_snapshot: 'Bob S.', case_id: 3 }),
            rec('8', '2026-07-02 10:00:10', 'sad', { user_id: 12 }),
            rec('8', '2026-07-02 10:00:00', 'happy', { user_id: 12 }),
        ];
        const { labels } = recordsToEmotionSequences(records, { dimension: 'raw' });
        expect(labels).toEqual(['Session 7 · Bob S. · case 3', 'Session 8 · #12']);
    });

    it('omits missing parts entirely (anonymised rows)', () => {
        const records = [
            rec('9', '2026-07-01 10:00:10', 'sad'),
            rec('9', '2026-07-01 10:00:00', 'happy'),
        ];
        const { labels } = recordsToEmotionSequences(records, { dimension: 'raw' });
        expect(labels).toEqual(['Session 9']);
    });

    it('keeps labels aligned with sequences', () => {
        const records = [
            rec('b', '2026-07-02 10:00:10', 'sad', { username: 'beth' }),
            rec('b', '2026-07-02 10:00:00', 'happy', { username: 'beth' }),
            rec('a', '2026-07-01 10:00:10', 'fear', { username: 'ann' }),
            rec('a', '2026-07-01 10:00:00', 'neutral', { username: 'ann' }),
        ];
        const { sequences, labels } = recordsToEmotionSequences(records, { dimension: 'raw' });
        expect(sequences).toHaveLength(labels.length);
        expect(labels[0]).toBe('Session a · ann');
        expect(sequences[0]).toEqual(['neutral', 'fear']);
        expect(labels[1]).toBe('Session b · beth');
        expect(sequences[1]).toEqual(['happy', 'sad']);
    });
});

describe('recordsToEmotionSequences — empty input', () => {
    it('returns empty results for [], null, undefined, and non-arrays', () => {
        for (const input of [[], null, undefined, 'nope', 42, {}]) {
            expect(recordsToEmotionSequences(input, { dimension: 'raw' }))
                .toEqual({ sequences: [], labels: [] });
        }
    });
});
