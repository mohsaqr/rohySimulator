import { lazy, Suspense, useMemo, useRef } from 'react';
import { User, Loader2 } from 'lucide-react';
import { useVoice } from '../../contexts/VoiceContext';
import { PATIENT_AOI_ID, FACE_BOX } from '../oyon/screenAois';
import { useAoiPublisher } from '../oyon/useAoiPublisher';

// Lazy-load the 3D head — pulls in three.js / r3f / drei (~250 KB gzip).
const PatientAvatar = lazy(() => import('../chat/PatientAvatar'));

// Renders the active speaker's avatar in the patient panel. The active
// speaker is provided via the `participant` prop — it can be the patient
// (derived from caseData) or any agent (Nurse / Consultant / Relative)
// when the trainee switches tabs in the multi-agent UI.
//
// Participant shape:
//   {
//     avatar_id?:    string  — GLB filename
//     avatar_camera?: { pos, lookY, fov }
//     gender?:       string  — for platform-default fallback resolution
//     name?:         string
//     age?:          number  — for the demographic auto-pick fallback
//   }
//
// For backward compatibility, if no `participant` is passed but `caseData`
// is, we synthesise a participant from caseData.config.
export default function PatientVisual({ caseData, participant }) {
    const { speaking, listening, visemes, voiceSettings, headManifest, platformAvatars, activeParticipant } = useVoice();

    // Stable fallback when no explicit/context participant is supplied — memo
    // keeps the same object reference across re-renders so PatientAvatar
    // doesn't re-resolve / re-mount the GLB on each parent render.
    const caseFallback = useMemo(() => {
        const c = caseData?.config || {};
        return {
            avatar_id: c.avatar_id || null,
            avatar_camera: c.avatar_camera || null,
            gender: caseData?.patient_gender || c.demographics?.gender,
            name: caseData?.patient_name || c.patient_name,
            age: caseData?.patient_age || c.demographics?.age,
            id: caseData?.id
        };
    }, [caseData?.id, caseData?.config, caseData?.patient_name, caseData?.patient_age, caseData?.patient_gender]);

    const p = participant || activeParticipant || caseFallback;

    // Always render the avatar when the manifest is loaded — every case now
    // resolves to a GLB (explicit, platform-default, or demographic auto-pick).
    // The `avatar_type === 'none'` global toggle still wins as a kill switch.
    const showLiveHead = !!headManifest && voiceSettings?.avatar_type !== 'none';

    // "Looking at the patient": publish this stage's face region as a live
    // gaze AOI. useAoiPublisher owns the whole lifecycle (rAF-throttled on
    // resize/scroll/stage-resize, null on unmount, so "patient not on screen"
    // stays distinct from "not looking at the patient"); Oyon's gaze
    // aggregator turns it into per-window dwell (aoi_dwell_ms.patient_face)
    // and the capture widget forwards updates to the running <oyon-app>.
    // FACE_BOX picks the face out of the square stage — the one AOI that
    // targets an inset instead of its full rect.
    const stageRef = useRef(null);
    useAoiPublisher(stageRef, PATIENT_AOI_ID, { insetBox: FACE_BOX, enabled: showLiveHead });

    return (
        <div className="h-full flex flex-col bg-neutral-900 overflow-hidden relative">
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4">
                {showLiveHead ? (
                    /* The measured AOI stage wraps the Suspense boundary: it
                       must exist from the FIRST render (the effect above runs
                       once per showLiveHead flip), not only after the lazy 3D
                       head resolves. */
                    <div ref={stageRef} className="aspect-square h-full max-h-full max-w-full">
                        <Suspense fallback={
                            <div className="w-full h-full rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                                <Loader2 className="w-6 h-6 animate-spin text-neutral-500" />
                            </div>
                        }>
                            <PatientAvatar
                                patient={p}
                                speaking={speaking}
                                listening={listening}
                                visemes={visemes}
                                headManifest={headManifest}
                                avatarId={p.avatar_id}
                                cameraOverride={p.avatar_camera}
                                platformAvatars={platformAvatars}
                            />
                        </Suspense>
                    </div>
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-700">
                        <User className="w-24 h-24" />
                    </div>
                )}
            </div>

            {/* Speaker caption — the patient's (or active agent's) name lives
                here, on the face it belongs to, since the monitor header now
                leads with the Rohy wordmark instead. Bottom-center overlay so
                it reads as a caption under the avatar without reserving
                layout height. */}
            {p?.name && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 max-w-[85%] px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 text-center pointer-events-none select-none">
                    <div className="text-base font-bold text-white leading-tight truncate">{p.name}</div>
                    {(p.age || p.gender) && (
                        <div className="text-[11px] text-neutral-300 leading-tight truncate">
                            {p.age ? `${p.age}y` : ''}{p.age && p.gender ? ' ' : ''}{p.gender || ''}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
