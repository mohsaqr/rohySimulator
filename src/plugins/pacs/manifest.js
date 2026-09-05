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
    RADOYON_COMPONENTS, RADOYON_COMPONENT_PREFIX, RADOYON_OBJECT_TYPES, RADOYON_ROOM,
    RADOYON_VERB_METADATA, RADOYON_VOCABULARY_VERSION,
} from '../../components/pacs/radoyonEvents.js';
import {
    RADOYON_INTERPRETATIONS, RADOYON_OBJECT_OVERRIDES, RADOYON_VERB_FALLBACKS,
} from '../../components/pacs/radoyonStates.js';

export const manifest = {
    id: RADOYON_ROOM,
    // The ADAPTER's version (stamped on every row as plugin_version); the
    // package's own is in src/components/pacs/.vendor.json.
    version: '0.2.0',
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
        // v2 (RPS-1 1.6): the package's rows carry the full facet set —
        // severity, category, clinicalState, action, label — so every
        // analytics lens labels PACS rows without a host-side guess (R33).
        // The standard uses the package's shape verbatim so a plugin never
        // restates its own vocabulary in two formats.
        version: RADOYON_VOCABULARY_VERSION,
        verbs: RADOYON_VERB_METADATA,
        objectTypes: RADOYON_OBJECT_TYPES,
        components: RADOYON_COMPONENTS,
        componentPrefix: RADOYON_COMPONENT_PREFIX,
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
    //
    // 'orders' is what makes ordering a CT produce images rather than only a
    // report. The learner orders in the Radiology room; this room is where the
    // study opens, and without the host granting the session's imaging orders
    // the two halves of one act never meet — the worklist could only ever show
    // what an educator had authored by hand. The grant is narrowed by the host
    // (src/plugins/hostOrders.js): identity, study name and turnaround state,
    // never the report text or the configured findings that ride on the order
    // row, because what the imaging SHOWS is the case document's to say.
    capabilities: ['persist', 'remote', 'orders'],
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

    // The library the EDITOR offers (RPS-1 §7a.1), relayed by the host from
    // `<origin>/catalog.json` through GET /api/plugins/pacs/catalog.
    //
    // The route was written for pathology and knew pathology's shape by heart:
    // a `{assets: […]}` collection whose references live in `url` fields. That
    // is one plugin's vocabulary standing in for the standard's, and Radoyon is
    // the plugin that proves it — an imaging archive is `{entries: […]}` whose
    // references live in `ref` fields, and the route rejected it as malformed.
    // So the shape now travels in the manifest, where a plugin's vocabulary
    // belongs, and the host relays whatever a plugin declares.
    catalog: {
        // Radoyon's archive.js reads `{version, name, entries: [...]}`.
        collection: 'entries',
        // Every one of these must be a `remote:` reference or the relay refuses
        // the catalog: an origin that hands out absolute URLs would put a host
        // address into cases that are meant to be portable, and would route
        // around ROHY_PLUGIN_ORIGINS entirely.
        refFields: ['ref'],
        // What a LEARNER may be told about the archive.
        //
        // The full catalogue is an author's document — it names the pathology
        // library ("Saddle embolus", "RUL nodule"), and a learner who could
        // read it would be handed the diagnosis of every case built from it.
        // But a learner's room does need SOMETHING: a case entry says
        // `baseline: {kind: 'archive', ref: 'normal/ct_chest'}` and only the
        // host can turn that id into the series a viewer opens.
        //
        // So the host serves roles below `authoring.minRole` a projection
        // restricted to these keys — identity and series, nothing a case could
        // be spoiled by. It is an allowlist, not a denylist, because a field
        // added upstream must default to NOT being shown to the person being
        // assessed.
        learnerKeys: ['id', 'studyId', 'series'],
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
