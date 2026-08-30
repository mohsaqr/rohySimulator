import { studyForOrder } from '../../components/pacs/caseDocument.js';

/**
 * The join that makes ordering a CT produce IMAGES rather than only a report.
 *
 * rohy's Radiology room is the RIS and the PACS room is the workstation, which
 * is the same split a clinician crosses — but until this file existed the two
 * halves never met. A learner ordered a chest X-ray, waited out its turnaround,
 * read the text report, and the PACS room showed nothing: its worklist was
 * built only from studies an EDUCATOR had authored into the case, so in a case
 * with no authored imaging the room did not even appear.
 *
 * Radoyon's model already had the answer and rohy simply never asked it. A case
 * is *the catalogue, minus what changed*: a study the author said nothing about
 * is not absent, it is NORMAL, and `studyForOrder(doc, studyId, {archive})` is
 * the one rule that resolves an order — the case's own entry if it has one,
 * otherwise the archive's normal example, otherwise nothing. That rule is
 * delegated here rather than reimplemented, because the moment the host decides
 * for itself what an order resolves to, a learner sees something different from
 * what the author saw in the editor.
 *
 * THE PART ONLY THE HOST CAN DO is the identity join. rohy's order rows do not
 * carry the radiology catalogue's study id: `investigation_orders` points at a
 * `case_investigations` row that stores the study's NAME, and the name is what
 * the order comes back with. So the host maps name → catalogue id through
 * `GET /api/radiology-database` (the same catalogue the editor is authored
 * against, and the same one the learner ordered from), and hands the id to the
 * package. Names are unique across the 74 master studies, and an order whose
 * name matches none of them is an educator's custom study, which by definition
 * has no archive imaging — it is listed honestly rather than dropped.
 *
 * ANSWER-KEY DISCIPLINE. Nothing here reads the rubric, and nothing here goes
 * looking in the abnormal library: `studyForOrder` serves an abnormal entry
 * only through the case document's own entry — i.e. only where the author
 * deliberately changed that study — and its normal lookup explicitly skips
 * `abnormal/` ids. The document this file is given is already
 * `learnerDocument()`'s projection, and the archive a learner receives is
 * already reduced to `['id', 'studyId', 'series']` by the manifest. An order
 * therefore cannot reach imaging the case never referenced.
 */

/**
 * rohy's catalogue modality → the DICOM modality code the worklist badges.
 *
 * The two vocabularies are genuinely different: rohy's catalogue speaks a
 * clinician's department names ("X-Ray", "Nuclear Medicine") and DICOM speaks
 * two-letter codes. An unmapped modality yields no badge rather than a wrong
 * one — the row still renders, with the generic imaging icon the package
 * already shows for a study whose modality it does not know.
 */
const MODALITY_CODE = Object.freeze({
    'CT': 'CT',
    'MRI': 'MR',
    'X-Ray': 'XR',
    'Ultrasound': 'US',
    'Mammography': 'MG',
    'Nuclear Medicine': 'NM',
    'Fluoroscopy': 'FL',
    'DEXA': 'DXA',
    'Cardiac': 'CV',
});

/** Study names are matched case- and whitespace-insensitively; everything else
 *  about them is preserved, because the name is what the learner ordered. */
function nameKey(name) {
    return String(name ?? '').trim().toLowerCase();
}

/**
 * The imaging orders on a plugin context, as a plain array.
 *
 * Total: a context built before the host granted the capability, or by a test
 * that never sets one, yields an empty list rather than a throw. `available()`
 * runs through here and the standard requires it never to throw.
 *
 * @param {object} ctx the plugin context
 * @returns {Array<object>} narrowed imaging orders, possibly empty
 */
export function imagingOrders(ctx) {
    const imaging = ctx?.orders?.imaging;
    return Array.isArray(imaging) ? imaging : [];
}

/**
 * The worklist a learner should see: the studies the AUTHOR wired, plus the
 * studies the LEARNER ordered, each resolved through the package's own rule and
 * each appearing exactly once.
 *
 * @param {object} options
 * @param {Array<object>} options.authored rows already built from the case document
 * @param {object} options.doc the LEARNER projection of the case document
 * @param {object} options.archive the archive, as `readArchive()` normalises it
 * @param {Array<object>} options.orders narrowed imaging orders
 * @param {Array<object>} options.catalogue rohy's orderable studies
 * @param {(value: *) => *} options.resolveRefs rewrites `remote:` onto the proxy
 * @param {(key: string, fallback?: string) => string} options.t
 * @returns {Array<object>} worklist rows, authored first, then ordered
 */
export function mergeOrderedStudies({
    authored = [], doc, archive, orders = [], catalogue = [], resolveRefs = (v) => v, t = (k, f) => f ?? k,
}) {
    const catalogueByName = new Map(catalogue.map((study) => [nameKey(study.name), study]));

    // One order per study. The server already refuses a second order for the
    // same study name in a session, so this is belt-and-braces — but a worklist
    // that listed the same chest X-ray twice would be a defect the learner sees.
    const byStudy = new Map();
    const uncatalogued = [];
    orders.forEach((order) => {
        const study = catalogueByName.get(nameKey(order.studyName)) ?? null;
        if (!study) {
            uncatalogued.push(order);
            return;
        }
        if (!byStudy.has(study.id)) byStudy.set(study.id, { order, study });
    });

    const authoredIds = new Set(authored.map((row) => row.studyId).filter(Boolean));

    // A study the author wired AND the learner ordered is ONE row, not two: the
    // author's row wins (it is what the case is about) and the order only
    // contributes its turnaround gate.
    const rows = authored.map((row) => {
        const hit = byStudy.get(row.studyId);
        return hit ? gateByTurnaround(row, hit.order, t) : row;
    });

    byStudy.forEach(({ order, study }) => {
        if (authoredIds.has(study.id)) return;
        rows.push(rowForOrder({ order, study, doc, archive, resolveRefs, t }));
    });

    // An order the master catalogue does not know is an educator's custom
    // study. There is no archive imaging for it and there never could be, so it
    // is listed and said so — a learner who ordered it and then found no row at
    // all would reasonably conclude the room was broken.
    uncatalogued.forEach((order) => rows.push({
        id: `order_${order.id}`,
        studyId: null,
        description: order.studyName || t('radoyon_order_unknown_study', 'Study'),
        modality: MODALITY_CODE[order.modality] ?? null,
        accession: null,
        detail: t('radoyon_order_no_images', 'No images for this study'),
        available: false,
        error: true,
        ref: null,
        series: [],
    }));

    return rows;
}

/**
 * An authored row, gated by the order's turnaround.
 *
 * Only ever narrows: a row the case could not serve does not become servable
 * because someone ordered it. An authored study nobody ordered is untouched,
 * which keeps every case that worked before this seam existed working exactly
 * as it did.
 */
function gateByTurnaround(row, order, t) {
    if (order.ready) return row;
    return {
        ...row,
        available: false,
        detail: t('radoyon_order_reporting', 'Reporting — images not released yet'),
        // Withheld, not merely un-clickable. A pending study's references are
        // in the props of a component the learner can open devtools on, and
        // "not available yet" should mean the images are not there yet.
        ref: null,
        series: [],
    };
}

/**
 * One ordered study the case says nothing about — the normal-by-omission case
 * this whole seam exists for.
 */
function rowForOrder({ order, study, doc, archive, resolveRefs, t }) {
    const { source, archiveEntry } = studyForOrder(doc, study.id, { archive });
    // `source === 'case'` cannot happen here (an authored entry was excluded by
    // the caller), and `'none'` means the archive has no normal example for this
    // study — a real and common state, since rohy's catalogue lists 74 orderable
    // studies and no teaching archive covers all of them.
    const series = source === 'normal' ? resolveRefs(archiveEntry?.series ?? []) : [];
    const base = {
        id: `order_${order.id}`,
        studyId: study.id,
        description: study.name || study.id,
        modality: MODALITY_CODE[study.modality] ?? null,
        accession: null,
    };

    if (series.length === 0) {
        return {
            ...base,
            detail: t('radoyon_order_no_images', 'No images for this study'),
            available: false,
            error: true,
            ref: null,
            series: [],
        };
    }
    if (!order.ready) {
        return {
            ...base,
            detail: t('radoyon_order_reporting', 'Reporting — images not released yet'),
            available: false,
            ref: null,
            series: [],
        };
    }
    return {
        ...base,
        detail: t('radoyon_order_ordered', 'Ordered'),
        available: true,
        ref: series[0]?.ref ?? null,
        series,
    };
}

export default mergeOrderedStudies;
