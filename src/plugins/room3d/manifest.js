/**
 * The 3D patient room, as an RPS-1 plugin manifest.
 *
 * Server-importable DATA only (frozen into server/shared/plugins/ by
 * `npm run plugins:gen`): no React, no components. The adapter that mounts
 * the room lives in index.jsx beside this file.
 */

// The id doubles as the room key, the URL segment and the case-config key.
export const ROOM3D_ID = 'room3d';

// Components this room stamps on its rows. Declaring them is what makes
// `Room3D` a known component rather than a string literal the analytics
// vocabulary has never heard of. All prefixed `Room3D` (R34).
export const ROOM3D_COMPONENTS = Object.freeze({
    ROOM3D: 'Room3D',
    EXAM_WHEEL: 'Room3DExamWheel',
    MANIKIN: 'Room3DManikin',
});

// The room's OWN acts. Until 1.6 it declared none and funnelled every
// interaction through a generic CLICKED on the host singleton, so opening
// the exam wheel, the body map or a bedside prop was indistinguishable from
// any other click in the analytics — and the physical exams it performed
// carried `component='room3d'` where the manifest said 'Room3D'.
export const ROOM3D_VERBS = Object.freeze({
    OPENED_EXAM_WHEEL: 'OPENED_EXAM_WHEEL',
    OPENED_BODY_MAP: 'OPENED_BODY_MAP',
    CLOSED_BODY_MAP: 'CLOSED_BODY_MAP',
    SELECTED_BEDSIDE_PROP: 'SELECTED_BEDSIDE_PROP',
    OBSERVED_PATIENT_STATUS: 'OBSERVED_PATIENT_STATUS',
    VOICED_PATIENT_LINE: 'VOICED_PATIENT_LINE',
});

export const ROOM3D_OBJECT_TYPES = Object.freeze({
    EXAM_WHEEL: 'room3d_exam_wheel',
    BODY_MAP: 'room3d_body_map',
    PROP: 'room3d_prop',
    STATUS: 'room3d_status',
    PATIENT_LINE: 'room3d_patient_line',
});

export const manifest = {
    id: ROOM3D_ID,
    version: '1.0.0',
    room: {
        key: ROOM3D_ID,
        labelKey: 'room_room3d',
        subKey: 'room_room3d_sub',
        icon: 'Bed',
        accent: 'teal',
        // Second room: right after Patient (10) and before Examination (20).
        order: 15,
        // The room is drawn OVER the chat layout, which the host keeps mounted
        // and inert beneath it: the physiology engine (PatientMonitor) and the
        // patient conversation (ChatInterface) live there, and this room is a
        // second view of the same patient, not a second patient.
        presentation: 'overlay',
    },
    vocabulary: {
        // v2 (RPS-1 1.6, R33): the full facet row per verb, so the analytics
        // lenses label Bedside rows the same way they label the 2D room's.
        version: 2,
        verbs: {
            OPENED_EXAM_WHEEL: { severity: 'INFO', category: 'CLINICAL', clinicalState: 'examining', action: 'Examining', label: 'Opened exam wheel' },
            OPENED_BODY_MAP: { severity: 'INFO', category: 'CLINICAL', clinicalState: 'examining', action: 'Examining', label: 'Opened body map' },
            CLOSED_BODY_MAP: { severity: 'DEBUG', category: 'CLINICAL', clinicalState: 'examining', action: 'Examining', label: 'Closed body map' },
            SELECTED_BEDSIDE_PROP: { severity: 'INFO', category: 'NAVIGATION', clinicalState: 'navigating', action: 'Navigating', label: 'Selected bedside prop' },
            OBSERVED_PATIENT_STATUS: { severity: 'INFO', category: 'MONITORING', clinicalState: 'monitoring', action: 'Monitoring', label: 'Observed patient status' },
            VOICED_PATIENT_LINE: { severity: 'INFO', category: 'COMMUNICATION', clinicalState: 'communicating', action: 'Communicating', label: 'Voiced patient line' },
        },
        // Core verbs the room emits on its own behalf: a physical exam from
        // the wheel or the body map is the SAME act as in the 2D room.
        coreVerbs: ['PERFORMED_PHYSICAL_EXAM'],
        objectTypes: ROOM3D_OBJECT_TYPES,
        components: ROOM3D_COMPONENTS,
        componentPrefix: 'Room3D',
    },
    states: {
        verbFallbacks: {
            OPENED_EXAM_WHEEL: 'examining',
            OPENED_BODY_MAP: 'examining',
            CLOSED_BODY_MAP: 'examining',
            SELECTED_BEDSIDE_PROP: 'navigating',
            OBSERVED_PATIENT_STATUS: 'monitoring',
            VOICED_PATIENT_LINE: 'communicating',
        },
        objectOverrides: {
            room3d_exam_wheel: 'examining',
            room3d_body_map: 'examining',
            room3d_status: 'monitoring',
            room3d_patient_line: 'communicating',
        },
        interpretations: {},
    },
    // `case`: the frozen case snapshot (the room IS the patient's bed, so it
    // needs the patient, not a slice). `conversation`: the session's one
    // patient conversation, to speak into and listen to. `drawer`: open the
    // orders drawer on a tab (chart → records, IV / oxygen → treatments).
    // `vitals`: the live physiology snapshot the monitor mirror draws from.
    capabilities: ['case', 'conversation', 'drawer', 'vitals'],
    minRole: 'student',
};

export default manifest;
