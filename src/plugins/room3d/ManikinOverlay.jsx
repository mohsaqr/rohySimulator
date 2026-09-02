import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import ManikinPanel from '../../components/examination/ManikinPanel';
import EventLogger from '../../services/eventLogger';

// The 3D room's manikin surface: Rohy's REAL ManikinPanel (the 2D
// examination room's workspace — stylized body figure with its clickable
// regions, front/back and gender toggles, technique selector, findings and
// exam log) shown full size over the room.
//
// It exists because a supine 3D patient hides posterior regions, and
// because a cramped body map is worse than no body map: the previous
// version squeezed the figure into a 380px panel at max-h-72, which is
// what made it unreadable.
//
// Logging parity with the 2D room is by construction: ManikinPanel records
// to PatientRecord itself, and this wrapper adds the same
// EventLogger.physicalExamPerformed call that App makes for
// PhysicalExamScreen — the only difference being the room3d marker.
export default function ManikinOverlay({ activeCase, onExamPerformed, onClose }) {
    const { t: tRoom } = useTranslation('room3d');
    useEffect(() => {
        const handleKey = (event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            onClose();
        };
        document.addEventListener('keydown', handleKey, true);
        return () => document.removeEventListener('keydown', handleKey, true);
    }, [onClose]);

    const gender = (activeCase?.config?.demographics?.gender ?? activeCase?.patient_gender ?? 'male')
        .toString()
        .toLowerCase();

    const handleExam = (entry) => {
        EventLogger.physicalExamPerformed(entry.regionId, entry.examType, entry.finding, {
            gender: activeCase?.config?.demographics?.gender,
            abnormal: entry.abnormal,
            room3d: true,
        });
        onExamPerformed?.(entry);
    };

    return (
        <>
            <div className="fixed inset-x-0 top-0 bottom-[72px] z-30 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
            {/* Stops 88px above the viewport bottom: the host's fixed
                RoomNavigator owns the last 72px and always paints above
                this surface. */}
            <div className="fixed left-4 right-4 top-4 bottom-[88px] z-40 md:left-10 md:right-10 md:top-8">
                <ManikinPanel
                    embedded
                    physicalExam={activeCase?.config?.physical_exam ?? null}
                    patientGender={gender === 'female' ? 'female' : 'male'}
                    onExamPerformed={handleExam}
                />
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={tRoom('manikin_close')}
                    className="absolute right-3 top-3 rounded-lg p-2 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
                >
                    <X className="h-5 w-5" />
                </button>
            </div>
        </>
    );
}
