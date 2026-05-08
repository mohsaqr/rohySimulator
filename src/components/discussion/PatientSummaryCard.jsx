import { lazy, Suspense } from 'react';
import { FileText } from 'lucide-react';

const PatientAvatar = lazy(() => import('../chat/PatientAvatar.jsx'));

// Left-column patient panel for the debrief screen. Reuses the same 3D
// PatientAvatar the live monitor uses, so the case's configured avatar
// (or gender-based fallback) carries through into the discussion.
export default function PatientSummaryCard({ activeCase, headManifest, platformAvatars, onViewSummary }) {
    if (!activeCase) {
        return (
            <div className="text-sm text-slate-500 italic px-4">
                No active case loaded.
            </div>
        );
    }
    const cfg = activeCase.config || {};
    const name = cfg.patient_name || activeCase.name || 'Patient';
    const age = cfg.demographics?.age;
    const gender = cfg.demographics?.gender;
    const chief = cfg.structuredHistory?.chiefComplaint || activeCase.description;
    const hpi = cfg.structuredHistory?.historyOfPresentIllness;
    const avatarId = cfg.avatar_id || cfg.patient_avatar || null;

    return (
        <div className="flex flex-col gap-4 h-full">
            <div className="rounded-2xl bg-slate-800/60 border border-slate-700 shadow-xl p-5 flex flex-col items-center text-center backdrop-blur-sm">
                <div className="w-44 h-44 max-w-full mb-4">
                    <Suspense fallback={<div className="w-full h-full rounded-full bg-slate-700" />}>
                        <PatientAvatar
                            patient={{ id: activeCase.id, name, gender, age }}
                            avatarId={avatarId}
                            headManifest={headManifest}
                            platformAvatars={platformAvatars}
                        />
                    </Suspense>
                </div>
                <div className="text-base font-semibold text-slate-100">{name}</div>
                {(age || gender) && (
                    <div className="text-sm text-slate-400 mt-0.5">
                        {age ? `${age} y` : ''}{age && gender ? ' · ' : ''}{gender || ''}
                    </div>
                )}
            </div>

            {chief && (
                <div className="rounded-xl bg-slate-800/60 border border-slate-700 shadow-md p-4 backdrop-blur-sm">
                    <div className="text-xs font-semibold uppercase text-slate-400 mb-1">Chief complaint</div>
                    <div className="text-sm text-slate-100">{chief}</div>
                </div>
            )}

            {hpi && (
                <div className="rounded-xl bg-slate-800/60 border border-slate-700 shadow-md p-4 overflow-hidden backdrop-blur-sm">
                    <div className="text-xs font-semibold uppercase text-slate-400 mb-1">HPI</div>
                    <div className="text-sm text-slate-200 line-clamp-6 whitespace-pre-wrap">{hpi}</div>
                </div>
            )}

            <button
                type="button"
                onClick={onViewSummary}
                className="mt-auto rounded-xl bg-indigo-700/40 hover:bg-indigo-700/60 border border-indigo-600/50 text-indigo-100 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            >
                <FileText className="w-4 h-4" />
                View full case summary
            </button>
        </div>
    );
}
