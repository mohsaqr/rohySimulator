/**
 * The case document: what an author writes, and how "normal, except…" is said.
 *
 * A worklist entry has a **baseline** — normally an archive entry, a complete
 * normal examination — and zero or more **substitutions** that replace part of
 * it with the pathology this case is about. Everything not substituted stays
 * normal, which is the point: a learner looking for the abnormality has to
 * exclude the rest of a real study rather than a placeholder.
 *
 * A substitution comes in two strengths, and the difference is clinical, not
 * technical:
 *
 *   SERIES  replaces a whole series with a different acquisition. Geometrically
 *           self-consistent, because every slice came from one patient. This is
 *           the safe form and the default.
 *
 *   RANGE   splices a run of slices into the baseline series. It is what makes
 *           a focal finding cheap to author, and it is also how a case acquires
 *           an anatomically impossible volume: slices from a different patient
 *           at a different pixel spacing, spliced mid-stack, produce a study
 *           whose measurements are wrong and whose anatomy steps sideways at
 *           the seam. So RANGE is permitted, and `documentIssues()` checks the
 *           geometry and says so loudly when it does not match.
 *
 * Nothing here reaches for the network or the DOM; it is a pure model, so a
 * host can run the same judgements on its server that the editor runs in the
 * browser.
 */

export const SOURCE_KIND = Object.freeze({
    ARCHIVE: 'archive',   // an id in the normal archive catalogue
    REMOTE: 'remote',     // a `remote:` reference the host resolves
    NONE: 'none',         // nothing chosen yet — a normal state for a draft
});

export const SUBSTITUTION_SCOPE = Object.freeze({
    SERIES: 'series',
    RANGE: 'range',
});

/** The empty document — what a brand-new case starts from. */
export function emptyDocument() {
    return { version: 1, worklist: [] };
}

/**
 * Normalise any stored shape into the canonical document.
 *
 * Total by construction: a malformed document yields an empty-but-valid one
 * rather than throwing, because this runs on every case row a host lists and
 * one bad row must not take the list down.
 */
export function readDocument(raw) {
    if (!raw || typeof raw !== 'object') return emptyDocument();
    const worklist = Array.isArray(raw.worklist) ? raw.worklist : [];
    return {
        version: Number(raw.version) || 1,
        worklist: worklist.filter((e) => e && typeof e === 'object').map(readEntry),
    };
}

function readEntry(raw) {
    return {
        id: String(raw.id ?? ''),
        studyId: raw.studyId ?? null,
        description: raw.description ?? '',
        accession: raw.accession ?? null,
        // `null` and `''` must stay absent. `Number(null)` is 0, so a naive
        // coercion turns "use the study's own turnaround" into "available
        // immediately" the SECOND time a document is normalised — and hosts
        // re-normalise constantly (read, validate, project, save). Absence is
        // tested before coercion so readDocument() is idempotent.
        availableAtMinutes: raw.availableAtMinutes === null || raw.availableAtMinutes === undefined || raw.availableAtMinutes === ''
            ? null
            : (Number.isFinite(Number(raw.availableAtMinutes)) ? Number(raw.availableAtMinutes) : null),
        baseline: readSource(raw.baseline),
        substitutions: Array.isArray(raw.substitutions)
            ? raw.substitutions.filter((s) => s && typeof s === 'object').map(readSubstitution)
            : [],
        report: {
            findings: raw.report?.findings ?? '',
            impression: raw.report?.impression ?? '',
            reportedBy: raw.report?.reportedBy ?? null,
            // A case may deliberately withhold the report so the learner must
            // read the images. Absent means "not written"; false means
            // "written, but not released" — different things.
            released: raw.report?.released !== false,
        },
        rubric: raw.rubric && typeof raw.rubric === 'object' ? raw.rubric : undefined,
    };
}

function readSource(raw) {
    if (!raw || typeof raw !== 'object') return { kind: SOURCE_KIND.NONE, ref: null };
    const kind = Object.values(SOURCE_KIND).includes(raw.kind) ? raw.kind : SOURCE_KIND.NONE;
    return { kind, ref: typeof raw.ref === 'string' && raw.ref ? raw.ref : null };
}

function readSubstitution(raw) {
    const scope = raw.scope === SUBSTITUTION_SCOPE.RANGE ? SUBSTITUTION_SCOPE.RANGE : SUBSTITUTION_SCOPE.SERIES;
    return {
        id: String(raw.id ?? ''),
        label: raw.label ?? '',
        scope,
        // Which baseline series this replaces. Null means "the first/only one",
        // which is what a single-series study (CR, DX) always means.
        targetSeriesKey: raw.targetSeriesKey ?? null,
        source: readSource(raw.source),
        // Inclusive slice indices into the ORDERED baseline series. Only
        // meaningful for RANGE.
        range: scope === SUBSTITUTION_SCOPE.RANGE && raw.range
            ? { from: Math.trunc(Number(raw.range.from) || 0), to: Math.trunc(Number(raw.range.to) || 0) }
            : null,
        // Declared geometry of the substituted material, so compatibility can
        // be judged without fetching a single pixel.
        geometry: raw.geometry && typeof raw.geometry === 'object' ? raw.geometry : null,
    };
}

/**
 * Resolve one worklist entry into the series a viewer should show.
 *
 * This is the function that actually performs the swap. It takes the baseline's
 * series list (from the archive, or from a probe of a remote study) and applies
 * the substitutions in order, returning a description of what the learner will
 * see, with each series labelled by where it came from.
 *
 * @returns {{ series: Array<{key, description, plane, instances, ref, origin,
 *   substitutionId, splices}>, unresolved: Array<{reason, substitutionId}> }}
 */
export function resolveEntry(entry, { baselineSeries = [] } = {}) {
    const series = baselineSeries.map((s) => ({
        key: s.key,
        description: s.description,
        plane: s.plane,
        instances: s.instances,
        ref: s.ref,
        origin: 'baseline',
        substitutionId: null,
        splices: [],
    }));
    const unresolved = [];

    entry.substitutions.forEach((sub) => {
        if (sub.source.kind === SOURCE_KIND.NONE || !sub.source.ref) {
            unresolved.push({ reason: 'no_source', substitutionId: sub.id });
            return;
        }
        // A null target on a single-series study means that series; on a
        // multi-series study it is ambiguous and must not be guessed.
        const index = sub.targetSeriesKey === null
            ? (series.length === 1 ? 0 : -1)
            : series.findIndex((s) => s.key === sub.targetSeriesKey);

        if (index < 0) {
            // A substitution with no baseline to attach to still shows the
            // learner something — it becomes a series in its own right. Losing
            // it silently would hide the entire pathology of the case.
            series.push({
                key: sub.id || `substitution:${series.length}`,
                description: sub.label || 'Substituted series',
                plane: sub.geometry?.plane ?? 'unknown',
                instances: sub.geometry?.instances ?? 0,
                ref: sub.source.ref,
                origin: 'substitution',
                substitutionId: sub.id,
                splices: [],
            });
            if (sub.targetSeriesKey !== null) {
                unresolved.push({ reason: 'target_missing', substitutionId: sub.id });
            } else if (baselineSeries.length !== 1) {
                unresolved.push({ reason: 'ambiguous_target', substitutionId: sub.id });
            }
            return;
        }

        if (sub.scope === SUBSTITUTION_SCOPE.SERIES) {
            // The BASELINE's description is kept deliberately. The label is the
            // author's name for the finding — the answer — and a scanner would
            // have written 'AXIAL CHEST' whatever was in the lungs. Naming the
            // series after its pathology hands the learner the diagnosis in
            // the series rail, which defeats the case.
            series[index] = {
                ...series[index],
                ref: sub.source.ref,
                instances: sub.geometry?.instances ?? series[index].instances,
                origin: 'substitution',
                substitutionId: sub.id,
                splices: [],
            };
            return;
        }

        series[index] = {
            ...series[index],
            origin: series[index].origin === 'baseline' ? 'spliced' : series[index].origin,
            splices: [...series[index].splices, {
                substitutionId: sub.id,
                label: sub.label,
                from: sub.range?.from ?? 0,
                to: sub.range?.to ?? 0,
                ref: sub.source.ref,
            }],
        };
    });

    return { series, unresolved };
}

/**
 * Everything wrong with a document, as `{ level, message, entryId? }`.
 *
 * `error` blocks releasing the case to learners; `warning` does not. Neither
 * ever blocks SAVING — a half-written case is the normal state of an unfinished
 * one, and an editor that refuses to save is an editor that loses work.
 */
export function documentIssues(doc, { archive = null } = {}) {
    const document = readDocument(doc);
    const issues = [];
    const seen = new Set();

    if (document.worklist.length === 0) {
        issues.push({ level: 'warning', message: 'the worklist is empty — no imaging will appear' });
    }

    document.worklist.forEach((entry) => {
        const at = (level, message) => issues.push({ level, entryId: entry.id, message });
        const name = entry.description || entry.studyId || entry.id || 'an entry';

        if (!entry.id) at('error', 'a worklist entry has no id');
        else if (seen.has(entry.id)) at('error', `duplicate worklist entry id "${entry.id}"`);
        seen.add(entry.id);

        if (!entry.studyId) at('warning', `${name} is not linked to a catalogue study`);

        if (entry.baseline.kind === SOURCE_KIND.NONE) {
            at('error', `${name} has no baseline study`);
        } else if (!entry.baseline.ref) {
            at('error', `${name} declares a ${entry.baseline.kind} baseline with no reference`);
        } else if (entry.baseline.kind === SOURCE_KIND.ARCHIVE && archive) {
            const found = archive.entries.some((e) => e.id === entry.baseline.ref);
            if (!found) at('error', `${name} references archive entry "${entry.baseline.ref}", which is not in the catalogue`);
        }

        // Resolved once: every substitution is judged against the same baseline.
        const baseline = archive && entry.baseline.kind === SOURCE_KIND.ARCHIVE
            ? archive.entries.find((e) => e.id === entry.baseline.ref)
            : null;

        const subSeen = new Set();
        entry.substitutions.forEach((sub, i) => {
            const subName = sub.label || `substitution ${i + 1}`;
            if (!sub.id) at('error', `${name}: ${subName} has no id`);
            else if (subSeen.has(sub.id)) at('error', `${name}: duplicate substitution id "${sub.id}"`);
            subSeen.add(sub.id);

            if (sub.source.kind === SOURCE_KIND.NONE || !sub.source.ref) {
                at('error', `${name}: ${subName} has no source — the pathology is missing`);
            }

            // A substitution names the baseline series it replaces. Replacing
            // the baseline with different imaging leaves that name pointing at
            // nothing, and an orphaned substitution does not fail loudly — the
            // finding simply never appears, and the case teaches a normal study
            // while claiming to teach a nodule. Null means "the first series",
            // which is what a single-series study always means, so only a
            // NAMED key that is absent is wrong.
            if (baseline && sub.targetSeriesKey !== null
                && !baseline.series.some((s) => s.key === sub.targetSeriesKey)) {
                at('error', `${name}: ${subName} replaces series "${sub.targetSeriesKey}", which is not in "${baseline.id}" — repoint it or the finding will not appear`);
            }

            if (sub.scope === SUBSTITUTION_SCOPE.RANGE) {
                if (!sub.range) {
                    at('error', `${name}: ${subName} is a slice range but declares none`);
                } else if (sub.range.to < sub.range.from) {
                    at('error', `${name}: ${subName} ends before it begins (${sub.range.from}–${sub.range.to})`);
                }
                issues.push(...spliceGeometryIssues(entry, sub, subName, name, archive));
            }
        });

        if (entry.report.released && !entry.report.findings && !entry.report.impression) {
            at('warning', `${name} releases a report with no findings and no impression`);
        }
    });

    return issues;
}

/**
 * Whether spliced material is geometrically compatible with what it is spliced
 * into. This is the check that keeps RANGE honest.
 *
 * Compared without fetching pixels, from the declared geometry on both sides.
 * Undeclared geometry is a warning, not an error: it means "nobody has checked",
 * which is exactly what an author should be told.
 */
function spliceGeometryIssues(entry, sub, subName, name, archive) {
    const issues = [];
    const at = (level, message) => issues.push({ level, entryId: entry.id, message });

    const baseline = archive && entry.baseline.kind === SOURCE_KIND.ARCHIVE
        ? archive.entries.find((e) => e.id === entry.baseline.ref)
        : null;
    const target = baseline
        ? (sub.targetSeriesKey === null ? baseline.series[0] : baseline.series.find((s) => s.key === sub.targetSeriesKey))
        : null;

    if (!sub.geometry) {
        at('warning', `${name}: ${subName} splices slices without declaring their geometry — compatibility is unchecked`);
        return issues;
    }
    if (!target?.geometry) return issues;

    const a = target.geometry;
    const b = sub.geometry;
    const near = (x, y, tol) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tol;

    if (Number.isFinite(a.rows) && Number.isFinite(b.rows) && (a.rows !== b.rows || a.columns !== b.columns)) {
        at('error', `${name}: ${subName} is ${b.rows}x${b.columns} but the baseline series is ${a.rows}x${a.columns} — the stack would change size mid-scroll`);
    }
    if (a.pixelSpacing && b.pixelSpacing && !near(a.pixelSpacing[0], b.pixelSpacing[0], 0.01)) {
        at('error', `${name}: ${subName} has ${b.pixelSpacing[0]} mm pixels against the baseline's ${a.pixelSpacing[0]} mm — every measurement across the seam would be wrong`);
    }
    if (Number.isFinite(a.spacing) && Number.isFinite(b.spacing) && !near(a.spacing, b.spacing, 0.05)) {
        at('warning', `${name}: ${subName} is reconstructed at ${b.spacing} mm against the baseline's ${a.spacing} mm`);
    }
    if (a.plane && b.plane && a.plane !== b.plane) {
        at('error', `${name}: ${subName} is ${b.plane} but the baseline series is ${a.plane}`);
    }
    if (Number.isFinite(target.instances) && sub.range && sub.range.to >= target.instances) {
        at('error', `${name}: ${subName} covers slices ${sub.range.from}–${sub.range.to} but the baseline series has only ${target.instances}`);
    }
    return issues;
}

/** True when a document has something a learner can actually open (RPS-1 R20). */
export function documentIsServable(doc) {
    const document = readDocument(doc);
    return document.worklist.some((entry) => (
        (entry.baseline.kind !== SOURCE_KIND.NONE && entry.baseline.ref)
        || entry.substitutions.some((s) => s.source.kind !== SOURCE_KIND.NONE && s.source.ref)
    ));
}

/** A one-line count for a host's case card. */
export function documentSummary(doc) {
    const document = readDocument(doc);
    const count = document.worklist.filter((e) => (
        (e.baseline.kind !== SOURCE_KIND.NONE && e.baseline.ref)
        || e.substitutions.some((s) => s.source.ref)
    )).length;
    return { count, labelKey: 'radoyon_studies_count' };
}

/**
 * The learner's projection: the document with every rubric removed.
 *
 * Removal is by construction — the entry is rebuilt without the field — rather
 * than by deleting it from a copy, so a rubric cannot survive by being nested
 * somewhere the deletion did not look.
 */
export function learnerDocument(doc) {
    const document = readDocument(doc);
    return {
        version: document.version,
        worklist: document.worklist.map(({ rubric, report, ...entry }) => ({
            ...entry,
            report: report.released ? report : { findings: '', impression: '', reportedBy: null, released: false },
        })),
    };
}

/**
 * A case as the CATALOGUE sees it: one row per orderable study, whether or not
 * the case says anything about it.
 *
 * This is the shape the editor is built on, and it encodes the teaching claim.
 * A learner may order any study in the catalogue, and unless the author changed
 * it they get a real, complete, normal examination. So a case is not a worklist
 * an author assembles — it is the whole catalogue, minus the author's changes.
 *
 * The stored document still holds only what CHANGED. That is deliberate: a case
 * document that enumerated 74 studies to say "normal" 73 times would grow every
 * time the catalogue did, and would silently freeze a case to the catalogue as
 * it stood the day it was written.
 *
 * @param {object} doc the case document
 * @param {{archive: object, catalogue: Array}} context
 * @returns {Array<{studyId, name, modality, bodyRegion, state, entry, normalEntry,
 *   wiredEntryId, findingCount, backed}>} one row per catalogue study, in
 *   catalogue order. `state` is:
 *     'changed'  the case says something about this study
 *     'normal'   untouched, and the archive has a normal example to serve
 *     'unbacked' untouched, and there is no imaging for it yet — orderable in
 *                the host, but nothing to open
 */
export function caseCatalogue(doc, { archive = null, catalogue = [] } = {}) {
    const document = readDocument(doc);
    const byStudy = new Map(document.worklist.map((e) => [e.studyId, e]));
    const normals = new Map();
    (archive?.entries ?? []).forEach((e) => {
        // The first normal example wins, so the row is stable rather than
        // depending on catalogue order within a study.
        if (e.studyId && !String(e.id).startsWith('abnormal/') && !normals.has(e.studyId)) {
            normals.set(e.studyId, e);
        }
    });

    return catalogue.map((study) => {
        const entry = byStudy.get(study.id) ?? null;
        const normalEntry = normals.get(study.id) ?? null;
        return {
            studyId: study.id,
            name: study.name ?? study.id,
            modality: study.modality ?? null,
            bodyRegion: study.bodyRegion ?? study.body_region ?? null,
            entry,
            normalEntry,
            backed: Boolean(normalEntry),
            wiredEntryId: entry?.baseline?.kind === SOURCE_KIND.ARCHIVE ? entry.baseline.ref : null,
            // The archive entry the case actually points at, which is what a
            // card must show. For a changed study that is usually NOT the
            // normal example, and showing the normal one would picture a study
            // the learner will never see.
            wiredEntry: entry?.baseline?.kind === SOURCE_KIND.ARCHIVE
                ? ((archive?.entries ?? []).find((e) => e.id === entry.baseline.ref) ?? null)
                : null,
            findingCount: entry?.substitutions?.length ?? 0,
            state: entry ? 'changed' : (normalEntry ? 'normal' : 'unbacked'),
        };
    });
}

/**
 * What a learner ordering `studyId` should be handed.
 *
 * The rule the whole model rests on, in one place so a host cannot implement it
 * differently from the editor: the case's own entry when it has one, otherwise
 * the archive's normal example, otherwise nothing.
 *
 * @returns {{source: 'case'|'normal'|'none', entry: object|null, archiveEntry: object|null}}
 */
export function studyForOrder(doc, studyId, { archive = null } = {}) {
    const document = readDocument(doc);
    const entry = document.worklist.find((e) => e.studyId === studyId) ?? null;
    if (entry) {
        const archiveEntry = entry.baseline.kind === SOURCE_KIND.ARCHIVE && archive
            ? (archive.entries.find((e) => e.id === entry.baseline.ref) ?? null)
            : null;
        return { source: 'case', entry, archiveEntry };
    }
    const normal = (archive?.entries ?? []).find(
        (e) => e.studyId === studyId && !String(e.id).startsWith('abnormal/'),
    ) ?? null;
    return normal
        ? { source: 'normal', entry: null, archiveEntry: normal }
        : { source: 'none', entry: null, archiveEntry: null };
}

/**
 * A blank entry for a catalogue study the author has decided to change.
 *
 * Seeded from the archive's normal example, because "changed" starts from
 * normal — that is what makes everything the author does not touch stay real.
 * The report is withheld rather than released-and-empty: nobody has written one
 * yet, and releasing an empty report is a different claim from withholding it.
 */
export function entryForStudy(study, { normalEntry = null } = {}) {
    return {
        id: `study_${study.id ?? study.studyId}`,
        studyId: study.id ?? study.studyId,
        description: study.name ?? '',
        accession: null,
        availableAtMinutes: null,
        baseline: normalEntry
            ? { kind: SOURCE_KIND.ARCHIVE, ref: normalEntry.id }
            : { kind: SOURCE_KIND.NONE, ref: null },
        substitutions: [],
        report: { findings: '', impression: '', reportedBy: null, released: false },
    };
}
