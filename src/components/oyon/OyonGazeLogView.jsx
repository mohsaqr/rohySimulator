import React, { useCallback, useMemo } from 'react';
import { Download } from 'lucide-react';
import LogGrid, { CopyableCell } from '../analytics/LogGrid';
import { buildCsv, downloadCsv } from '../analytics/csvExport';
import { uniqueValues } from '../analytics/FilterBar';
import { emotionColor, fix2, fmtTime } from './emotionLogShared';
import {
   dominantZoneOf,
   hasGaze,
   normalizeAoiDwell,
   patientGazeRatio,
   topZonesText,
   windowZones,
   zoneTargetLabel,
} from './gazeAnalytics';
import { aoiLabel } from './screenAois';

const CSV_FIELDS = [
   'ts', 'session_id', 'record_id', 'user_id', 'username', 'case_id',
   'case_title', 'room', 'n_points', 'dominant_zone', 'zones_top',
   'looking_at', 'centroid_x', 'centroid_y', 'dispersion', 'off_screen',
   'patient_gaze', 'focus', 'gaze_entropy', 'calibration_quality',
   'dominant_emotion',
];

const INITIAL_HIDDEN = {
   record_id: false,
   user_id: false,
   case_id: false,
   centroid_x: false,
   centroid_y: false,
   gaze_entropy: false,
   calibration_quality: false,
};

function pct(v) {
   return typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—';
}

function num(v, digits = 2) {
   return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
}

function topAoiTarget(record) {
   const dwell = [...normalizeAoiDwell(record?.gaze?.aoi_dwell_ms)]
      .filter(([, ms]) => typeof ms === 'number' && Number.isFinite(ms) && ms > 0)
      .sort((a, b) => b[1] - a[1]);
   if (dwell.length > 0) return aoiLabel(dwell[0][0]);

   const zones = windowZones(record);
   const zone = dominantZoneOf(zones);
   return zone ? zoneTargetLabel(zone) : null;
}

function gazeLogRows(records) {
   return (Array.isArray(records) ? records : [])
      .filter(hasGaze)
      .sort((a, b) => String(b.window_end ?? '').localeCompare(String(a.window_end ?? '')))
      .map((r, index) => {
         const zones = windowZones(r);
         return {
            id: r.id ?? `${r.window_end ?? ''}-${r.session_id ?? ''}-${index}`,
            ts: String(r.window_end ?? ''),
            session_id: r.session_id != null ? String(r.session_id) : '',
            record_id: r.record_id != null ? String(r.record_id) : (r.id != null ? String(r.id) : ''),
            user_id: r.user_id != null ? String(r.user_id) : '',
            username: r.username || r.student_name_snapshot || (r.user_id != null ? `#${r.user_id}` : null),
            case_id: r.case_id != null ? String(r.case_id) : '',
            case_title: r.case_title_snapshot || (r.case_id != null ? `case ${r.case_id}` : null),
            room: typeof r.room === 'string' && r.room ? r.room : null,
            n_points: r.gaze?.n_points ?? null,
            dominant_zone: dominantZoneOf(zones),
            zones_top: topZonesText(zones),
            looking_at: topAoiTarget(r),
            centroid_x: typeof r.gaze?.centroid?.x === 'number' && Number.isFinite(r.gaze.centroid.x) ? r.gaze.centroid.x : null,
            centroid_y: typeof r.gaze?.centroid?.y === 'number' && Number.isFinite(r.gaze.centroid.y) ? r.gaze.centroid.y : null,
            dispersion: typeof r.gaze?.dispersion === 'number' && Number.isFinite(r.gaze.dispersion) ? r.gaze.dispersion : null,
            off_screen: typeof r.gaze?.off_screen_ratio === 'number' && Number.isFinite(r.gaze.off_screen_ratio) ? r.gaze.off_screen_ratio : null,
            patient_gaze: patientGazeRatio(r),
            focus: typeof r.engagement?.focus_score === 'number' && Number.isFinite(r.engagement.focus_score) ? r.engagement.focus_score : null,
            gaze_entropy: typeof r.engagement?.gaze_entropy === 'number' && Number.isFinite(r.engagement.gaze_entropy) ? r.engagement.gaze_entropy : null,
            calibration_quality: typeof r.gaze?.calibration_quality === 'number' && Number.isFinite(r.gaze.calibration_quality) ? r.gaze.calibration_quality : null,
            dominant_emotion: r.dominant_emotion ?? null,
         };
      });
}

const COLUMNS = [
   {
      accessorKey: 'ts',
      header: 'time',
      size: 165,
      cell: (info) => (
         <CopyableCell value={info.getValue()} className="font-mono text-neutral-400 whitespace-nowrap">
            {fmtTime(info.getValue())}
         </CopyableCell>
      ),
   },
   { accessorKey: 'username', header: 'user', size: 110,
     cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-200" /> },
   { accessorKey: 'case_title', header: 'case', size: 150,
     cell: (info) => (
        <div className="truncate max-w-[150px]" title={info.getValue() ?? ''}>
           <CopyableCell value={info.getValue()} className="text-neutral-300" />
        </div>
     ) },
   { accessorKey: 'session_id', header: 'session', size: 80,
     cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-400" /> },
   { accessorKey: 'room', header: 'room', size: 110,
     meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.room) },
     cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-300" /> },
   { accessorKey: 'n_points', header: 'points', size: 70,
     cell: (info) => <span className="font-mono text-neutral-300">{info.getValue() ?? '—'}</span> },
   { accessorKey: 'dominant_zone', header: 'zone', size: 120,
     meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.dominant_zone) },
     cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-200" /> },
   { accessorKey: 'looking_at', header: 'looking at', size: 110,
     meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.looking_at) },
     cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-200" /> },
   { accessorKey: 'zones_top', header: 'top zones', size: 260,
     cell: (info) => (
        <div className="truncate max-w-[260px]" title={info.getValue() ?? ''}>
           <CopyableCell value={info.getValue()} className="text-neutral-400" />
        </div>
     ) },
   { accessorKey: 'focus', header: 'focus', size: 70,
     cell: (info) => <span className="font-mono text-neutral-300">{fix2(info.getValue())}</span> },
   { accessorKey: 'off_screen', header: 'off-screen', size: 85,
     cell: (info) => <span className="font-mono text-neutral-300">{pct(info.getValue())}</span> },
   { accessorKey: 'patient_gaze', header: 'patient', size: 80,
     cell: (info) => <span className="font-mono text-neutral-300">{pct(info.getValue())}</span> },
   { accessorKey: 'dispersion', header: 'dispersion', size: 90,
     cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue(), 3)}</span> },
   { accessorKey: 'dominant_emotion', header: 'emotion', size: 95,
     meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.dominant_emotion) },
     cell: (info) => {
        const v = info.getValue();
        if (!v) return <span className="text-neutral-600">—</span>;
        return (
           <span
              className="px-1.5 py-0.5 rounded font-medium text-[11px] text-neutral-900"
              style={{ background: emotionColor(v) }}
           >
              {v}
           </span>
        );
     } },
   { accessorKey: 'centroid_x', header: 'cx', size: 70,
     cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue())}</span> },
   { accessorKey: 'centroid_y', header: 'cy', size: 70,
     cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue())}</span> },
   { accessorKey: 'gaze_entropy', header: 'entropy', size: 80,
     cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue(), 3)}</span> },
   { accessorKey: 'calibration_quality', header: 'calib', size: 80,
     cell: (info) => <span className="font-mono text-neutral-300">{pct(info.getValue())}</span> },
   { accessorKey: 'record_id', header: 'record', size: 160,
     cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-500" /> },
   { accessorKey: 'user_id', header: 'user id', size: 80,
     cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-500" /> },
   { accessorKey: 'case_id', header: 'case id', size: 80,
     cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-500" /> },
];

export default function OyonGazeLogView({ records, loading }) {
   const rows = useMemo(() => gazeLogRows(records), [records]);

   const exportCsv = useCallback((exportRows) => {
      downloadCsv(
         buildCsv(exportRows, CSV_FIELDS),
         `oyon-gaze-log_${new Date().toISOString().slice(0, 10)}.csv`,
      );
   }, []);

   const headerActions = useCallback(({ visibleRows }) => (
      <button
         onClick={() => exportCsv(visibleRows)}
         disabled={visibleRows.length === 0}
         className="px-2 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs text-white flex items-center gap-1 disabled:opacity-50"
         title="Download the currently listed gaze rows as CSV (all gaze fields)"
      >
         <Download className="w-3 h-3" /> CSV
      </button>
   ), [exportCsv]);

   return (
      <LogGrid
         columns={COLUMNS}
         data={rows}
         loading={loading}
         initialSorting={[{ id: 'ts', desc: true }]}
         initialColumnVisibility={INITIAL_HIDDEN}
         headerActions={headerActions}
         emptyMessage="No gaze windows match the current filters."
         storageKey="loggrid.oyon.gaze"
      />
   );
}
