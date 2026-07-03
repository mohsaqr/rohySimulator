// Emotion co-occurrence network — the analogue of the R `cooccur` package.
//
// cooccur asks: across a set of SITES, which pairs of SPECIES co-occur?
// Here the species are emotions and each SITE is a person: an emotion is
// "present" for a person if it was ever their dominant expression in any
// capture window. Two emotions co-occur when the SAME person exhibited
// both, and the edge weight is the number of people who exhibited both
// (cooccur's observed co-occurrence count). Nodes are the emotions,
// grouped on the circle by valence family.
//
// This deliberately does NOT look at per-window probabilities (real records
// almost never store them) nor at within-window co-activation — presence is
// simply "did this person ever show this emotion", exactly cooccur's
// site × species incidence matrix.

import { canonicalEmotionLabel, observedDominantLabels, probabilityChannelLabels } from './emotionVocabulary';

const EDGE_CAP = 100;
const PAIR_SEP = '\u0001'; // NUL — cannot appear in an emotion label

// Valence families for grouping the emotions on the circle. Covers the
// 8-class Oyon vocabulary; unknown labels land in 'other'.
export const EMOTION_FAMILIES = Object.freeze({
    happy: 'positive',
    surprise: 'positive',
    neutral: 'neutral',
    sad: 'negative',
    anger: 'negative',
    fear: 'negative',
    disgust: 'negative',
    contempt: 'negative',
});

/** Normalized emotion label, or null when unusable. */
function emotionKeyOf(raw) {
    return canonicalEmotionLabel(raw);
}

/** Site (person) identity of a row: user first, then roster snapshot, then
 *  the session id so anonymous captures still form a site. */
function siteKeyOf(record) {
    const id = record?.user_id ?? record?.username ?? record?.student_name_snapshot;
    const s = id != null ? String(id).trim() : '';
    if (s) return s;
    return record?.session_id != null ? `session:${record.session_id}` : null;
}

/**
 * Build the emotion co-occurrence network over a pool of hydrated
 * emotion-record rows (order irrelevant — only per-site presence matters).
 *
 * @param {Array<object>} records hydrated rows carrying dominant_emotion and
 *   a person key (user_id / username / student_name_snapshot / session_id)
 * @param {object} [options]
 * @param {'person'|'session'} [options.by='person'] the co-occurrence SITE:
 *   one person (default) or one session
 * @returns {{
 *   nodes: Array<{id:string,parent:string,label:string,group?:string}>,
 *   edges: Array<{source:string,target:string,weight:number}>,
 *   stats: {siteCount:number,emotionCount:number,edgeCount:number,
 *           modelChannelCount:number, observedDominantCount:number,
 *           reason:null|'no-emotions'|'no-cooccurrence'},
 * }} EdgeBundling-ready hierarchy (root '' → valence-family groups →
 *   emotion leaves; leaf.group = the emotion itself so edges/labels take the
 *   emotion color) + co-occurrence edges (weight = #sites sharing the pair,
 *   desc, capped). On a degenerate pool nodes/edges are empty and
 *   stats.reason says why.
 */
export function buildCoEmotionNetwork(records, { by = 'person' } = {}) {
    const rows = Array.isArray(records) ? records : [];
    const modelChannels = probabilityChannelLabels(rows);
    const observedDominants = observedDominantLabels(rows);

    // site → Set(emotions present), and per-emotion incidence (how many
    // sites showed it) for node ordering.
    const emotionsBySite = new Map();
    for (const r of rows) {
        const emotion = emotionKeyOf(r?.dominant_emotion);
        if (!emotion) continue;
        const site = by === 'session'
            ? (r?.session_id != null ? `session:${r.session_id}` : null)
            : siteKeyOf(r);
        if (!site) continue;
        const set = emotionsBySite.get(site) ?? new Set();
        set.add(emotion);
        emotionsBySite.set(site, set);
    }

    const siteCount = emotionsBySite.size;
    const incidence = new Map(); // emotion → #sites
    const pairWeights = new Map(); // "a|b" → #sites with both
    for (const emotions of emotionsBySite.values()) {
        const arr = [...emotions].sort();
        for (const e of arr) incidence.set(e, (incidence.get(e) ?? 0) + 1);
        for (let i = 0; i < arr.length; i += 1) {
            for (let j = i + 1; j < arr.length; j += 1) {
                const key = `${arr[i]}${PAIR_SEP}${arr[j]}`;
                pairWeights.set(key, (pairWeights.get(key) ?? 0) + 1);
            }
        }
    }

    const empty = (reason) => ({
        nodes: [],
        edges: [],
        stats: {
            siteCount,
            emotionCount: incidence.size,
            edgeCount: 0,
            modelChannelCount: modelChannels.length,
            observedDominantCount: observedDominants.length,
            reason,
        },
    });
    if (incidence.size === 0) return empty('no-emotions');

    const edges = [...pairWeights.entries()]
        .map(([key, weight]) => {
            const [source, target] = key.split(PAIR_SEP);
            return { source, target, weight };
        })
        .sort((a, b) => b.weight - a.weight
            || a.source.localeCompare(b.source)
            || a.target.localeCompare(b.target))
        .slice(0, EDGE_CAP);
    if (edges.length === 0) return empty('no-cooccurrence');

    // Hierarchy: root '' → valence-family groups → emotion leaves, ordered
    // by incidence desc so the most-common emotions sit together. leaf.group
    // = the emotion → EdgeBundling colorFor(emotion) paints per emotion.
    const emotions = [...incidence.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([emotion]) => emotion);
    const familyOf = (e) => EMOTION_FAMILIES[e] ?? 'other';
    const families = [...new Set(emotions.map(familyOf))];
    const nodes = [
        { id: 'root', parent: '', label: '' },
        ...families.map((f) => ({ id: `family_${f}`, parent: 'root', label: f })),
        ...emotions.map((e) => ({
            id: e,
            parent: `family_${familyOf(e)}`,
            label: e,
            group: e,
        })),
    ];

    return {
        nodes,
        edges,
        stats: {
            siteCount,
            emotionCount: emotions.length,
            edgeCount: edges.length,
            modelChannelCount: modelChannels.length,
            observedDominantCount: observedDominants.length,
            reason: null,
        },
    };
}
