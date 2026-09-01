import { useCallback } from 'react';
import { getDefaultFinding } from '../data/examRegions';
import { usePatientRecord } from '../services/PatientRecord';

/**
 * Perform one physical examination — the single implementation.
 *
 * Extracted verbatim from ManikinPanel.handleExamTypeSelect so the 2D
 * examination room and the 3D room run the SAME code rather than two copies
 * that drift. (They already had: the 3D room's copy was writing the
 * "<test>: <finding>" string into the patient record where ManikinPanel
 * writes the raw finding.)
 *
 * What it owns: resolving the finding (case config first, model default
 * second), recording it to the PatientRecord, and returning the log entry.
 *
 * What it deliberately does NOT own: EventLogger. Analytics stays with the
 * screen, exactly as before — App logs for PhysicalExamScreen and the 3D
 * room logs with its own `room3d` marker, so the two rooms stay tellable
 * apart in the data.
 *
 * @param {{physicalExam: object|null}} options Case exam config
 *   (`case.config.physical_exam`); null falls back to model defaults.
 * @return {(regionId: string, examType: string, specialTestName?: string|null) => {
 *   regionId: string, examType: string, specialTest: string|null,
 *   finding: string, rawFinding: string, abnormal: boolean,
 *   audioUrl: string|null, audioUrls: object, heartAudio: string|null,
 *   lungAudio: string|null, timestamp: string
 * }} performExam — returns the log entry it just recorded.
 */
export default function usePhysicalExam({ physicalExam = null } = {}) {
    const { examined, elicited } = usePatientRecord();

    return useCallback((regionId, examType, specialTestName = null) => {
        const examData = physicalExam ?? {};
        const configured = examData[regionId] && examData[regionId][examType];

        let finding = '';
        let abnormal = false;
        let audioUrl = null;
        let audioUrls = {};
        let heartAudio = null;
        let lungAudio = null;

        if (configured) {
            finding = configured.finding;
            abnormal = configured.abnormal || false;
            audioUrl = configured.audioUrl || null;
            audioUrls = configured.audioUrls || {};
            heartAudio = configured.heartAudio || null;
            lungAudio = configured.lungAudio || null;
        } else {
            finding = getDefaultFinding(regionId, examType);
            abnormal = false;
        }

        // specialTestName records WHICH special test the learner ran; the
        // finding itself is the region's combined `special` result, since
        // that is all the data model carries.
        const entry = {
            regionId,
            examType,
            specialTest: specialTestName || null,
            finding: specialTestName ? `${specialTestName}: ${finding}` : finding,
            rawFinding: finding,
            abnormal,
            audioUrl,
            audioUrls,
            heartAudio,
            lungAudio,
            timestamp: new Date().toISOString()
        };

        // The record keeps the raw finding: the named test belongs to the
        // exam log, not to the clinical text of what was elicited.
        examined(regionId, examType, finding);
        if (finding) {
            elicited('exam', finding, abnormal, {
                category: regionId,
                significance: abnormal ? 'Abnormal finding' : 'Normal finding'
            });
        }

        return entry;
    }, [physicalExam, examined, elicited]);
}
