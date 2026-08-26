/**
 * Pathology plugin manifest — RPS-1.
 *
 * Pure JS on purpose: no React, no JSX. That lets Node import it directly, so
 * `npm run plugins:gen` can freeze it into server/shared/plugins/ for the
 * server to read without importing anything from src/.
 *
 * NOTHING in src/components/pathology/ is edited by this file. That folder is
 * a byte-identical vendored copy of the upstream rohy-pathology package, and
 * keeping it that way is the point: a plugin ships its own vocabulary, and the
 * host adapts to it from outside. If integrating a plugin requires editing the
 * plugin, it is not plug-and-play.
 */
import {
    PATHOLOGY_OBJECT_TYPES, PATHOLOGY_COMPONENTS,
    PATHOLOGY_VERB_METADATA, PATHOLOGY_ROOM,
} from '../../components/pathology/pathologyEvents.js';
import {
    PATHOLOGY_VERB_FALLBACKS, PATHOLOGY_OBJECT_OVERRIDES, PATHOLOGY_INTERPRETATIONS,
} from '../../components/pathology/pathologyStates.js';

export const manifest = {
    id: PATHOLOGY_ROOM,
    version: '1.0.0',
    room: {
        key: PATHOLOGY_ROOM,
        labelKey: 'room_pathology',
        subKey: 'room_pathology_sub',
        // Resolved client-side against static allowlists — a manifest cannot
        // hold a React component, and Tailwind cannot JIT a computed class.
        icon: 'Microscope',
        accent: 'fuchsia',
        order: 50,
    },
    vocabulary: {
        // PATHOLOGY_VERB_METADATA is already keyed by verb with
        // {severity, category}; the standard uses that shape verbatim so a
        // plugin never restates its own vocabulary in two formats.
        verbs: PATHOLOGY_VERB_METADATA,
        objectTypes: PATHOLOGY_OBJECT_TYPES,
        components: PATHOLOGY_COMPONENTS,
    },
    states: {
        verbFallbacks: PATHOLOGY_VERB_FALLBACKS,
        objectOverrides: PATHOLOGY_OBJECT_OVERRIDES,
        interpretations: PATHOLOGY_INTERPRETATIONS,
    },
    // 'llm' was dropped. It was requested to settle a free-text diagnosis a
    // deterministic grader could not decide, and upstream has since removed
    // the diagnosis box entirely — the reader writes a report instead, and
    // matching prose against requireTerms/rejectTerms would misfire on any
    // legitimate differential ("no evidence of malignancy" contains
    // "malignancy"). A capability nothing consumes is dead weight in a
    // manifest whose whole job is to make intent reviewable. grading.js is
    // intact and tested if tutor-side marking wants it later.
    capabilities: ['persist'],
    minRole: 'student',

    // The authoring slot. `CaseAuthor` is a second top-level surface in the
    // upstream package — a case editor, not a room — and before RPS-1 grew
    // this slot it had nowhere to mount.
    //
    // 'educator' is stated rather than inherited. Authored slides become the
    // material every learner is then assessed against, and the room's
    // 'student' would be the single most consequential default to get wrong.
    authoring: {
        labelKey: 'room_pathology_author',
        minRole: 'educator',
    },
};

export default manifest;
