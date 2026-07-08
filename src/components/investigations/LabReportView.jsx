import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Building2, FlaskConical, X } from 'lucide-react';
import { apiPut } from '../../services/apiClient';
import { usePatientRecord } from '../../services/PatientRecord';
import { formatDate, formatTime, formatDateTime, formatNumber } from '../../utils/formatters';

// Pure lab-report content. The hospital-style chrome (gradient header,
// patient info bar, results table, signature) is identical to what
// LabResultsModal used to render; the difference is this component owns
// no modal frame. Pass `onClose` (optional) to surface the X + Close
// buttons — they render only when a handler is provided so embedded use
// inside InvestigationsScreen drops them cleanly.
//
// Side effects live here (not in the modal wrapper) so that switching
// between results in the InvestigationsScreen viewer fires the same
// mark-as-viewed + PatientRecord.elicited writes that the modal used to
// fire on open.
export default function LabReportView({ result, patientInfo, onClose }) {
    const { t } = useTranslation('investigations');
    const { elicited } = usePatientRecord();
    const [showRanges, setShowRanges] = useState(() => {
        const saved = localStorage.getItem('rohy_show_lab_ranges');
        return saved !== null ? JSON.parse(saved) : true;
    });
    const [showFlags, setShowFlags] = useState(() => {
        const saved = localStorage.getItem('rohy_show_lab_flags');
        return saved !== null ? JSON.parse(saved) : true;
    });

    const accessionNumber = `LAB-${result?.order_id?.toString().padStart(6, '0') || '000001'}`;
    const reportDate = new Date(result?.available_at || Date.now());

    useEffect(() => {
        if (!result || result.viewed_at) return;
        // `room: 'lab'` lets the server-side learning_events INSERT
        // attribute the VIEWED_LAB_RESULT to the Laboratory room without
        // joining against NAVIGATED events.
        apiPut(`/orders/${result.order_id}/view`, { room: 'lab' }).catch((err) => {
            console.error('Failed to mark as viewed:', err);
        });
        const isAbnormal = result.current_value < result.min_value || result.current_value > result.max_value;
        elicited('lab', `${result.test_name}: ${result.current_value} ${result.unit || ''}`, isAbnormal, {
            test_name: result.test_name,
            value: String(result.current_value),
            unit: result.unit,
            reference_range: `${result.min_value}-${result.max_value}`,
            significance: isAbnormal ? 'Abnormal result' : 'Normal result',
        });
    }, [result?.order_id]);

    if (!result) return null;

    const status = evaluateValue(result.current_value, result.min_value, result.max_value);
    const flag = getFlag(status);

    const toggleRanges = () => {
        const next = !showRanges;
        setShowRanges(next);
        localStorage.setItem('rohy_show_lab_ranges', JSON.stringify(next));
    };
    const toggleFlags = () => {
        const next = !showFlags;
        setShowFlags(next);
        localStorage.setItem('rohy_show_lab_flags', JSON.stringify(next));
    };

    return (
        <div className="print-area bg-white rounded-lg w-full h-full flex flex-col shadow-2xl overflow-hidden" id="lab-results-report">
            <div className="bg-gradient-to-r from-purple-900 to-purple-800 text-white p-6">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-white/10 rounded-lg flex items-center justify-center">
                            <Building2 className="w-8 h-8 text-purple-300" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-wide">{t('lab_report_title')}</h1>
                            <p className="text-purple-300 text-sm font-medium mt-1">{t('medical_center')}</p>
                            <p className="text-purple-400 text-xs mt-0.5">{t('lab_services')}</p>
                        </div>
                    </div>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors print:hidden"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    )}
                </div>
            </div>

            <div className="bg-slate-100 border-b border-slate-200 p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                    <div className="text-slate-500 text-xs uppercase tracking-wide">{t('patient')}</div>
                    <div className="font-semibold text-slate-800">{patientInfo?.name || t('unknown_patient')}</div>
                    <div className="text-slate-600 text-xs">
                        {patientInfo?.age && t('age_yo', { age: patientInfo.age })} {patientInfo?.gender}
                    </div>
                </div>
                <div>
                    <div className="text-slate-500 text-xs uppercase tracking-wide">{t('accession_number')}</div>
                    <div className="font-mono font-semibold text-slate-800">{accessionNumber}</div>
                </div>
                <div>
                    <div className="text-slate-500 text-xs uppercase tracking-wide">{t('report_date')}</div>
                    <div className="font-semibold text-slate-800">
                        {formatDate(reportDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                    <div className="text-slate-600 text-xs">
                        {formatTime(reportDate, { hour: '2-digit', minute: '2-digit' })}
                    </div>
                </div>
                <div>
                    <div className="text-slate-500 text-xs uppercase tracking-wide">{t('status')}</div>
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                        {t('final')}
                    </div>
                </div>
            </div>

            <div className="px-6 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 print:hidden">
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input type="checkbox" checked={showRanges} onChange={toggleRanges} className="w-4 h-4 rounded" />
                        <span className="text-slate-600">{t('show_ranges')}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input type="checkbox" checked={showFlags} onChange={toggleFlags} className="w-4 h-4 rounded" />
                        <span className="text-slate-600">{t('show_flags')}</span>
                    </label>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="p-6 border-b border-slate-200">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <FlaskConical className="w-6 h-6 text-purple-600" />
                        </div>
                        <div className="flex-1">
                            <h2 className="text-xl font-bold text-slate-800">{result.test_name}</h2>
                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                                    {result.test_group || t('group_general')}
                                </span>
                                {result.gender_category && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-xs">
                                        {t('reference_category', { category: result.gender_category })}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-slate-100">
                                <th className="text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-600 font-semibold border-b border-slate-200">{t('th_test')}</th>
                                <th className="text-right py-3 px-4 text-xs uppercase tracking-wider text-slate-600 font-semibold border-b border-slate-200">{t('th_result')}</th>
                                <th className="text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-600 font-semibold border-b border-slate-200">{t('th_unit')}</th>
                                {showRanges && (
                                    <th className="text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-600 font-semibold border-b border-slate-200">{t('th_reference_range')}</th>
                                )}
                                {showFlags && (
                                    <th className="text-center py-3 px-4 text-xs uppercase tracking-wider text-slate-600 font-semibold border-b border-slate-200">{t('th_flag')}</th>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            <tr className={`${status === 'high' ? 'bg-orange-50' : status === 'low' ? 'bg-blue-50' : ''}`}>
                                <td className="py-4 px-4 text-sm font-medium text-slate-800 border-b border-slate-100">{result.test_name}</td>
                                <td className={`py-4 px-4 text-right text-xl font-bold border-b border-slate-100 ${
                                    status === 'high' ? 'text-orange-600' : status === 'low' ? 'text-blue-600' : 'text-green-600'
                                }`}>
                                    {Number.isFinite(Number(result.current_value)) && result.current_value !== null && result.current_value !== ''
                                        ? formatNumber(result.current_value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                        : t('not_available_short')}
                                </td>
                                <td className="py-4 px-4 text-sm text-slate-500 border-b border-slate-100">{result.unit || '-'}</td>
                                {showRanges && (
                                    <td className="py-4 px-4 text-sm text-slate-500 font-mono border-b border-slate-100">
                                        {result.min_value !== null && result.max_value !== null
                                            ? `${formatNumber(result.min_value)} - ${formatNumber(result.max_value)}`
                                            : t('range_not_available')}
                                    </td>
                                )}
                                {showFlags && (
                                    <td className="py-4 px-4 text-center border-b border-slate-100">
                                        {status !== 'normal' ? (
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                                                status === 'high' ? 'bg-orange-100 text-orange-700' :
                                                status === 'low' ? 'bg-blue-100 text-blue-700' :
                                                'bg-slate-100 text-slate-600'
                                            }`}>
                                                <span className="text-base">{flag.symbol}</span>
                                                {t(flag.textKey)}
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                                {t('flag_normal_check')}
                                            </span>
                                        )}
                                    </td>
                                )}
                            </tr>
                        </tbody>
                    </table>

                    {status !== 'normal' && (
                        <div className={`mt-6 p-4 rounded-lg border ${
                            status === 'high' ? 'bg-orange-50 border-orange-200' :
                            status === 'low' ? 'bg-blue-50 border-blue-200' :
                            'bg-slate-50 border-slate-200'
                        }`}>
                            <div className="flex items-start gap-3">
                                <AlertTriangle className={`w-5 h-5 mt-0.5 ${
                                    status === 'high' ? 'text-orange-500' :
                                    status === 'low' ? 'text-blue-500' :
                                    'text-slate-500'
                                }`} />
                                <div>
                                    <div className={`text-sm font-semibold mb-1 ${
                                        status === 'high' ? 'text-orange-800' :
                                        status === 'low' ? 'text-blue-800' :
                                        'text-slate-800'
                                    }`}>
                                        {status === 'low' ? t('below_normal_range') : status === 'high' ? t('above_normal_range') : t('value_status_unknown')}
                                    </div>
                                    <div className="text-sm text-slate-600">
                                        {t('outside_range_note')}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="mt-8 pt-4 border-t border-slate-200">
                        <div className="text-xs text-slate-500 space-y-1">
                            <div className="font-semibold text-slate-600 mb-2">{t('legend')}</div>
                            <div className="flex gap-6 flex-wrap">
                                <span className="flex items-center gap-1"><span className="text-orange-500">↑</span> {t('legend_high')}</span>
                                <span className="flex items-center gap-1"><span className="text-blue-500">↓</span> {t('legend_low')}</span>
                                <span className="flex items-center gap-1"><span className="text-green-500">✓</span> {t('legend_normal')}</span>
                            </div>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-slate-200 mt-8">
                        <div className="flex items-end justify-between">
                            <div>
                                <div className="text-slate-800 font-semibold">{t('electronically_verified')}</div>
                                <div className="text-slate-600 text-sm">
                                    {formatDateTime(reportDate, {
                                        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                                        hour: '2-digit', minute: '2-digit',
                                    })}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="font-serif italic text-xl text-slate-700">{t('clinical_laboratory')}</div>
                                <div className="text-slate-500 text-sm">{t('cap_accredited')}</div>
                                <div className="text-slate-400 text-xs">{t('quality_assured')}</div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-200 text-xs text-slate-400">
                        <strong>{t('note_label')}</strong> {t('lab_disclaimer')}
                    </div>
                </div>
            </div>

            <div className="bg-slate-100 border-t border-slate-200 p-4 flex items-center justify-between print:hidden">
                <div className="text-xs text-slate-500">{t('results_verified_released')}</div>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                    >
                        {t('close')}
                    </button>
                )}
            </div>
        </div>
    );
}

function evaluateValue(value, minValue, maxValue) {
    if (value === null || value === undefined) return 'unknown';
    if (value < minValue) return 'low';
    if (value > maxValue) return 'high';
    return 'normal';
}

// `textKey` is an explicit i18n key map (namespace: investigations) — one
// entry per status so every key exists statically in the catalogue.
function getFlag(status) {
    const flags = {
        low:     { symbol: '↓', textKey: 'flag_low' },
        high:    { symbol: '↑', textKey: 'flag_high' },
        normal:  { symbol: '',  textKey: 'flag_normal' },
        unknown: { symbol: '?', textKey: 'flag_unknown' },
    };
    return flags[status] || flags.unknown;
}
