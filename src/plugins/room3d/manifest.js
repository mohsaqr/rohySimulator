/**
 * The 3D patient room, as an RPS-1 plugin manifest.
 *
 * Server-importable DATA only (frozen into server/shared/plugins/ by
 * `npm run plugins:gen`): no React, no components. The adapter that mounts
 * the room lives in index.jsx beside this file.
 */

// The id doubles as the room key, the URL segment and the case-config key.
export const ROOM3D_ID = 'room3d';

// Components this room stamps on the core verbs it emits (messageSent,
// messageReceived, physicalExamPerformed, buttonClicked). Declaring them here
// is what makes `Room3D` a known component rather than a string literal the
// analytics vocabulary has never heard of.
export const ROOM3D_COMPONENTS = Object.freeze({
    ROOM3D: 'Room3D',
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
    // The room emits only core verbs; it adds no verbs, object types or
    // clinical-state mappings of its own.
    vocabulary: {
        verbs: {},
        objectTypes: {},
        components: ROOM3D_COMPONENTS,
    },
    states: {
        verbFallbacks: {},
        objectOverrides: {},
        interpretations: {},
    },
    // `case`: the frozen case snapshot (the room IS the patient's bed, so it
    // needs the patient, not a slice). `conversation`: the session's one
    // patient conversation, to speak into and listen to. `drawer`: open the
    // orders drawer on a tab (chart → records, IV / oxygen → treatments).
    capabilities: ['case', 'conversation', 'drawer'],
    minRole: 'student',
};

export default manifest;
