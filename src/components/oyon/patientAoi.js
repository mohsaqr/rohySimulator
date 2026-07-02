// Back-compat shim — Stage A (multi-AOI gaze) generalized the single
// patient-face AOI store into the multi-AOI registry in screenAois.js.
// New code imports screenAois.js (elementAoi / reportAoi / getAois / onAois),
// useAoiPublisher.js or AoiRegion.jsx directly; this file keeps the original
// patient-only surface working for anything still holding the old names.

export { patientFaceAoi, FACE_BOX, MIN_AOI_SIZE, PATIENT_AOI_ID } from './screenAois.js';

import { PATIENT_AOI_ID, reportAoi, getAoi, onAois } from './screenAois.js';

/** Publish the current patient AOI (null = no visible patient). Dedupes no-ops. */
export function reportPatientAoi(aoi) {
    reportAoi(PATIENT_AOI_ID, aoi);
}

export function getPatientAoi() {
    return getAoi(PATIENT_AOI_ID);
}

/** Subscribe to PATIENT AOI changes only (other AOIs' updates are filtered
 *  out); returns an unsubscribe function. */
export function onPatientAoi(cb) {
    let last = getPatientAoi();
    return onAois(() => {
        const current = getPatientAoi();
        if (JSON.stringify(current) === JSON.stringify(last)) return;
        last = current;
        cb(current);
    });
}
