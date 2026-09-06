import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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

// Column headers are literal catalogue keys; the CSV keeps the raw field
// names (CSV_FIELDS) so a download never changes shape with the UI language.
function buildColumns(t) {
   return [
      {
         accessorKey: 'ts',
         header: t('gazelog_col_time'),
         size: 165,
         cell: (info) => (
            <CopyableCell value={info.getValue()} className="font-mono text-neutral-400 whitespace-nowrap">
               {fmtTime(info.getValue())}
            </CopyableCell>
         ),
      },
      { accessorKey: 'username', header: t('gazelog_col_user'), size: 110,
        cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-200" /> },
      { accessorKey: 'case_title', header: t('gazelog_col_case'), size: 150,
        cell: (info) => (
           <div className="truncate max-w-[150px]" title={info.getValue() ?? ''}>
              <CopyableCell value={info.getValue()} className="text-neutral-300" />
           </div>
        ) },
      { accessorKey: 'session_id', header: t('gazelog_col_session'), size: 80,
        cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-400" /> },
      { accessorKey: 'room', header: t('gazelog_col_room'), size: 110,
        meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.room) },
        cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-300" /> },
      { accessorKey: 'n_points', header: t('gazelog_col_points'), size: 70,
        cell: (info) => <span className="font-mono text-neutral-300">{info.getValue() ?? '—'}</span> },
      { accessorKey: 'dominant_zone', header: t('gazelog_col_zone'), size: 120,
        meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.dominant_zone) },
        cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-200" /> },
      { accessorKey: 'looking_at', header: t('gazelog_col_looking_at'), size: 110,
        meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.looking_at) },
        cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-200" /> },
      { accessorKey: 'zones_top', header: t('gazelog_col_top_zones'), size: 260,
        cell: (info) => (
           <div className="truncate max-w-[260px]" title={info.getValue() ?? ''}>
              <CopyableCell value={info.getValue()} className="text-neutral-400" />
           </div>
        ) },
      { accessorKey: 'focus', header: t('gazelog_col_focus'), size: 70,
        cell: (info) => <span className="font-mono text-neutral-300">{fix2(info.getValue())}</span> },
      { accessorKey: 'off_screen', header: t('gazelog_col_off_screen'), size: 85,
        cell: (info) => <span className="font-mono text-neutral-300">{pct(info.getValue())}</span> },
      { accessorKey: 'patient_gaze', header: t('gazelog_col_patient'), size: 80,
        cell: (info) => <span className="font-mono text-neutral-300">{pct(info.getValue())}</span> },
      { accessorKey: 'dispersion', header: t('gazelog_col_dispersion'), size: 90,
        cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue(), 3)}</span> },
      { accessorKey: 'dominant_emotion', header: t('gazelog_col_emotion'), size: 95,
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
      { accessorKey: 'centroid_x', header: t('gazelog_col_cx'), size: 70,
        cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue())}</span> },
      { accessorKey: 'centroid_y', header: t('gazelog_col_cy'), size: 70,
        cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue())}</span> },
      { accessorKey: 'gaze_entropy', header: t('gazelog_col_entropy'), size: 80,
        cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue(), 3)}</span> },
      { accessorKey: 'calibration_quality', header: t('gazelog_col_calib'), size: 80,
        cell: (info) => <span className="font-mono text-neutral-300">{pct(info.getValue())}</span> },
      { accessorKey: 'record_id', header: t('gazelog_col_record'), size: 160,
        cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-500" /> },
      { accessorKey: 'user_id', header: t('gazelog_col_user_id'), size: 80,
        cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-500" /> },
      { accessorKey: 'case_id', header: t('gazelog_col_case_id'), size: 80,
        cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-500" /> },
   ];
}

export default function OyonGazeLogView({ records, loading }) {
   const { t } = useTranslation('oyon');
   const rows = useMemo(() => gazeLogRows(records), [records]);
   const columns = useMemo(() => buildColumns(t), [t]);

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
         title={t('gazelog_csv_title')}
      >
         <Download className="w-3 h-3" /> {t('export_csv')}
      </button>
   ), [exportCsv, t]);

   return (
      <LogGrid
         columns={columns}
         data={rows}
         loading={loading}
         initialSorting={[{ id: 'ts', desc: true }]}
         initialColumnVisibility={INITIAL_HIDDEN}
         headerActions={headerActions}
         emptyMessage={t('gazelog_empty')}
         storageKey="loggrid.oyon.gaze"
      />
   );
}
