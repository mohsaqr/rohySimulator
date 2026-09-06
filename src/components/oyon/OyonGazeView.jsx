import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScanEye } from 'lucide-react';
import ZoneBubbleMap from '../analytics/charts/ZoneBubbleMap';
import TransitionMiniCard from '../analytics/charts/TransitionMiniCard';
import { CARM_PALETTE } from '../analytics/charts/chartMath';
import { recordsToRoomSequences, recordsToGazeTargetSequences } from '../analytics/tna/windowSequences';
import { recordsToWindows } from './serverWindows';
import { gazeAnalytics, perRoomZoneStudentWeights } from './gazeAnalytics';
import { ALWAYS_SHOWN_ROOMS, gazeScreenFor, orderGazeRooms } from './gazeScreens';

/*
 * Gaze analytics over the filtered server records — the Rohy port of
 * chatoyon-plus's Gaze tab: aggregate stat chips (incl. "At patient", the
 * share of window time gazing toward the patient's face region), the
 * attention-targets breakdown ("WHAT was being looked at" — patient / ECG /
 * vitals / chat plus screen-zone fallback bars and the room × target table), the 3×3 zone grid,
 * the centroid map ("where on the screen"), and the per-room breakdown. The
 * flat per-window gaze log lives in System Logs → Oyon Data → Gaze, where it
 * uses the shared LogGrid controls/CSV export. All numbers come from the pure
 * gazeAnalytics() module (tested); this file is layout.
 */

const ZONE_ROWS = [
   ['top_left', 'top_center', 'top_right'],
   ['middle_left', 'middle_center', 'middle_right'],
   ['bottom_left', 'bottom_center', 'bottom_right'],
];

// Explicit key maps: a screen ninth / a room stamp is an enum, so its label is
// a literal catalogue key looked up by id (never t() over interpolated prose).
const ZONE_NAME_KEYS = {
   top_left: 'zone_top_left',
   top_center: 'zone_top_center',
   top_right: 'zone_top_right',
   middle_left: 'zone_middle_left',
   middle_center: 'zone_middle_center',
   middle_right: 'zone_middle_right',
   bottom_left: 'zone_bottom_left',
   bottom_center: 'zone_bottom_center',
   bottom_right: 'zone_bottom_right',
};

const ROOM_LABEL_KEYS = {
   chat: 'room_chat',
   room3d: 'room_room3d',
   examination: 'room_examination',
   lab: 'room_lab',
   radiology: 'room_radiology',
   ecg: 'room_ecg',
   pathology: 'room_pathology',
   pacs: 'room_pacs',
   consultant: 'room_consultant',
   lessons: 'room_lessons',
   settings: 'room_settings',
   tna: 'room_tna',
};

// Attention-target id → catalogue key. gazeAnalytics returns each target with
// its stable id AND an English `label`; the id is what this maps, so the
// English label stays the fallback for a target the catalogue does not name.
// The label itself is deliberately NOT translated inside gazeAnalytics: it is
// also a TNA state name (analytics/tna/windowSequences.js) and a CSV value,
// and those must not change with the reader's UI language.
const TARGET_LABEL_KEYS = {
   patient_face: 'aoi_patient_face',
   ecg_trace: 'aoi_ecg_trace',
   vitals_values: 'aoi_vitals_values',
   chat_panel: 'aoi_chat_panel',
   lesson_content: 'aoi_lesson_content',
   'zone:top_left': 'zone_target_top_left',
   'zone:top_center': 'zone_target_top_center',
   'zone:top_right': 'zone_target_top_right',
   'zone:middle_left': 'zone_target_middle_left',
   'zone:middle_center': 'zone_target_middle_center',
   'zone:middle_right': 'zone_target_middle_right',
   'zone:bottom_left': 'zone_target_bottom_left',
   'zone:bottom_center': 'zone_target_bottom_center',
   'zone:bottom_right': 'zone_target_bottom_right',
   'zone:left': 'zone_target_left',
   'zone:center': 'zone_target_center',
   'zone:right': 'zone_target_right',
   'zone:up': 'zone_target_up',
   'zone:down': 'zone_target_down',
};

function targetLabel(aoi, t) {
   const key = TARGET_LABEL_KEYS[aoi.id];
   return key ? t(key) : aoi.label;
}

const GAZE_MAP_WIDTH = 340;

// Friendly names for the room stamps on the per-screen gaze maps. The picture
// behind the map comes from the same table (gazeScreens.js); its English
// `label` is the fallback for a room the catalogue does not name.
function roomLabel(room, t) {
   const key = ROOM_LABEL_KEYS[room];
   if (key) return t(key);
   const screen = gazeScreenFor(room);
   if (screen) return screen.label;
   const s = String(room ?? '');
   return s ? s.charAt(0).toUpperCase() + s.slice(1) : t('room_unassigned');
}

export default function OyonGazeView({ records, loading }) {
   const { t } = useTranslation('oyon');
   const windows = useMemo(() => recordsToWindows(records), [records]);
   const analytics = useMemo(() => gazeAnalytics(windows), [windows]);
   const { summary, zones, aois, centroids, byRoom, targetByRoom = [] } = analytics;

   // "Where they look, per screen" — per-room zone weights + per-student
   // shares (pure helper), with one stable palette colour per student across
   // every room panel.
   // Every navigator room always gets a panel (blank when nothing was
   // captured there); app surfaces appear once the selection holds gaze
   // windows stamped with them. Each panel sits over a picture of its screen.
   // Stamps without a picture ('unassigned', an unknown key) stay out.
   const roomMaps = useMemo(() => perRoomZoneStudentWeights(windows), [windows]);
   const displayRoomMaps = useMemo(() => {
      const byRoom = new Map(
         roomMaps
            .filter((r) => gazeScreenFor(r.room))
            .map((r) => [r.room, r]),
      );
      if (byRoom.size === 0) return [];
      const rooms = orderGazeRooms([...ALWAYS_SHOWN_ROOMS, ...byRoom.keys()]);
      return rooms.map((room) => byRoom.get(room) ?? ({
         room,
         windows: 0,
         zoneWeights: {},
         students: [],
      }));
   }, [roomMaps]);
   const studentColors = useMemo(() => {
      const names = [...new Set(displayRoomMaps.flatMap((r) => r.students.map((s) => s.student)))].sort();
      return new Map(names.map((name, i) => [name, CARM_PALETTE[i % CARM_PALETTE.length]]));
   }, [displayRoomMaps]);

   // Extra: transition networks (TNA + centrality) over the same records —
   // where the gaze MOVES between screen targets, and where the student
   // MOVES between simulator locations.
   const targetSeq = useMemo(() => recordsToGazeTargetSequences(records), [records]);
   const roomSeq = useMemo(() => recordsToRoomSequences(records), [records]);

   if (!loading && summary.gazeWindowCount === 0) {
      return (
         <div className="rohy-admin-light rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
            <ScanEye className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            {t('gaze_empty')}
         </div>
      );
   }

   return (
      <div className="rohy-admin-light space-y-5">
         {/* Aggregate stat chips — the summary panel comes first. */}
         <div className="flex flex-wrap gap-2">
            <Stat label={t('stat_gaze_windows')} value={`${summary.gazeWindowCount} / ${summary.windowCount}`} />
            <Stat label={t('stat_tracked_points')} value={String(summary.totalPoints)} />
            <Stat label={t('stat_dominant_zone')} value={summary.dominantZone ?? '—'} />
            <Stat
               label={t('stat_at_patient')}
               value={pctOrDash(summary.avgPatientGaze)}
               hint={t('hint_at_patient', { count: summary.patientGazeWindows })}
               accent
            />
            <Stat label={t('stat_off_screen')} value={pctOrDash(summary.avgOffScreen)} />
            <Stat label={t('stat_dispersion')} value={fixOrDash(summary.avgDispersion)} />
            <Stat label={t('stat_calibration')} value={fixOrDash(summary.avgCalibrationQuality)} />
         </div>

         {/* Extra — transition networks with centrality (distinct styling),
             each on its OWN full-width row. Gaze targets first, then
             locations. Node size follows the selected centrality measure so
             the network and bars agree. */}
         <TransitionMiniCard
            title={t('tna_gaze_target_transitions')}
            sequences={targetSeq.sequences}
         />
         <TransitionMiniCard
            title={t('tna_location_transitions')}
            sequences={roomSeq.sequences}
         />

         {/* Attention targets — WHAT was being looked at (AOI dwell + zone fallback) */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">{t('section_attention_targets')}</h3>
            <p className="mb-3 text-xs text-gray-500">{t('attention_targets_hint')}</p>
            {aois.length === 0 ? (
               <p className="text-sm text-gray-500">{t('gaze_no_aoi_dwell')}</p>
            ) : (
               <div className="space-y-2">
                  {aois.map((a) => (
                     <div
                        key={a.id}
                        className="flex items-center gap-3"
                        title={t('aoi_tooltip', {
                           label: targetLabel(a, t),
                           share: pctOrDash(a.share),
                           dwell: formatDwell(a.dwellMs),
                           count: a.windows,
                        })}
                     >
                        <span className="w-24 shrink-0 truncate text-xs font-semibold text-gray-800">{targetLabel(a, t)}</span>
                        <div className="h-3 flex-1 overflow-hidden rounded bg-gray-100">
                           <div className="h-full rounded bg-teal-700/80" style={{ width: `${((a.share ?? 0) * 100).toFixed(1)}%` }} />
                        </div>
                        <span className="w-32 shrink-0 text-right text-xs tabular-nums text-gray-600">
                           {pctOrDash(a.share)} · {formatDwell(a.dwellMs)}
                        </span>
                     </div>
                  ))}
               </div>
            )}

            {/* Room × target share matrix — "on the chat screen, was it the
                patient, the ECG or the vitals?" */}
            {aois.length > 0 && targetByRoom.length > 0 && (
               <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                     <thead>
                        <tr className="border-b border-gray-200 text-gray-500">
                           <th className="py-1.5 pr-3 font-semibold">{t('col_room')}</th>
                           {aois.map((a) => (
                              <th key={a.id} className="py-1.5 pr-3 font-semibold">{targetLabel(a, t)}</th>
                           ))}
                        </tr>
                     </thead>
                     <tbody>
                        {targetByRoom.map((r) => {
                           const shareById = new Map(r.aois.map((a) => [a.id, a.share]));
                           return (
                              <tr key={r.room} className="border-b border-gray-200 text-gray-800">
                                 <td className="py-1.5 pr-3 font-semibold">{r.room}</td>
                                 {aois.map((a) => (
                                    <td key={a.id} className="py-1.5 pr-3 tabular-nums">{pctOrDash(shareById.get(a.id))}</td>
                                 ))}
                              </tr>
                           );
                        })}
                     </tbody>
                  </table>
               </div>
            )}
         </section>

         <div className="grid gap-4 lg:grid-cols-2">
            {/* 3×3 zone grid */}
            <section className="rounded-lg border border-gray-200 bg-white p-4">
               <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">{t('section_screen_zones')}</h3>
               <p className="mb-3 text-xs text-gray-500">{t('screen_zones_hint')}</p>
               <div className="grid aspect-[16/10] grid-cols-3 gap-1">
                  {ZONE_ROWS.flat().map((zone) => {
                     const p = zones[zone] ?? 0;
                     const zoneName = t(ZONE_NAME_KEYS[zone]);
                     return (
                        <div
                           key={zone}
                           title={t('zone_tooltip', { zone: zoneName, percent: (p * 100).toFixed(1) })}
                           className="flex flex-col items-center justify-center rounded border border-gray-200 text-gray-900"
                           style={{ background: `rgba(147, 51, 234, ${Math.min(0.85, p * 1.1)})` }}
                        >
                           <span className="text-sm font-bold tabular-nums">{(p * 100).toFixed(0)}%</span>
                           <span className="text-[9px] uppercase tracking-wide text-gray-600">{zoneName}</span>
                        </div>
                     );
                  })}
               </div>
            </section>

            {/* Centroid map */}
            <section className="rounded-lg border border-gray-200 bg-white p-4">
               <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">{t('section_gaze_centroids')}</h3>
               <p className="mb-3 text-xs text-gray-500">{t('gaze_centroids_hint')}</p>
               <CentroidMap points={centroids} t={t} />
            </section>
         </div>

         {/* Gaze maps by screen — ZoneBubbleMap small multiples, one per simulator room */}
         {displayRoomMaps.length > 0 && (
            <section className="rounded-lg border border-gray-200 bg-white p-4">
               <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">{t('section_gaze_maps')}</h3>
               <p className="mb-3 text-xs text-gray-500">{t('gaze_maps_hint')}</p>
               <div className="flex flex-wrap gap-x-12 gap-y-6">
                  {displayRoomMaps.map((r) => (
                     <ZoneBubbleMap
                        key={r.room}
                        title={t('gaze_map_title', { room: roomLabel(r.room, t), count: r.windows })}
                        screen={gazeScreenFor(r.room)}
                        zoneWeights={r.zoneWeights}
                        studentZoneWeights={r.students.map((s) => ({
                           student: s.student,
                           color: studentColors.get(s.student),
                           zones: s.zones,
                        }))}
                        width={GAZE_MAP_WIDTH}
                     />
                  ))}
               </div>
               <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-gray-600">
                  {[...studentColors.entries()].map(([name, color]) => (
                     <span key={name} className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                        {name}
                     </span>
                  ))}
               </div>
            </section>
         )}

         {/* Per-room breakdown */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-800">{t('section_gaze_by_room')}</h3>
            {byRoom.length === 0 ? (
               <p className="text-sm text-gray-500">{t('gaze_no_room_windows')}</p>
            ) : (
               <table className="w-full text-left text-xs">
                  <thead>
                     <tr className="border-b border-gray-200 text-gray-500">
                        <th className="py-1.5 pr-3 font-semibold">{t('col_room')}</th>
                        <th className="py-1.5 pr-3 font-semibold">{t('col_windows')}</th>
                        <th className="py-1.5 pr-3 font-semibold">{t('col_points')}</th>
                        <th className="py-1.5 pr-3 font-semibold">{t('col_dominant_zone')}</th>
                        <th className="py-1.5 pr-3 font-semibold">{t('col_at_patient')}</th>
                        <th className="py-1.5 pr-3 font-semibold">{t('col_off_screen')}</th>
                        <th className="py-1.5 pr-3 font-semibold">{t('col_focus')}</th>
                     </tr>
                  </thead>
                  <tbody>
                     {byRoom.map((r) => (
                        <tr key={r.room} className="border-b border-gray-200 text-gray-800">
                           <td className="py-1.5 pr-3 font-semibold">{r.room}</td>
                           <td className="py-1.5 pr-3 tabular-nums">{r.windows}</td>
                           <td className="py-1.5 pr-3 tabular-nums">{r.points}</td>
                           <td className="py-1.5 pr-3">{r.dominantZone ?? '—'}</td>
                           <td className="py-1.5 pr-3 tabular-nums">{pctOrDash(r.avgPatientGaze)}</td>
                           <td className="py-1.5 pr-3 tabular-nums">{pctOrDash(r.avgOffScreen)}</td>
                           <td className="py-1.5 pr-3 tabular-nums">{fixOrDash(r.avgFocus)}</td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            )}
         </section>

      </div>
   );
}

function Stat({ label, value, hint, accent }) {
   return (
      <div
         title={hint}
         className={`rounded-lg border px-3 py-2 ${accent ? 'border-teal-600/50 bg-teal-50' : 'border-gray-200 bg-white'}`}
      >
         <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
         <div className={`text-base font-bold tabular-nums ${accent ? 'text-teal-700' : 'text-gray-900'}`}>{value}</div>
      </div>
   );
}

// Port of chatoyon's CentroidMap: Oyon centroid convention is [-0.5, 0.5]
// both axes, origin = screen center, +y down; thirds grid mirrors the 3×3
// zones so the two views line up.
function CentroidMap({ points, t }) {
   if (points.length === 0) return <p className="text-sm text-gray-500">{t('gaze_no_centroids')}</p>;
   const W = 320;
   const H = 200;
   const clamp = (v) => Math.max(-0.5, Math.min(0.5, v));
   const maxN = Math.max(1, ...points.map((p) => p.n));
   return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t('aria_centroid_map')}>
         <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={8} fill="#f9fafb" stroke="#d1d5db" />
         {[1, 2].map((i) => (
            <g key={i} stroke="#d1d5db" strokeDasharray="3 3">
               <line x1={(W / 3) * i} y1={2} x2={(W / 3) * i} y2={H - 2} />
               <line x1={2} y1={(H / 3) * i} x2={W - 2} y2={(H / 3) * i} />
            </g>
         ))}
         {points.map((p, i) => (
            <circle
               key={i}
               cx={(clamp(p.x) + 0.5) * W}
               cy={(clamp(p.y) + 0.5) * H}
               r={2 + 5 * Math.sqrt(p.n / maxN)}
               fill="#0f766e"
               fillOpacity={0.22}
               stroke="#0f766e"
               strokeOpacity={0.4}
            >
               <title>
                  {t('centroid_tooltip', { x: p.x.toFixed(2), y: p.y.toFixed(2), count: p.n })}
               </title>
            </circle>
         ))}
         <text x={6} y={12} fontSize={8} fill="#6b7280">{t('centroid_top_left')}</text>
         <text x={W - 6} y={H - 5} fontSize={8} textAnchor="end" fill="#6b7280">{t('centroid_bottom_right')}</text>
      </svg>
   );
}

function pctOrDash(v) {
   return typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—';
}

function fixOrDash(v) {
   return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—';
}

/** Total AOI dwell as a compact human time: "42 s", "3 m 05 s". */
function formatDwell(ms) {
   if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
   const totalSeconds = Math.round(ms / 1000);
   if (totalSeconds < 60) return `${totalSeconds} s`;
   const minutes = Math.floor(totalSeconds / 60);
   const seconds = totalSeconds % 60;
   return `${minutes} m ${String(seconds).padStart(2, '0')} s`;
}
