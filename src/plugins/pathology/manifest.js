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
    capabilities: ['persist', 'remote'],
    minRole: 'student',

    // Remote content. Whole-slide images are the reason this exists: a single
    // scanned slide is gigabytes of pyramid tiles, which has no business inside
    // rohy's Docker image, its backups, or its air-gap bundle. With this block
    // a case addresses a slide as `remote:tiles/case42/slide1.dzi` and rohy
    // relays it from whichever host the OPERATOR configured in
    // ROHY_PLUGIN_ORIGINS — the case never names a host, so the same case runs
    // against a university's slide server and against a local one unchanged.
    //
    // Nothing here is required: a case whose `dzi` is a plain '/slides/…' path
    // is served by rohy as before. Remote is an option, not a migration.
    remote: {
        // '/tiles' is the DZI pyramid (descriptor + tile images); '/gross' is
        // the specimen photography SpecimenTray renders. Two prefixes rather
        // than one open mount, so a mis-typed path is a 403 here instead of a
        // request rohy makes on the author's behalf.
        // '/library' (1.4) is the MANAGED half: slides imported from a link and
        // tiled by the server, living beside the bundled ones on the same
        // origin and served by the same nginx block. A bundle deploy never
        // touches it (the rsync excludes it) and the bundle script refuses to
        // contain it — the two halves share an origin and nothing else.
        paths: ['/tiles', '/gross', '/library'],
        // A .dzi descriptor is XML and tile servers disagree about which XML
        // content type to send; the images are whatever the pyramid was encoded
        // as. text/html is conspicuously absent — see plugins-routes.js.
        contentTypes: [
            'application/xml', 'text/xml',
            'image/jpeg', 'image/png', 'image/webp',
        ],
    },

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

    // The settings slot (RPS-1 1.4). Everything an operator decides about slide
    // IMPORT lives here rather than in code, because the answers differ per
    // institution: which hosts a university will fetch from, how much disk a
    // deployment will spend per slide, and what magnification its teaching
    // actually uses are three different questions with three different owners.
    //
    // Every default is chosen to make a fresh install do NOTHING surprising:
    // imports are off, the origin allowlist is empty, and turning it on is two
    // deliberate acts (enable, then name a host). An empty allowlist is not a
    // misconfiguration to warn about — it is the correct state of a server
    // nobody has told where slides may come from.
    settings: {
        groups: [
            { key: 'imports', labelKey: 'pathology_settings_imports' },
            { key: 'tiling', labelKey: 'pathology_settings_tiling' },
            { key: 'jobs', labelKey: 'pathology_settings_jobs' },
        ],
        fields: {
            'imports.enabled': {
                type: 'boolean', default: false, group: 'imports',
                labelKey: 'pathology_settings_imports_enabled',
            },
            // Empty by default and empty is meaningful: no origin, no import.
            // The same rule as ROHY_PLUGIN_ORIGINS — a case author picks a
            // path, an operator picks a host — one level down, because a
            // *download* from an arbitrary URL is the same SSRF shape as a
            // proxy to one.
            'imports.allowedOrigins': {
                type: 'origins', default: [], group: 'imports',
                // Bounded by the OPERATOR's list. A tenant admin narrows it and
                // can never widen it: naming a host for rohy's server to fetch
                // 4 GB from is a deployment-level decision, not a tenant one.
                allowlistEnv: 'ROHY_PLUGIN_IMPORT_ORIGINS',
                labelKey: 'pathology_settings_imports_origins',
            },
            'imports.maxBytes': {
                type: 'bytes', default: 4 * 1024 * 1024 * 1024,
                min: 64 * 1024 * 1024, max: 16 * 1024 * 1024 * 1024,
                // A tenant admin may lower this; only an operator raises the
                // deployment's own roof.
                ceilingEnv: 'ROHY_PLUGIN_IMPORT_MAX_BYTES',
                group: 'imports', labelKey: 'pathology_settings_imports_max_bytes',
            },
            // The ALLOW set, not the detector: `vips openslideload` decides what
            // a file actually is (Cytomine's rule — detect by content, never by
            // extension), and this says which of those answers this deployment
            // will accept.
            'imports.acceptedFormats': {
                type: 'enumList',
                options: ['svs', 'ndpi', 'tiff', 'tif', 'dzi', 'zip', 'scn', 'bif', 'czi', 'svslide'],
                default: ['svs', 'ndpi', 'tiff', 'tif', 'dzi', 'zip'],
                group: 'imports', labelKey: 'pathology_settings_imports_formats',
            },
            // On by default. A slide whose optics are unknown is not a slide
            // with default optics: every measurement the reader makes would be
            // wrong by an unknown factor, and 40x/0.25 is the most plausible
            // guess and therefore the most dangerous one.
            'imports.requireCalibration': {
                type: 'boolean', default: true, group: 'imports',
                labelKey: 'pathology_settings_imports_require_calibration',
            },
            'imports.keepOriginal': {
                type: 'boolean', default: true, group: 'imports',
                labelKey: 'pathology_settings_imports_keep_original',
            },

            // 10x matches what the bundled slides already are, so an imported
            // slide and a shipped one read identically. 'native' is offered and
            // is not the default: it is 5-10x the disk for magnification most
            // teaching never uses.
            'tiling.targetObjective': {
                type: 'enum', options: ['5', '10', '20', '40', 'native'], default: '10',
                group: 'tiling', labelKey: 'pathology_settings_tiling_objective',
            },
            'tiling.tileSize': {
                type: 'enum', options: [256, 512, 1024], default: 512,
                group: 'tiling', labelKey: 'pathology_settings_tiling_tile_size',
            },
            'tiling.overlap': {
                type: 'int', min: 0, max: 2, default: 1,
                group: 'tiling', labelKey: 'pathology_settings_tiling_overlap',
            },
            'tiling.jpegQuality': {
                type: 'int', min: 60, max: 95, default: 85,
                group: 'tiling', labelKey: 'pathology_settings_tiling_quality',
            },
            // These are libvips' OWN enum members, not a curated subset and not
            // a paraphrase. The design note called the default 'average' and
            // libvips calls it 'mean'; passing 'average' makes `dzsave` exit 1
            // with "enum 'VipsRegionShrink' has no member 'average'". A settings
            // field that feeds a tool's flag mirrors that tool's spelling, or it
            // is a validated value that fails at the one place validation was
            // supposed to protect.
            //
            // 'mean' for histology: 'median' is for masks and label layers and
            // quietly erases single-cell detail at low zoom on H&E.
            'tiling.regionShrink': {
                type: 'enum',
                options: ['mean', 'median', 'mode', 'max', 'min', 'nearest'],
                default: 'mean',
                group: 'tiling', labelKey: 'pathology_settings_tiling_shrink',
            },
            'tiling.previewLongestEdge': {
                type: 'int', min: 256, max: 2048, default: 1024,
                group: 'tiling', labelKey: 'pathology_settings_tiling_preview',
            },
            'tiling.timeoutMinutes': {
                type: 'int', min: 10, max: 720, default: 120,
                group: 'tiling', labelKey: 'pathology_settings_tiling_timeout',
            },

            'jobs.retentionDays': {
                type: 'int', min: 1, max: 365, default: 30,
                group: 'jobs', labelKey: 'pathology_settings_jobs_retention',
            },
        },
    },

    // The document contract (§11a). `rubric` is the answer key — every expected
    // answer, ROI and dwell threshold — and the package's own `learnerCase()`
    // projection omits it in the room. But a projection in the browser only
    // decides what is SHOWN; the server strips these paths from every read a
    // role below reviewer makes (GET /cases, GET /cases/:id, case_snapshot), so
    // the key never reaches the learner's devtools in the first place.
    document: {
        learnerOmit: ['rubric'],
    },
};

export default manifest;
