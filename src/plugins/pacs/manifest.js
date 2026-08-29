/**
 * PACS plugin manifest — RPS-1.
 *
 * Pure JS on purpose: no React, no JSX, so Node can import it directly and
 * `npm run plugins:gen` can freeze it into server/shared/plugins/ for the
 * server to read without importing anything from src/.
 *
 * NOTHING in src/components/pacs/ is edited by this file. That folder is a
 * byte-identical vendored copy of the upstream Radoyon package
 * (~/Documents/Github/Radoyon/radoyon/src), and keeping it that way is the
 * point: a plugin ships its own vocabulary and the host adapts to it from
 * outside. Edit upstream, run its tests, re-vendor.
 *
 * ---------------------------------------------------------------------------
 * Why 'pacs' and not 'radiology'
 *
 * `radiology` is a CORE rohy room (R3) and the registry rejects a plugin that
 * claims it — it would render a duplicate navigator tab and could never mount.
 * That constraint turns out to describe the real division of labour rather
 * than working around it: in a hospital the RIS is where a study is ORDERED
 * and its report is read, and the PACS is where the IMAGES are read. rohy's
 * Radiology room keeps ordering, turnaround and the text report exactly as
 * they are; this room is the workstation the images open on. A learner
 * therefore crosses the same boundary a clinician does.
 */
import {
    RADOYON_COMPONENTS, RADOYON_OBJECT_TYPES, RADOYON_ROOM, RADOYON_VERB_METADATA,
} from '../../components/pacs/radoyonEvents.js';
import {
    RADOYON_INTERPRETATIONS, RADOYON_OBJECT_OVERRIDES, RADOYON_VERB_FALLBACKS,
} from '../../components/pacs/radoyonStates.js';

export const manifest = {
    id: RADOYON_ROOM,
    version: '0.1.0',
    room: {
        key: RADOYON_ROOM,
        labelKey: 'room_pacs',
        subKey: 'room_pacs_sub',
        // Resolved client-side against static allowlists — a manifest cannot
        // hold a React component, and Tailwind cannot JIT a computed class.
        icon: 'Scan',
        accent: 'indigo',
        // Immediately after Radiology (50 is pathology), so the images sit
        // beside the room the study was ordered from.
        order: 55,
    },
    vocabulary: {
        // Already keyed by verb with {severity, category}; the standard uses
        // that shape verbatim so a plugin never restates its own vocabulary in
        // two formats.
        verbs: RADOYON_VERB_METADATA,
        objectTypes: RADOYON_OBJECT_TYPES,
        components: RADOYON_COMPONENTS,
    },
    states: {
        verbFallbacks: RADOYON_VERB_FALLBACKS,
        objectOverrides: RADOYON_OBJECT_OVERRIDES,
        interpretations: RADOYON_INTERPRETATIONS,
    },

    // 'persist' holds the learner's measurements and report draft.
    // 'llm' is deliberately absent: a radiology report is free prose, and
    // matching it against required terms would misfire on every legitimate
    // negative ("no evidence of pulmonary embolism" contains "pulmonary
    // embolism"). Tutor-side marking reads the rubric instead.
    capabilities: ['persist', 'remote'],
    minRole: 'student',

    // Remote content. This is the reason the plugin can exist at all: one
    // routine chest CT is ~150 MB of DICOM, and a teaching archive of normals
    // across 74 study types is tens of gigabytes. None of that belongs in
    // rohy's Docker image, its backups, or its air-gap bundle. A case addresses
    // a series as `remote:dicom/normal/ct_chest_adult_m/s2/` and rohy relays it
    // from whichever origin the OPERATOR configured in ROHY_PLUGIN_ORIGINS — so
    // the same case runs against a university's archive and a local one
    // unchanged, and the case never names a host.
    remote: {
        // '/dicom' is the study data: per-series index.json manifests and the
        // instances they list. '/thumbs' is the worklist preview imagery.
        // Two literal prefixes rather than one open mount, so a mistyped path
        // is a 403 here instead of a request rohy makes on the author's behalf.
        paths: ['/dicom', '/thumbs'],
        contentTypes: [
            // The instances themselves. Archives disagree about which of these
            // they send for a .dcm, so both spellings are allowed.
            'application/dicom', 'application/octet-stream',
            // The per-series index.json that says which instances a series has.
            'application/json',
            // Worklist thumbnails only — never the diagnostic pixels, which are
            // always read from DICOM so the modality LUT is applied.
            'image/jpeg', 'image/png',
        ],
    },

    // The authoring slot. 'educator' is stated rather than inherited: an author
    // chooses which pathology a learner is assessed on finding, and the room's
    // 'student' would be the single most consequential default to get wrong.
    authoring: {
        labelKey: 'room_pacs_author',
        minRole: 'educator',
    },

    // The document contract (§11a). `rubric` is the answer key — the expected
    // findings, the key images, the dwell thresholds. The package's own
    // `learnerDocument()` projection omits it in the room, but a projection in
    // the browser only decides what is SHOWN; declaring it here makes the
    // server strip the path from every read a role below reviewer makes, so it
    // never reaches the learner's devtools in the first place.
    document: {
        learnerOmit: ['rubric'],
    },
};

export default manifest;
