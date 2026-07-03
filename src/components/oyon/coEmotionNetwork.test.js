// Tests for coEmotionNetwork — the emotion CO-OCCURRENCE network (R
// `cooccur` analogue): site = person, presence = the distinct dominant
// emotions that person ever showed, edge weight = number of people who
// showed BOTH. Nodes are emotions grouped by valence family.

import { describe, it, expect } from 'vitest';
import { buildCoEmotionNetwork, EMOTION_FAMILIES } from './coEmotionNetwork.js';

const rec = (user_id, dominant_emotion, over = {}) => ({
    user_id,
    session_id: `s-${user_id}`,
    dominant_emotion,
    probabilities: {
        anger: 0.05,
        contempt: 0.05,
        disgust: 0.05,
        fear: 0.05,
        happy: 0.5,
        neutral: 0.1,
        sad: 0.1,
        surprise: 0.1,
    },
    ...over,
});

describe('buildCoEmotionNetwork (cooccur over people)', () => {
    it('weights each emotion pair by the number of people showing both', () => {
        // Person 1: {happy, sad, neutral}; person 2: {happy, sad}.
        const records = [
            rec(1, 'happy'), rec(1, 'happy'), rec(1, 'sad'), rec(1, 'neutral'),
            rec(2, 'happy'), rec(2, 'sad'),
        ];
        const { edges, stats } = buildCoEmotionNetwork(records);

        expect(stats).toEqual({
            siteCount: 2,
            emotionCount: 3,
            edgeCount: 3,
            modelChannelCount: 8,
            observedDominantCount: 3,
            reason: null,
        });
        // happy↔sad seen in BOTH people = 2; the neutral pairs only in person 1 = 1.
        expect(edges).toEqual([
            { source: 'happy', target: 'sad', weight: 2 },
            { source: 'happy', target: 'neutral', weight: 1 },
            { source: 'neutral', target: 'sad', weight: 1 },
        ]);
    });

    it('builds the valence-family hierarchy with emotion leaves', () => {
        const records = [rec(1, 'happy'), rec(1, 'fear'), rec(2, 'happy'), rec(2, 'fear')];
        const { nodes } = buildCoEmotionNetwork(records);
        expect(nodes.find((n) => n.id === 'happy')).toEqual({
            id: 'happy', parent: 'family_positive', label: 'happy', group: 'happy',
        });
        expect(nodes.find((n) => n.id === 'fear').parent).toBe('family_negative');
        expect(nodes.find((n) => n.id === 'root').parent).toBe('');
    });

    it('counts each emotion once per person regardless of window count', () => {
        // happy shows up many times for person 1 but is still one incidence.
        const records = [
            rec(1, 'happy'), rec(1, 'happy'), rec(1, 'happy'), rec(1, 'sad'),
            rec(2, 'happy'), rec(2, 'sad'),
        ];
        expect(buildCoEmotionNetwork(records).edges).toEqual([
            { source: 'happy', target: 'sad', weight: 2 },
        ]);
    });

    it('falls back through username / snapshot / session for the site key', () => {
        const records = [
            { username: 'alice', session_id: 'a', dominant_emotion: 'happy' },
            { username: 'alice', session_id: 'a', dominant_emotion: 'sad' },
            { student_name_snapshot: 'Bob', session_id: 'b', dominant_emotion: 'happy' },
            { student_name_snapshot: 'Bob', session_id: 'b', dominant_emotion: 'sad' },
        ];
        expect(buildCoEmotionNetwork(records).stats.siteCount).toBe(2);
        expect(buildCoEmotionNetwork(records).edges).toEqual([
            { source: 'happy', target: 'sad', weight: 2 },
        ]);
    });

    it('supports co-occurrence by session instead of person', () => {
        const records = [
            rec(1, 'happy', { session_id: 'x' }), rec(1, 'sad', { session_id: 'x' }),
            rec(1, 'happy', { session_id: 'y' }), rec(1, 'fear', { session_id: 'y' }),
        ];
        // One person, but two sessions → happy co-occurs with sad and fear once each.
        const bySession = buildCoEmotionNetwork(records, { by: 'session' });
        expect(bySession.stats.siteCount).toBe(2);
        expect(bySession.edges).toEqual([
            { source: 'fear', target: 'happy', weight: 1 },
            { source: 'happy', target: 'sad', weight: 1 },
        ]);
        // By person it's ONE site with all three emotions.
        expect(buildCoEmotionNetwork(records, { by: 'person' }).stats.siteCount).toBe(1);
    });

    it('reports no-emotions when nothing is usable', () => {
        expect(buildCoEmotionNetwork([]).stats.reason).toBe('no-emotions');
        expect(buildCoEmotionNetwork([rec(1, null)]).stats.reason).toBe('no-emotions');
        expect(buildCoEmotionNetwork(null).stats.reason).toBe('no-emotions');
    });

    it('reports no-cooccurrence when each person shows a single emotion', () => {
        const { nodes, edges, stats } = buildCoEmotionNetwork([rec(1, 'happy'), rec(2, 'sad')]);
        expect(stats.reason).toBe('no-cooccurrence');
        expect(nodes).toEqual([]);
        expect(edges).toEqual([]);
    });

    it('maps unknown labels to the other family', () => {
        const records = [rec(1, 'bored'), rec(1, 'happy'), rec(2, 'bored'), rec(2, 'happy')];
        const { nodes } = buildCoEmotionNetwork(records);
        expect(nodes.find((n) => n.id === 'bored').parent).toBe('family_other');
        expect(EMOTION_FAMILIES.bored).toBeUndefined();
    });

    it('canonicalizes legacy angry into anger', () => {
        const records = [rec(1, 'angry'), rec(1, 'happy'), rec(2, 'anger'), rec(2, 'happy')];
        const { nodes, edges, stats } = buildCoEmotionNetwork(records);
        expect(nodes.find((n) => n.id === 'anger').parent).toBe('family_negative');
        expect(nodes.find((n) => n.id === 'angry')).toBeUndefined();
        expect(edges).toEqual([{ source: 'anger', target: 'happy', weight: 2 }]);
        expect(stats.observedDominantCount).toBe(2);
        expect(stats.modelChannelCount).toBe(8);
    });
});
