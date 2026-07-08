import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Hand, Pointer, Stethoscope, ClipboardCheck } from 'lucide-react';
import { EXAM_TECHNIQUES, BODY_REGIONS } from '../../data/examRegions';
import { techniqueLabel, specialTestLabel } from './examinationLabels';

/**
 * Exam Type Selector Component
 * Shows available examination techniques for the selected body region
 */

// Icon mapping
const ICONS = {
    Eye: Eye,
    Hand: Hand,
    Pointer: Pointer,
    Stethoscope: Stethoscope,
    ClipboardCheck: ClipboardCheck
};

export default function ExamTypeSelector({
    selectedRegion,
    selectedExamType,
    onExamTypeSelect,
    performedExams = new Set() // Set of "regionId:examType" strings
}) {
    const { t } = useTranslation('examination');
    if (!selectedRegion) {
        return (
            <div className="text-center py-8 text-slate-400">
                <Hand className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{t('select_region')}</p>
            </div>
        );
    }

    const region = BODY_REGIONS[selectedRegion];
    if (!region) {
        return (
            <div className="text-center py-4 text-slate-400">
                {t('unknown_region')}
            </div>
        );
    }

    const availableExamTypes = region.examTypes.map(typeId => EXAM_TECHNIQUES[typeId]);

    return (
        <div className="space-y-3">
            <div className="text-sm text-slate-400 mb-2">
                {t('choose_technique')}
            </div>

            <div className="grid grid-cols-2 gap-2">
                {availableExamTypes.map(examType => {
                    const Icon = ICONS[examType.icon] || ClipboardCheck;
                    const examKey = `${selectedRegion}:${examType.id}`;
                    const isPerformed = performedExams.has(examKey);
                    const isSelected = selectedExamType === examType.id;

                    return (
                        <button
                            key={examType.id}
                            onClick={() => onExamTypeSelect(examType.id)}
                            className={`
                                p-3 rounded-lg border transition-all flex flex-col items-center gap-2
                                ${isSelected
                                    ? 'bg-cyan-600 border-cyan-500 text-white'
                                    : isPerformed
                                        ? 'bg-slate-700/50 border-slate-600 text-slate-300'
                                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-cyan-500 hover:bg-slate-700'
                                }
                            `}
                        >
                            <Icon className={`w-6 h-6 ${isSelected ? 'text-white' : 'text-cyan-400'}`} />
                            <span className="text-sm font-medium">{techniqueLabel(t, examType.id, examType.name)}</span>
                            {isPerformed && !isSelected && (
                                <span className="text-xs text-emerald-400">{t('done')}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Special tests section.
                Bug 3 (16.5.2026): these were inert <span>s. The exam data
                models a single combined `special` finding per region (not
                per-named-test), so each chip now performs the region's
                special examination via the same handler the technique
                buttons use, passing the test name for the exam log. */}
            {region.specialTests && region.specialTests.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-700">
                    <div className="text-xs text-slate-500 mb-2">{t('special_tests_available')}</div>
                    <div className="flex flex-wrap gap-1">
                        {region.specialTests.map(test => {
                            const isSelected = selectedExamType === 'special';
                            return (
                                <button
                                    key={test}
                                    type="button"
                                    onClick={() => onExamTypeSelect('special', test)}
                                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                                        isSelected
                                            ? 'bg-cyan-600 border-cyan-500 text-white'
                                            : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-cyan-500 hover:bg-slate-700'
                                    }`}
                                >
                                    {specialTestLabel(t, test)}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
