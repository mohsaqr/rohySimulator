// Location + gaze-target sequence builders — the two extra transition
// networks alongside the emotion one (emotionSequences.js). Same input
// (hydrated /addons/oyon/emotion-records rows, newest-first) and the same
// per-session grouping/ordering conventions, but the per-window state is:
//
//   rooms — the room the window was captured in (chat/examination/lab/
//           radiology/consultant → readable labels), i.e. transitions
//           between LOCATIONS in the simulator.
//   gaze  — the window's dominant attention target: argmax of the
//           normalized aoi_dwell_ms map (Patient / ECG / Chat / Vitals…),
//           falling back to the dominant 3×3 screen zone when no AOI was
//           registered, i.e. transitions between SCREEN CENTERS.
//
// Both collapse consecutive repeats: windows arrive on a ~10 s cadence, so
// runs of the same room/target are dwell, not transitions — without the
// collapse the network is one giant self-loop per node.

import { normalizeAoiDwell, windowZones, dominantZoneOf } from '../../oyon/gazeAnalytics.js';
import { aoiLabel } from '../../oyon/screenAois.js';

// Same readable room names the Gaze view uses.
const ROOM_LABELS = {
    chat: 'Patient (main)',
    examination: 'Examination',
    lab: 'Lab',
    radiology: 'Radiology',
    consultant: 'Discussant',
};

function roomState(rec) {
    const room = typeof rec.room === 'string' ? rec.room.trim().toLowerCase() : '';
    if (!room) return null;
    if (ROOM_LABELS[room]) return ROOM_LABELS[room];
    return room.charAt(0).toUpperCase() + room.slice(1);
}

// Short, readable region names for the 3×3 gaze-zone fallback (so the
// transition network shows "center" / "left" rather than "middle_center").
const ZONE_SHORT = {
    top_left: 'Top-left', top_center: 'Top', top_right: 'Top-right',
    middle_left: 'Left', middle_center: 'Center', middle_right: 'Right',
    bottom_left: 'Bottom-left', bottom_center: 'Bottom', bottom_right: 'Bottom-right',
};

function gazeTargetState(rec) {
    const dwell = normalizeAoiDwell(rec.gaze?.aoi_dwell_ms);
    let best = null;
    let bestMs = 0;
    for (const [id, ms] of dwell) {
        if (ms > bestMs) { best = id; bestMs = ms; }
    }
    if (best) return aoiLabel(best);
    const zone = dominantZoneOf(windowZones(rec));
    if (!zone) return null;
    return ZONE_SHORT[zone] ?? zone.replace(/_/g, ' ');
}

// SQLite timestamps come back as 'YYYY-MM-DD HH:MM:SS' (no zone) or ISO
// strings; treat zoneless values as UTC (emotionSequences convention).
function windowStartMs(value) {
    if (typeof value !== 'string' || !value) return NaN;
    const iso = value.includes('T') ? value : value.replace(' ', 'T');
    const hasZone = /Z$|[+-]\d\d:?\d\d$/.test(iso);
    return Date.parse(hasZone ? iso : `${iso}Z`);
}

function sequenceLabel(sessionId, rec) {
    const parts = [`Session ${sessionId}`];
    const who = rec.username || rec.student_name_snapshot
        || (rec.user_id != null ? `#${rec.user_id}` : null);
    if (who) parts.push(String(who));
    const caseLabel = rec.case_title_snapshot
        || (rec.case_id != null ? `case ${rec.case_id}` : null);
    if (caseLabel) parts.push(String(caseLabel));
    return parts.join(' · ');
}

/**
 * Generic per-session window-sequence builder.
 *
 * @param {Array<object>} records newest-first emotion-record rows
 * @param {(rec: object) => string|null} stateOf per-window state extractor
 * @returns {{ sequences: string[][], labels: string[] }} one collapsed
 *   chronological sequence per session (nulls skipped, consecutive repeats
 *   merged, sequences shorter than 2 dropped), sessions ordered by their
 *   earliest window; labels align with sequences.
 */
function buildWindowSequences(records, stateOf) {
    const rows = Array.isArray(records) ? records : [];

    const groups = new Map();
    rows.forEach((rec, idx) => {
        if (!rec || typeof rec !== 'object' || rec.session_id == null) return;
        const key = String(rec.session_id);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ rec, idx, ms: windowStartMs(rec.window_start) });
    });

    const built = [];
    for (const [sessionId, entries] of groups) {
        entries.sort((a, b) => {
            const byTime = (Number.isFinite(a.ms) && Number.isFinite(b.ms)) ? a.ms - b.ms : 0;
            return byTime !== 0 ? byTime : b.idx - a.idx; // input is newest-first
        });
        const states = [];
        for (const { rec } of entries) {
            const state = stateOf(rec);
            if (state == null || state === '') continue;
            if (states[states.length - 1] === state) continue; // collapse runs
            states.push(state);
        }
        if (states.length < 2) continue;
        built.push({
            sequence: states,
            label: sequenceLabel(sessionId, entries[0].rec),
            startMs: entries[0].ms,
        });
    }

    built.sort((a, b) => {
        if (Number.isFinite(a.startMs) && Number.isFinite(b.startMs)) return a.startMs - b.startMs;
        return 0;
    });

    return {
        sequences: built.map((b) => b.sequence),
        labels: built.map((b) => b.label),
    };
}

/**
 * Per-session LOCATION sequences — transitions between simulator rooms.
 * @param {Array<object>} records newest-first emotion-record rows
 * @returns {{ sequences: string[][], labels: string[] }}
 */
export function recordsToRoomSequences(records) {
    return buildWindowSequences(records, roomState);
}

/**
 * Per-session GAZE-TARGET sequences — transitions between screen centers:
 * dominant AOI target per window (Patient/ECG/Chat/Vitals…), dominant 3×3
 * zone when no AOI dwell was recorded.
 * @param {Array<object>} records newest-first emotion-record rows
 * @returns {{ sequences: string[][], labels: string[] }}
 */
export function recordsToGazeTargetSequences(records) {
    return buildWindowSequences(records, gazeTargetState);
}
