import { RHYTHM_LABEL_KEYS } from '../../services/rhythms';
// Pure mapping between Rohy's live data shapes and the 3D patient room's
// mount contract (the `rohy-3d-patient-room` package). Kept free of React
// and of the package import so it is trivially unit-testable.

const PRONOUNS = Object.freeze({ male: 'he/him', female: 'she/her' });

/**
 * Build the 3D room's patient record from the active Rohy case.
 * Mirrors the normalisation App.jsx already performs for patientInfo,
 * plus the demographic fields the room's patient panel shows.
 */
export function casePatient(activeCase, tRoom = (key) => key) {
    const config = activeCase?.config ?? {};
    const demographics = config.demographics ?? {};
    const history = config.structuredHistory ?? {};
    const name = config.patient_name || activeCase?.patient_name || activeCase?.name || tRoom('unknown_patient');
    const age = demographics.age ?? activeCase?.patient_age ?? null;
    const gender = String(demographics.gender ?? activeCase?.patient_gender ?? '').toLowerCase();
    const chief_complaint = history.chiefComplaint || activeCase?.chief_complaint || tRoom('acute_presentation');
    const initials = name
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || 'PT';
    const greeting = typeof config.greeting === 'string'
        ? config.greeting.replace(/\*[^*]*\*/g, '').trim()
        : '';

    return {
        name,
        initials,
        age: age ?? '—',
        pronouns: PRONOUNS[gender] ?? 'they/them',
        speaker: (name.split(/\s+/)[0] || tRoom('speaker_patient')).toUpperCase(),
        presenting_concern: chief_complaint,
        background: history.pmh || activeCase?.description || tRoom('see_record'),
        // An absent record must read as absent — "No known drug allergy" is a
        // clinical claim the case data has not actually made.
        allergies: demographics.allergies || history.allergies || tRoom('not_recorded'),
        location: tRoom('location'),
        bed_label: tRoom('bed_label').toUpperCase(),
        case_title: activeCase?.name || chief_complaint,
        arrival_note: `${name} presents with ${chief_complaint.charAt(0).toLowerCase()}${chief_complaint.slice(1)}`,
        opening_line: greeting || tRoom('opening_line'),
    };
}

/**
 * Map EventLogger.currentVitals (snake_case mirror of PatientMonitor's
 * displayVitals) to the room engine's vitals shape. Returns null when the
 * feed is absent or non-numeric (arrest states report "?" for several
 * vitals) so the caller can keep the last rendered values instead.
 */
export function mapVitals(current_vitals) {
    if (!current_vitals || typeof current_vitals !== 'object') return null;
    // Number(null) and Number('') are 0, which would render an absent vital
    // as a real zero — treat them as missing instead.
    const reading = (value) => (value === null || value === undefined || value === '' ? NaN : Number(value));
    const mapped = {
        heart_rate: reading(current_vitals.hr),
        oxygen_saturation: reading(current_vitals.spo2),
        respiratory_rate: reading(current_vitals.rr),
        systolic: reading(current_vitals.bp_sys),
        diastolic: reading(current_vitals.bp_dia),
    };
    if (!Object.values(mapped).every(Number.isFinite)) return null;
    const temperature = reading(current_vitals.temp);
    return { ...mapped, temperature: Number.isFinite(temperature) ? temperature : 37.0 };
}

/**
 * Human-readable rhythm label for the room's monitor, from the monitor's
 * rhythm ids, translated through the monitor's own vocabulary
 * (`RHYTHM_LABEL_KEYS`, namespace `monitor`) so the two monitors on screen
 * never disagree. NSR returns null on purpose: the room then derives
 * "Sinus rhythm" / "Sinus tachycardia" from the heart rate itself.
 * @param {string} rhythm Monitor rhythm id.
 * @param {(key: string) => string} tMonitor Translator bound to the `monitor` namespace.
 */
export function rhythmLabel(rhythm, tMonitor = (key) => key) {
    if (!rhythm || rhythm === 'NSR') return null;
    const key = RHYTHM_LABEL_KEYS[rhythm];
    return key ? tMonitor(key) : null;
}

// (no avatarUrl here any more) — which body lies on the bed is resolved by
// usePatientAvatar through Rohy's own four-tier resolver, the same one the
// first screen's portrait uses. The one-line version that lived here
// answered 'avatarsdk.glb' for every case that set no avatar_id, which is
// every seeded case, so a female patient was a male body on the bed.
