// Pure gaze analytics over a pool of EmotionWindows — everything the Gaze
// view shows: aggregate summary, zone proportions, per-AOI attention targets
// ("WHAT was being looked at": patient / ECG / vitals / chat), per-window
// centroid points ("where on screen"), a per-room breakdown (uses the `room`
// stamp, each row also carrying its own per-AOI shares), and the flat
// per-window gaze log.
//
// Ported from chatoyon-plus src/lib/analytics/gaze.mjs; adaptations: the AOI
// subjects are Rohy's on-screen attention targets (aoi_dwell_ms keyed per
// AOI id — patient face, ECG trace, vitals column, chat panel; see
// screenAois.js) and the app-location stamp is Rohy's `room` instead of
// chatoyon's `page`.

import { aoiLabel } from './screenAois.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function mean(values) {
    const nums = values.filter(isNum);
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** A window's 9-zone proportions: gaze block first, engagement fallback. */
export function windowZones(w) {
    return w?.gaze?.zone_proportions ?? w?.engagement?.gaze_zone_proportions ?? null;
}

/** True when the window carries usable gaze (any tracked points). */
export function hasGaze(w) {
    return isNum(w?.gaze?.n_points) && w.gaze.n_points > 0;
}

/**
 * A window's aoi_dwell_ms map with target ids merged CASE-INSENSITIVELY:
 * real data carries ids from two capture eras that differ only by case
 * ("Patient" vs "patient", "ECG" vs "ecg", …), which used to render as
 * duplicate rows/columns. Canonical key = lowercased id; dwell values for
 * colliding ids are summed (non-numeric entries skipped, negatives clamped
 * to 0). Returns a Map so insertion (first-seen) order is preserved.
 *
 * @returns {Map<string, number>} canonical AOI id → summed dwell ms
 */
export function normalizeAoiDwell(dwellMap) {
    const out = new Map();
    if (!dwellMap || typeof dwellMap !== 'object') return out;
    for (const [id, dwell] of Object.entries(dwellMap)) {
        if (!isNum(dwell)) continue;
        const key = String(id).toLowerCase();
        out.set(key, (out.get(key) ?? 0) + Math.max(0, dwell));
    }
    return out;
}

/**
 * Share of the window spent gazing toward the patient's face region
 * (aoi_dwell_ms.patient_face / window duration), clamped to [0, 1]. Null when
 * the AOI wasn't active for that window (no patient on screen ≠ not looking).
 * The AOI key is matched case-insensitively (capture-era casing drift).
 */
export function patientGazeRatio(w) {
    const dwell = normalizeAoiDwell(w?.gaze?.aoi_dwell_ms).get('patient_face');
    const duration = w?.gaze?.duration_ms;
    if (!isNum(dwell) || !isNum(duration) || duration <= 0) return null;
    return Math.max(0, Math.min(1, dwell / duration));
}

/**
 * Per-AOI attention breakdown over a window pool: for every AOI id appearing
 * in any window's gaze.aoi_dwell_ms, the total dwell, the share of gaze time
 * (dwell / total duration_ms of the windows CARRYING that key — a window
 * where the AOI wasn't active doesn't dilute its share), and the window
 * count. Overlapping AOIs each accumulate independently, so shares need not
 * sum to 1. Sorted by dwell, largest first.
 *
 * Target ids are merged case-insensitively (via normalizeAoiDwell) so the
 * two capture eras' casings ("Chat"/"chat") aggregate as ONE target — the
 * returned `id` is the canonical lowercased id.
 *
 * @returns {Array<{id:string,label:string,dwellMs:number,share:number|null,windows:number}>}
 */
export function aoiBreakdown(windows) {
    const byId = new Map();
    for (const w of windows) {
        const dwellMap = normalizeAoiDwell(w?.gaze?.aoi_dwell_ms);
        if (dwellMap.size === 0) continue;
        const duration = w?.gaze?.duration_ms;
        for (const [id, dwell] of dwellMap) {
            const bucket = byId.get(id) ?? { dwellMs: 0, durationMs: 0, windows: 0 };
            bucket.dwellMs += dwell;
            if (isNum(duration) && duration > 0) bucket.durationMs += duration;
            bucket.windows += 1;
            byId.set(id, bucket);
        }
    }
    return [...byId.entries()]
        .map(([id, b]) => ({
            id,
            label: aoiLabel(id),
            dwellMs: b.dwellMs,
            // Clamped like patientGazeRatio — dwell can't meaningfully exceed
            // the carrying windows' duration, but be defensive about partial
            // duration_ms fields.
            share: b.durationMs > 0 ? Math.max(0, Math.min(1, b.dwellMs / b.durationMs)) : null,
            windows: b.windows,
        }))
        .sort((a, b) => b.dwellMs - a.dwellMs);
}

/** n_points-weighted mean of each zone's proportion across gaze windows. */
export function aggregateZones(windows) {
    const sums = {};
    let weightTotal = 0;
    for (const w of windows) {
        const zones = windowZones(w);
        if (!zones) continue;
        const weight = isNum(w?.gaze?.n_points) && w.gaze.n_points > 0 ? w.gaze.n_points : 1;
        weightTotal += weight;
        for (const [zone, p] of Object.entries(zones)) {
            if (isNum(p)) sums[zone] = (sums[zone] ?? 0) + p * weight;
        }
    }
    if (weightTotal === 0) return {};
    const out = {};
    for (const [zone, s] of Object.entries(sums)) out[zone] = s / weightTotal;
    return out;
}

/** The largest-share zone name of a proportions map, or null. */
export function dominantZoneOf(zones) {
    let best = null;
    let bestP = 0;
    for (const [zone, p] of Object.entries(zones ?? {})) {
        if (isNum(p) && p > bestP) {
            bestP = p;
            best = zone;
        }
    }
    return best;
}

/** "middle_center 73% | top_center 27%" — compact top-N share text. */
export function topZonesText(zones, n = 3) {
    return Object.entries(zones ?? {})
        .filter(([, p]) => isNum(p) && p > 0.005)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([zone, p]) => `${zone} ${(p * 100).toFixed(0)}%`)
        .join(' | ');
}

/** Zone map re-scaled so the shares sum to 1 (raw zone_proportions can sum
 *  below 1 when part of the window was off-screen). {} when nothing > 0. */
function normalizeShares(zones) {
    const entries = Object.entries(zones ?? {}).filter(([, p]) => isNum(p) && p > 0);
    const total = entries.reduce((acc, [, p]) => acc + p, 0);
    if (total <= 0) return {};
    return Object.fromEntries(entries.map(([zone, p]) => [zone, p / total]));
}

/**
 * "Where they look, per screen" — per-room 3×3 zone weights plus each
 * student's own zone shares in that room, ready for a ZoneBubbleMap
 * small-multiple grid. Only windows with usable gaze AND zone proportions
 * count; rooms with none are simply absent. A missing/blank room stamp
 * buckets as 'unassigned', a missing username as '(unknown)'.
 *
 * @param {Array<object>} windows EmotionWindow pool (any order)
 * @returns {Array<{
 *   room: string,
 *   windows: number,
 *   zoneWeights: Record<string, number>,
 *   students: Array<{student: string, windows: number, zones: Record<string, number>}>,
 * }>} rooms sorted by window count desc (name asc tie-break); zoneWeights and
 *   each student's zones are n_points-weighted means normalized to sum 1;
 *   students sorted by their window count desc.
 */
export function perRoomZoneStudentWeights(windows) {
    const pool = (Array.isArray(windows) ? windows : [])
        .filter((w) => hasGaze(w) && windowZones(w));

    const rooms = new Map();
    for (const w of pool) {
        const room = typeof w.room === 'string' && w.room ? w.room : 'unassigned';
        const bucket = rooms.get(room);
        if (bucket) bucket.push(w);
        else rooms.set(room, [w]);
    }

    return [...rooms.entries()]
        .map(([room, ws]) => {
            const byStudent = new Map();
            for (const w of ws) {
                const student = typeof w.username === 'string' && w.username ? w.username : '(unknown)';
                const bucket = byStudent.get(student);
                if (bucket) bucket.push(w);
                else byStudent.set(student, [w]);
            }
            return {
                room,
                windows: ws.length,
                zoneWeights: normalizeShares(aggregateZones(ws)),
                students: [...byStudent.entries()]
                    .map(([student, sws]) => ({
                        student,
                        windows: sws.length,
                        zones: normalizeShares(aggregateZones(sws)),
                    }))
                    .sort((a, b) => b.windows - a.windows || a.student.localeCompare(b.student)),
            };
        })
        .sort((a, b) => b.windows - a.windows || a.room.localeCompare(b.room));
}

/**
 * Everything the Gaze view needs, from one window pool. `logCap`/`centroidCap`
 * bound the per-window lists (newest first); `truncatedLog` reports whether
 * the cap bit.
 */
export function gazeAnalytics(windows, { logCap = 2000, centroidCap = 1500 } = {}) {
    const pool = Array.isArray(windows) ? windows : [];
    const gazeWindows = pool.filter(hasGaze);

    const zones = aggregateZones(gazeWindows);
    // "WHAT was the trainee looking at" — attention share per published AOI
    // (patient / ECG / vitals / chat), overall and per room below.
    const aois = aoiBreakdown(gazeWindows);
    const patientRatios = gazeWindows.map(patientGazeRatio).filter((r) => r !== null);
    const summary = {
        windowCount: pool.length,
        gazeWindowCount: gazeWindows.length,
        totalPoints: gazeWindows.reduce((a, w) => a + (w.gaze?.n_points ?? 0), 0),
        avgDispersion: mean(gazeWindows.map((w) => w.gaze?.dispersion)),
        avgOffScreen: mean(gazeWindows.map((w) => w.gaze?.off_screen_ratio)),
        avgCalibrationQuality: mean(gazeWindows.map((w) => w.gaze?.calibration_quality)),
        dominantZone: dominantZoneOf(zones),
        // "Looking at the patient": mean share of window time gazing toward
        // the patient's face region, over the windows where the patient was
        // on screen.
        avgPatientGaze: mean(patientRatios),
        patientGazeWindows: patientRatios.length,
    };

    // Newest-first ordering for the point/log views.
    const newestFirst = [...gazeWindows].sort((a, b) =>
        String(b.window_end ?? '').localeCompare(String(a.window_end ?? '')));

    const centroids = newestFirst
        .filter((w) => isNum(w.gaze?.centroid?.x) && isNum(w.gaze?.centroid?.y))
        .slice(0, centroidCap)
        .map((w) => ({ x: w.gaze.centroid.x, y: w.gaze.centroid.y, n: w.gaze.n_points ?? 1 }));

    // Per-room breakdown — where (in the SIMULATOR) the gaze was captured.
    const rooms = new Map();
    for (const w of gazeWindows) {
        const room = typeof w.room === 'string' && w.room ? w.room : '(unknown)';
        const bucket = rooms.get(room);
        if (bucket) bucket.push(w);
        else rooms.set(room, [w]);
    }
    const byRoom = [...rooms.entries()]
        .map(([room, ws]) => {
            const roomZones = aggregateZones(ws);
            return {
                room,
                aois: aoiBreakdown(ws),
                windows: ws.length,
                points: ws.reduce((a, w) => a + (w.gaze?.n_points ?? 0), 0),
                dominantZone: dominantZoneOf(roomZones),
                avgFocus: mean(ws.map((w) => w.engagement?.focus_score)),
                avgOffScreen: mean(ws.map((w) => w.gaze?.off_screen_ratio)),
                avgDispersion: mean(ws.map((w) => w.gaze?.dispersion)),
                avgPatientGaze: mean(ws.map(patientGazeRatio).filter((r) => r !== null)),
            };
        })
        .sort((a, b) => b.windows - a.windows);

    const log = newestFirst.slice(0, logCap).map((w) => {
        const z = windowZones(w);
        return {
            ts: String(w.window_end ?? ''),
            session_id: String(w.session_id ?? ''),
            username: typeof w.username === 'string' ? w.username : null,
            room: typeof w.room === 'string' ? w.room : null,
            n_points: w.gaze?.n_points ?? null,
            dominant_zone: dominantZoneOf(z),
            zones_top: topZonesText(z),
            centroid_x: isNum(w.gaze?.centroid?.x) ? w.gaze.centroid.x : null,
            centroid_y: isNum(w.gaze?.centroid?.y) ? w.gaze.centroid.y : null,
            dispersion: isNum(w.gaze?.dispersion) ? w.gaze.dispersion : null,
            off_screen: isNum(w.gaze?.off_screen_ratio) ? w.gaze.off_screen_ratio : null,
            patient_gaze: patientGazeRatio(w),
            calibration_quality: isNum(w.gaze?.calibration_quality) ? w.gaze.calibration_quality : null,
            focus: isNum(w.engagement?.focus_score) ? w.engagement.focus_score : null,
            gaze_entropy: isNum(w.engagement?.gaze_entropy) ? w.engagement.gaze_entropy : null,
            dominant_emotion: w.dominant_emotion ?? null,
        };
    });

    return { summary, zones, aois, centroids, byRoom, log, truncatedLog: gazeWindows.length > logCap };
}
