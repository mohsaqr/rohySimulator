/**
 * The normal-study archive.
 *
 * The teaching idea this package is built around: a learner should be able to
 * order any study in the catalogue and get back a *real, complete, normal*
 * examination — not a paragraph saying "no acute abnormality". Normal is the
 * hardest thing to teach and the thing trainees see least deliberately. An
 * author then substitutes the abnormality for a specific case, and everything
 * the learner was not told about stays normal.
 *
 * Two rules shape the format:
 *
 * 1. **Studies are addressed, never embedded.** An entry names a reference
 *    (`remote:dicom/...`), which the host resolves through its own configured
 *    origin. A chest CT is ~150 MB; a case document carrying one would not fit
 *    in any host's case store, and an archive inside a Docker image would
 *    quadruple it. This mirrors what the host already does for pathology
 *    pyramids.
 *
 * 2. **Provenance is mandatory, not documentation.** Every entry MUST carry a
 *    licence and an attribution. Open imaging collections carry genuinely
 *    different terms — some permit redistribution, some permit research use
 *    only, some require attribution in a specific form — and the difference is
 *    invisible once the pixels are on disk. Making the field required means the
 *    question is answered at ingest by the person who knows, and an archive can
 *    be audited by reading its catalogue rather than by tracing files back to
 *    the collection they came from.
 */

/** Licence terms an entry may declare. `unknown` is legal, and always a warning. */
export const REDISTRIBUTION = Object.freeze({
    PERMITTED: 'permitted',       // e.g. CC BY / CC0 — may ship in a bundle
    ATTRIBUTION_ONLY: 'attribution_only', // may ship, attribution must be displayed
    LOCAL_ONLY: 'local_only',     // may be used on-site, must not be redistributed
    UNKNOWN: 'unknown',           // not yet reviewed
});

const REQUIRED_PROVENANCE = ['dataset', 'licence', 'redistribution'];

/**
 * Read a catalogue, normalising shape and defaulting nothing that matters.
 * Total: never throws on a malformed catalogue, because one bad entry must not
 * take the whole archive down. Problems surface through `archiveIssues()`.
 */
export function readArchive(raw) {
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];
    return {
        version: Number(raw?.version) || 1,
        name: typeof raw?.name === 'string' ? raw.name : 'Untitled archive',
        entries: entries.filter((e) => e && typeof e === 'object').map(readEntry),
    };
}

function readEntry(raw) {
    return {
        id: String(raw.id ?? ''),
        studyId: raw.studyId ?? null,
        modality: raw.modality ?? null,
        bodyRegion: raw.bodyRegion ?? null,
        label: raw.label ?? raw.id ?? '',
        description: raw.description ?? '',
        patient: raw.patient ?? {},
        series: Array.isArray(raw.series) ? raw.series.map(readSeriesRef) : [],
        provenance: raw.provenance ?? {},
        tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    };
}

function readSeriesRef(raw) {
    return {
        key: String(raw?.key ?? raw?.uid ?? ''),
        description: raw?.description ?? '',
        plane: raw?.plane ?? 'unknown',
        instances: Number(raw?.instances) || 0,
        ref: typeof raw?.ref === 'string' ? raw.ref : '',
        // Carried, not dropped. caseDocument.js judges whether spliced slices
        // are geometrically compatible with the series they are spliced into,
        // and it reads that geometry from here. An allowlist normaliser that
        // omits the field does not fail loudly — every compatibility check
        // simply passes, which is the worst possible way to be wrong.
        geometry: raw?.geometry && typeof raw.geometry === 'object' ? raw.geometry : null,
    };
}

/** Every entry whose study id matches, in catalogue order. */
export function entriesForStudy(archive, studyId) {
    return archive.entries.filter((e) => e.studyId === studyId);
}

/** One entry by id, or undefined. */
export function entryById(archive, id) {
    return archive.entries.find((e) => e.id === id);
}

/**
 * A tidy row per entry — what a picker renders, and what an operator auditing
 * licences reads. One row per entry, every column always present.
 */
export function archiveTable(archive) {
    return archive.entries.map((e) => ({
        id: e.id,
        label: e.label,
        studyId: e.studyId,
        modality: e.modality,
        bodyRegion: e.bodyRegion,
        seriesCount: e.series.length,
        instanceCount: e.series.reduce((n, s) => n + s.instances, 0),
        dataset: e.provenance.dataset ?? null,
        licence: e.provenance.licence ?? null,
        redistribution: e.provenance.redistribution ?? REDISTRIBUTION.UNKNOWN,
        attribution: e.provenance.attribution ?? null,
    }));
}

/**
 * Problems with a catalogue, as a flat list of `{ level, entryId, message }`.
 *
 * `error` means the entry cannot be served; `warning` means it can be served
 * but something needs a human. An unreviewed licence is a warning rather than
 * an error on purpose: it must not stop a teaching archive from working
 * locally, and it must not be silently shippable either.
 */
export function archiveIssues(archive) {
    const issues = [];
    const seen = new Set();

    archive.entries.forEach((entry) => {
        const at = (level, message) => issues.push({ level, entryId: entry.id, message });

        if (!entry.id) at('error', 'entry has no id');
        else if (seen.has(entry.id)) at('error', `duplicate entry id "${entry.id}"`);
        seen.add(entry.id);

        if (!entry.modality) at('warning', `"${entry.id}" declares no modality`);
        if (!entry.studyId) at('warning', `"${entry.id}" is not linked to a catalogue study id`);
        if (entry.series.length === 0) at('error', `"${entry.id}" has no series`);

        entry.series.forEach((s, i) => {
            if (!s.ref) at('error', `"${entry.id}" series ${i + 1} has no reference`);
            if (s.instances <= 0) at('warning', `"${entry.id}" series ${i + 1} declares no instances`);
        });

        REQUIRED_PROVENANCE.forEach((field) => {
            if (!entry.provenance[field]) at('warning', `"${entry.id}" provenance is missing ${field}`);
        });
        if (entry.provenance.redistribution === REDISTRIBUTION.UNKNOWN) {
            at('warning', `"${entry.id}" has an unreviewed licence — do not redistribute until checked`);
        }
        if (entry.provenance.redistribution === REDISTRIBUTION.ATTRIBUTION_ONLY && !entry.provenance.attribution) {
            at('error', `"${entry.id}" requires attribution but declares none`);
        }
    });

    return issues;
}

/**
 * The entries that may be included in a redistributable bundle — an air-gap
 * image, an offline teaching pack. Anything unreviewed or local-only is
 * excluded by construction rather than by a reviewer remembering to check.
 */
export function redistributableEntries(archive) {
    return archive.entries.filter((e) => (
        e.provenance.redistribution === REDISTRIBUTION.PERMITTED
        || (e.provenance.redistribution === REDISTRIBUTION.ATTRIBUTION_ONLY && e.provenance.attribution)
    ));
}

/** The attribution lines a bundle must display, deduplicated and sorted. */
export function attributionNotices(archive) {
    const notices = new Set();
    archive.entries.forEach((e) => {
        if (e.provenance.attribution) {
            notices.add(`${e.provenance.attribution} — ${e.provenance.licence ?? 'licence unstated'}`);
        }
    });
    return Array.from(notices).sort();
}
