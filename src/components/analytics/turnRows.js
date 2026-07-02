// turnRows — per-TURN gaze + emotion summary, PORTED from chatoyon-plus
// src/lib/logs/rows.ts (turnRowsFrom). Same semantics, adapted to rohy's
// tables: messages come from `interactions` (role user/assistant/system),
// sensing windows from `oyon_emotion_records`.
//
// A turn = one USER message; its sensing is the LEAD-UP — windows whose end
// falls in (previousUserMsg, thisUserMsg]. The user is sensed WHILE reading
// the prior reply + composing, so the windows end just before they hit send.
// The LAST turn also owns everything after its message (reading the final
// reply / idle), otherwise that trailing gaze would be lost. The reply shown
// is the assistant message(s) that followed, joined.
//
// Pure ESM, no DOM — imported by both the TurnsTable client surface and the
// server route GET /chat-log/turns. Privacy: only aggregate zone proportions
// are read — never raw gaze points.

import { parseTimestampMs } from './momentsJoin.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function mean(values) {
    const nums = values.filter(isNum);
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function countTransitions(seq) {
    let n = 0;
    for (let i = 1; i < seq.length; i += 1) if (seq[i] && seq[i] !== seq[i - 1]) n += 1;
    return n;
}

function parseJson(value) {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

/** Dominant zone key of a zone_proportions map (argmax; null when empty).
 *  Rohy's Oyon windows already emit the canonical 3×3 keys, so no folding
 *  is needed (chatoyon's foldGazeZones is identity for the 3×3 set). */
export function dominantZone(zones) {
    if (!zones || typeof zones !== 'object') return null;
    let best = null;
    let bestV = -Infinity;
    for (const [z, raw] of Object.entries(zones)) {
        const v = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(v) || v <= 0) continue;
        if (v > bestV) { bestV = v; best = z; }
    }
    return best;
}

/**
 * Build per-turn rows from one flat list of chat messages + sensing windows
 * (any mix of sessions — grouping happens inside).
 *
 * @param {Array<object>} messages  interactions rows, each needing:
 *   id, session_id, role ('user'|'assistant'|'system'), content, timestamp
 *   (ISO or SQLite string), and optionally username / case_name (carried
 *   through to the row).
 * @param {Array<object>} windows  oyon_emotion_records rows, each needing:
 *   session_id, window_end, dominant_emotion, valence, arousal,
 *   engagement_json (focus_score), gaze_json (zone_proportions).
 * @returns {Array<object>} TurnRow[] — id, turnIndex (1-based), ts, username,
 *   session_id, case_name, prompt, reply, gaze_dominant, gaze_top (top 3
 *   {zone,pct}), gaze_zones, gaze_transitions, gaze_distinct_zones,
 *   emotion_dominant, emotion_top (top 3 {label,pct}), emotion_transitions,
 *   valence, arousal, focus (means over the turn's windows, null when none),
 *   windowCount. Newest first.
 */
export function turnRowsFrom(messages, windows) {
    const msgsBySession = new Map();
    for (const m of Array.isArray(messages) ? messages : []) {
        if (m == null || m.session_id == null) continue;
        const key = String(m.session_id);
        if (!msgsBySession.has(key)) msgsBySession.set(key, []);
        msgsBySession.get(key).push(m);
    }

    const winsBySession = new Map();
    for (const w of Array.isArray(windows) ? windows : []) {
        if (w == null || w.session_id == null) continue;
        const endMs = parseTimestampMs(w.window_end);
        if (endMs == null) continue;
        const key = String(w.session_id);
        if (!winsBySession.has(key)) winsBySession.set(key, []);
        winsBySession.get(key).push({
            endMs,
            dom: w.dominant_emotion || null,
            valence: isNum(w.valence) ? w.valence : null,
            arousal: isNum(w.arousal) ? w.arousal : null,
            focus: (() => {
                const eng = parseJson(w.engagement_json);
                return eng && isNum(eng.focus_score) ? eng.focus_score : null;
            })(),
            zones: parseJson(w.gaze_json)?.zone_proportions ?? null,
        });
    }

    const rows = [];

    for (const [sessionKey, msgsRaw] of msgsBySession) {
        const msgs = msgsRaw
            .map((m) => ({ m, ms: parseTimestampMs(m.timestamp) }))
            .filter((x) => x.ms != null)
            .sort((a, b) => a.ms - b.ms);
        const wins = (winsBySession.get(sessionKey) || []).sort((a, b) => a.endMs - b.endMs);

        const userPositions = msgs
            .map((x, i) => ({ ...x, i }))
            .filter((x) => x.m.role === 'user');
        let prevMs = -Infinity;

        userPositions.forEach(({ m, ms, i }, turnIndex) => {
            const nextUserPos = userPositions[turnIndex + 1]?.i ?? msgs.length;
            const reply = msgs
                .slice(i + 1, nextUserPos)
                .filter((x) => x.m.role !== 'user' && typeof x.m.content === 'string' && x.m.content)
                .map((x) => x.m.content)
                .join(' ') || null;
            const isLast = turnIndex === userPositions.length - 1;
            const upper = isLast ? Infinity : ms;
            const turnWins = wins.filter((p) => p.endMs > prevMs && p.endMs <= upper);
            prevMs = ms;

            // Gaze: sum every window's zone proportions, normalize, rank.
            const zoneSum = {};
            const zoneSeq = [];
            for (const p of turnWins) {
                for (const [z, raw] of Object.entries(p.zones || {})) {
                    const v = typeof raw === 'number' ? raw : Number(raw);
                    if (Number.isFinite(v) && v > 0) zoneSum[z] = (zoneSum[z] ?? 0) + v;
                }
                zoneSeq.push(dominantZone(p.zones));
            }
            const zoneTotal = Object.values(zoneSum).reduce((a, b) => a + b, 0);
            const gaze_zones = {};
            if (zoneTotal > 0) for (const [z, v] of Object.entries(zoneSum)) gaze_zones[z] = v / zoneTotal;
            const gaze_top = Object.entries(gaze_zones)
                .map(([zone, pct]) => ({ zone, pct }))
                .sort((a, b) => b.pct - a.pct);
            const gaze_dominant = gaze_top[0]?.zone ?? null;
            const gaze_transitions = countTransitions(zoneSeq.filter(Boolean));
            const gaze_distinct_zones = gaze_top.filter((z) => z.pct > 0.05).length;

            // Emotion: tally each window's dominant label.
            const emoCounts = {};
            const emoSeq = [];
            for (const p of turnWins) {
                if (p.dom) {
                    emoCounts[p.dom] = (emoCounts[p.dom] ?? 0) + 1;
                    emoSeq.push(p.dom);
                }
            }
            const emoTotal = Object.values(emoCounts).reduce((a, b) => a + b, 0);
            const emotion_top = Object.entries(emoCounts)
                .map(([label, count]) => ({ label, pct: count / emoTotal }))
                .sort((a, b) => b.pct - a.pct);

            rows.push({
                id: `${sessionKey}-turn-${turnIndex}`,
                turnIndex: turnIndex + 1,
                ts: new Date(ms).toISOString(),
                username: m.username ?? null,
                session_id: m.session_id,
                case_name: m.case_name ?? null,
                prompt: m.content ?? null,
                reply,
                gaze_dominant,
                gaze_top: gaze_top.slice(0, 3),
                gaze_zones,
                gaze_transitions,
                gaze_distinct_zones,
                emotion_dominant: emotion_top[0]?.label ?? null,
                emotion_top: emotion_top.slice(0, 3),
                emotion_transitions: countTransitions(emoSeq),
                valence: mean(turnWins.map((p) => p.valence)),
                arousal: mean(turnWins.map((p) => p.arousal)),
                focus: mean(turnWins.map((p) => p.focus)),
                windowCount: turnWins.length,
            });
        });
    }

    rows.sort((a, b) => b.ts.localeCompare(a.ts));
    return rows;
}
