import React from 'react';
import { AlertTriangle, CheckCircle, Search, Stethoscope } from 'lucide-react';
import { BODY_REGIONS, EXAM_TECHNIQUES } from '../../data/examRegions';

/**
 * Finding Display Component
 * Shows the examination finding for the selected region and exam type
 */
export default function FindingDisplay({
    selectedRegion,
    selectedExamType,
    finding,
    isAbnormal
}) {
    // No region selected
    if (!selectedRegion) {
        return (
            <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-6 text-center">
                <Search className="w-10 h-10 mx-auto mb-3 text-slate-500" />
                <p className="text-slate-400">
                    Click on a body region to begin examination
                </p>
            </div>
        );
    }

    const region = BODY_REGIONS[selectedRegion];
    const examType = EXAM_TECHNIQUES[selectedExamType];

    // Region selected but no exam type yet
    if (!selectedExamType) {
        return (
            <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-6 text-center">
                <Stethoscope className="w-10 h-10 mx-auto mb-3 text-cyan-500" />
                <p className="text-white font-medium mb-1">
                    {region?.name || selectedRegion}
                </p>
                <p className="text-slate-400 text-sm">
                    Select an examination technique
                </p>
            </div>
        );
    }

    // Both region and exam type selected - show finding
    return (
        <div className={`
            rounded-lg border p-4 transition-all
            ${isAbnormal
                ? 'bg-red-950/30 border-red-800'
                : 'bg-slate-800/50 border-slate-700'
            }
        `}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div>
                    <span className="text-sm text-slate-400">{region?.name}</span>
                    <span className="text-slate-600 mx-2">/</span>
                    <span className="text-sm text-cyan-400">{examType?.name}</span>
                </div>
                {isAbnormal ? (
                    <span className="flex items-center gap-1 text-xs px-2 py-1 bg-red-900/50 text-red-400 rounded">
                        <AlertTriangle className="w-3 h-3" />
                        Abnormal
                    </span>
                ) : (
                    <span className="flex items-center gap-1 text-xs px-2 py-1 bg-emerald-900/50 text-emerald-400 rounded">
                        <CheckCircle className="w-3 h-3" />
                        Normal
                    </span>
                )}
            </div>

            {/* Finding text */}
            <div className={`
                text-sm leading-relaxed p-3 rounded bg-slate-900/50
                ${isAbnormal ? 'text-red-200' : 'text-slate-200'}
            `}>
                {finding || 'No finding recorded'}
            </div>
        </div>
    );
}
