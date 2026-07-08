import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle, Circle, Clock, Trash2 } from 'lucide-react';
import { BODY_REGIONS, EXAM_TECHNIQUES } from '../../data/examRegions';
import { regionLabel, techniqueLabel } from './examinationLabels';
import { formatTime } from '../../utils/formatters';

/**
 * Exam Log Component
 * Tracks and displays all performed examinations
 */
export default function ExamLog({
    examLog = [], // Array of { regionId, examType, finding, abnormal, timestamp }
    onClearLog,
    onSelectExam
}) {
    const { t } = useTranslation('examination');
    if (examLog.length === 0) {
        return (
            <div className="bg-slate-800/30 rounded-lg border border-slate-700/50 p-4">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-slate-400">{t('exam_log')}</h4>
                </div>
                <div className="text-center py-4 text-slate-500 text-sm">
                    <Circle className="w-6 h-6 mx-auto mb-2 opacity-50" />
                    {t('no_exams_yet')}
                </div>
            </div>
        );
    }

    // Count stats
    const normalCount = examLog.filter(e => !e.abnormal).length;
    const abnormalCount = examLog.filter(e => e.abnormal).length;

    return (
        <div className="bg-slate-800/30 rounded-lg border border-slate-700/50 p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-slate-400">{t('exam_log')}</h4>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-emerald-400">{t('normal_count', { count: normalCount })}</span>
                    {abnormalCount > 0 && (
                        <span className="text-xs text-red-400">{t('abnormal_count', { count: abnormalCount })}</span>
                    )}
                    {onClearLog && (
                        <button
                            onClick={onClearLog}
                            className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                            title={t('clear_log')}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Log entries */}
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {examLog.map((entry, index) => {
                    const region = BODY_REGIONS[entry.regionId];
                    const examType = EXAM_TECHNIQUES[entry.examType];

                    return (
                        <div
                            key={`${entry.regionId}-${entry.examType}-${index}`}
                            onClick={() => onSelectExam && onSelectExam(entry)}
                            className={`
                                flex items-center gap-2 p-2 rounded text-sm cursor-pointer
                                transition-colors hover:bg-slate-700/50
                                ${entry.abnormal ? 'text-red-300' : 'text-slate-300'}
                            `}
                        >
                            {entry.abnormal ? (
                                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                            ) : (
                                <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                            )}
                            <span className="flex-1 truncate">
                                {t('log_entry', {
                                    region: regionLabel(t, entry.regionId, region?.name),
                                    technique: techniqueLabel(t, entry.examType, examType?.name)
                                })}
                            </span>
                            {entry.timestamp && (
                                <span className="text-xs text-slate-500 flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {formatTime(entry.timestamp, {
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Summary */}
            <div className="mt-3 pt-3 border-t border-slate-700/50 text-xs text-slate-500">
                {t('exams_performed', { count: examLog.length })}
            </div>
        </div>
    );
}
