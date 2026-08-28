/**
 * Authoring a case — and, more importantly, checking it.
 *
 * WHY THIS MODULE IS MOSTLY VALIDATION: a pathology case is a piece of
 * assessment configuration whose defects are invisible until a learner hits
 * them. An ROI that demands 40x on a 10x archive is not a typo anyone will
 * notice while writing it — it is a region the learner can never satisfy, so
 * it is reported MISSED for every trainee who ever takes the case, and the
 * read score is silently wrong for all of them. The same goes for an ROI sitting
 * outside the tissue bounds, or a case with no critical findings at all.
 *
 * So the authoring surface is not "a form that saves JSON". It is a form that
 * refuses to let an author ship a case that cannot be passed.
 *
 * THE OTHER HALF is that ROIs and annotations are the SAME GEOMETRY. Both are
 * axis-aligned rectangles in level-0 slide pixels — that is not a coincidence,
 * it is the coordinate invariant the whole package is built on. So an author
 * can DRAW an answer key with the same tools a trainee uses to mark a slide,
 * and `annotationToRoi` / `roiToAnnotation` are a lossless round trip rather
 * than a conversion.
 */

import { ANNOTATION_KINDS, annotationBounds, createAnnotation } from './annotationModel.js';
import { objectiveCeiling } from './magnification.js';
import { hasOpticalProfile } from './slideGeometry.js';
import { canonicalJSONStringify } from './caseCore/canonicalJson.js';

/** The synthetic id for the tissue-bounds rectangle while it is being drawn. */
export const TISSUE_BOUNDS_ID = '__tissue_bounds__';

/**
 * How a drawn region is shown while authoring.
 *
 * Okabe-Ito, and never colour alone: a critical ROI is also labelled "key" in
 * the list and drawn with its own name on the slide.
 */
export const AUTHORING_CLASSES = {
    critical: { name: 'Key finding', color: '#D55E00' },
    supporting: { name: 'Supporting', color: '#0072B2' },
    tissue: { name: 'Tissue bounds', color: '#009E73' },
};

/**
 * An answer-key ROI as a drawable annotation.
 *
 * @param {object} roi  {id, label, x, y, w, h, minObjective, dwellMs, critical}
 * @returns {object} annotation record
 */
export function roiToAnnotation(roi) {
    requireRect(roi, `roiToAnnotation(${JSON.stringify(roi?.id)})`);
    return createAnnotation({
        id: roi.id,
        kind: ANNOTATION_KINDS.RECTANGLE,
        points: [{ x: roi.x, y: roi.y }, { x: roi.x + roi.w, y: roi.y + roi.h }],
        classification: roi.critical ? AUTHORING_CLASSES.critical : AUTHORING_CLASSES.supporting,
        // The label carries the objective it demands, because "did I set this
        // one to 20x?" is the question an author asks while looking at the
        // slide, not while reading a side panel.
        text: `${roi.label || 'Unnamed'} · ${roi.minObjective}x`,
    });
}

/**
 * The tissue-bounds rectangle as a drawable annotation.
 *
 * @param {{x:number,y:number,w:number,h:number}} bounds
 * @returns {object} annotation record
 */
export function tissueBoundsToAnnotation(bounds) {
    requireRect(bounds, 'tissueBoundsToAnnotation(bounds)');
    return createAnnotation({
        id: TISSUE_BOUNDS_ID,
        kind: ANNOTATION_KINDS.RECTANGLE,
        points: [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.w, y: bounds.y + bounds.h }],
        classification: AUTHORING_CLASSES.tissue,
        text: 'Tissue bounds',
    });
}

/**
 * Read an edited annotation's geometry back into a rect.
 *
 * Rounded to whole slide pixels: an answer key is read by humans and diffed in
 * version control, and 48000.0000001 helps nobody.
 *
 * @param {object} annotation
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function annotationToRect(annotation) {
    const { x, y, w, h } = annotationBounds(annotation);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * Turn a freshly drawn region into a new ROI.
 *
 * `minObjective` defaults to the power the author was ACTUALLY VIEWING at when
 * they drew it, which is very nearly always what they mean: you zoom to the
 * power at which a feature is resolvable and then draw around it. A fixed
 * default would be wrong at both ends of the range.
 *
 * @param {object} annotation
 * @param {object} p
 * @param {number} p.index        for the generated id
 * @param {number} p.minObjective the viewer's current objective
 * @returns {object} ROI
 */
export function annotationToRoi(annotation, { index, minObjective }) {
    if (!(typeof minObjective === 'number' && Number.isFinite(minObjective) && minObjective > 0)) {
        throw new RangeError(`annotationToRoi(): minObjective must be a finite positive number, received ${minObjective}`);
    }
    return {
        id: `roi-${index}`,
        label: '',
        ...annotationToRect(annotation),
        // Rounded to a tenth: the author sets a threshold, not a measurement,
        // and 9.87x as a requirement is noise dressed as precision.
        minObjective: Math.round(minObjective * 10) / 10,
        dwellMs: 1500,
        critical: false,
    };
}

/**
 * Read a number an author typed, accepting either decimal separator.
 *
 * WHY NOT `<input type="number">` AND `Number()`: a number input rejects the
 * decimal separator that does not match the browser's locale, and reports the
 * rejected value as an EMPTY STRING. Rohy ships de, es, fi, it and sv locales,
 * where the separator is a comma — so a German instructor typing "0,25" for
 * microns-per-pixel had the field silently clear itself, which then removed the
 * slide's calibration entirely.
 *
 * A single comma with no period is a decimal separator; anything else is
 * treated as digit grouping and dropped. That rule is safe here because every
 * value on this form is a small magnitude — an objective, a downsample factor,
 * a micron figure — never a grouped thousand.
 *
 * @param {string} text
 * @returns {number|undefined} undefined for blank or unparseable input
 */
export function parseDecimal(text) {
    if (typeof text !== 'string') return undefined;
    const trimmed = text.trim();
    if (trimmed === '') return undefined;
    // Stated explicitly rather than as one regex. The obvious
    // /^[^.]*,[^,]*$/ is wrong twice over: it only forbids a period BEFORE the
    // comma, so "1,000.5" slipped through as a decimal, and backtracking let
    // "1,234,567" match by splitting at the second comma.
    const commas = (trimmed.match(/,/g) ?? []).length;
    const normalised = commas === 1 && !trimmed.includes('.')
        ? trimmed.replace(',', '.')
        : trimmed.replace(/,/g, '');
    const value = Number(normalised);
    return Number.isFinite(value) ? value : undefined;
}

/**
 * Does this slide carry everything the optics depend on?
 *
 * Every magnification helper throws on an incomplete profile — deliberately,
 * because a viewer that invents a magnification is the failure this package
 * exists to prevent. But an EDITOR is where those fields get filled in, so it
 * must survive them being blank rather than crashing the form the author is
 * using to fix them.
 *
 * @param {object} slide
 * @returns {boolean}
 */
export function hasOptics(slide) {
    return hasOpticalProfile(slide);
}

// --- validation -----------------------------------------------------------

/**
 * Everything wrong with a case, worst first.
 *
 * `error` means the case is broken and will not run correctly.
 * `warning` means it will run but will teach or score badly.
 * `note` is a design choice worth seeing, not a defect.
 *
 * Returns a LIST rather than throwing, because an author needs to see all of
 * it at once — fixing one problem only to be shown the next is how a form
 * becomes unusable.
 *
 * @param {object} pathologyCase
 * @param {number} [maxZoomPixelRatio=1.1]  the viewer's interpolation allowance
 * @returns {Array<{severity:string, path:string, message:string}>}
 */
export function validateCase(pathologyCase, maxZoomPixelRatio = 1.1) {
    const issues = [];
    const add = (severity, path, message) => issues.push({ severity, path, message });

    if (!pathologyCase || typeof pathologyCase !== 'object') {
        return [{ severity: 'error', path: 'case', message: 'There is no case to validate.' }];
    }

    const slides = Array.isArray(pathologyCase.slides) ? pathologyCase.slides : [];
    const specimens = Array.isArray(pathologyCase.specimens) ? pathologyCase.specimens : [];
    if (pathologyCase.slides !== undefined && !Array.isArray(pathologyCase.slides)) {
        add('error', 'slides', 'slides must be an array.');
    }
    if (pathologyCase.specimens !== undefined && !Array.isArray(pathologyCase.specimens)) {
        add('error', 'specimens', 'specimens must be an array.');
    }
    if (slides.length === 0 && specimens.length === 0) {
        add('error', 'slides', 'The case has no slides and no gross specimens, so the room will be empty.');
    }

    duplicates(slides.map((s) => s?.id)).forEach((id) => {
        add('error', 'slides', `Two slides share the id "${id}". Slide ids must be unique — annotations are stored against them.`);
    });

    slides.forEach((slide, i) => validateSlide(slide, i, add));

    // A case with no task is a plain viewing case, which is the ordinary
    // shape. It gets no commentary — a permanent "note" on the normal case
    // trains an author to ignore the checks panel.
    const task = pathologyCase.task;
    if (!task) return sortIssues(issues);
    if (!task.prompt?.trim()) {
        add('warning', 'task.prompt', 'The task has no prompt, so the reader is not told what they are being asked to do.');
    }

    const key = task.answerKey;
    if (!key) return sortIssues(issues);

    // The read assessment is scored against the FIRST slide's optics, which is
    // the slide the recorder samples.
    const primary = slides[0];
    const ceiling = primary && isOpticallyComplete(primary)
        ? objectiveCeiling(primary, maxZoomPixelRatio)
        : null;

    validateAnswerKey(key, { ceiling, primary, add });
    return sortIssues(issues);
}

function validateSlide(slide, i, add) {
    const at = `slides[${i}]`;
    if (!slide || typeof slide !== 'object' || Array.isArray(slide)) {
        add('error', at, `Slide ${i + 1} must be an object.`);
        return;
    }
    if (!slide.id) add('error', `${at}.id`, 'The slide has no id.');
    if (!slide.dzi) add('error', `${at}.dzi`, `Slide "${slide.label || slide.id}" has no tile source, so nothing will render.`);
    if (!slide.label) add('warning', `${at}.label`, `Slide "${slide.id}" has no label, so the slide list shows nothing useful.`);

    [['nativeObjective', 'the objective the slide was scanned at'],
        ['nativeMpp', 'microns per level-0 pixel'],
        ['downsample', 'the archive level factor']].forEach(([field, what]) => {
        const v = slide[field];
        if (!(typeof v === 'number' && Number.isFinite(v) && v > 0)) {
            add('error', `${at}.${field}`,
                `Slide "${slide.label || slide.id}" is missing ${field} (${what}). `
                + 'Without it no magnification, scale bar or measurement can be computed.');
        }
    });
}

function validateAnswerKey(key, { ceiling, primary, add }) {
    const rois = key.roi ?? [];
    if (!Array.isArray(key.roi)) {
        add('error', 'answerKey.roi', 'answerKey.roi must be an array of regions.');
        return;
    }
    if (rois.length === 0) {
        add('warning', 'answerKey.roi', 'The answer key has no regions, so the read score measures coverage only — nothing about what was found.');
    }
    if (rois.length > 0 && !rois.some((r) => r.critical)) {
        add('warning', 'answerKey.roi',
            'No region is marked critical. "Time to first critical finding" cannot be measured, and every region is weighted the same.');
    }

    duplicates(rois.map((r) => r.id)).forEach((id) => {
        add('error', 'answerKey.roi', `Two regions share the id "${id}". Each is logged as its own REACHED_ROI / MISSED_ROI row.`);
    });

    // THE CHECK THAT MATTERS MOST. A region demanding more magnification than
    // the archive can deliver is unreachable: it is reported missed for every
    // trainee who ever takes the case, and no amount of careful reading fixes it.
    if (ceiling !== null && key.screeningObjective > ceiling) {
        add('error', 'answerKey.screeningObjective',
            `screeningObjective is ${key.screeningObjective}x but this archive tops out at ${round1(ceiling)}x. `
            + 'No time would ever be counted as high power.');
    }

    rois.forEach((roi, i) => {
        const at = `answerKey.roi[${i}]`;
        if (!roi.id) add('error', at, `Region ${i + 1} has no id.`);
        if (!roi.label?.trim()) add('warning', `${at}.label`, `Region "${roi.id}" has no label, so its feedback line reads as blank.`);

        if (!(roi.w > 0 && roi.h > 0)) {
            add('error', `${at}`, `Region "${roi.id}" has no area (w ${roi.w}, h ${roi.h}), so it can never be reached.`);
        }
        if (!(roi.dwellMs > 0)) {
            add('warning', `${at}.dwellMs`, `Region "${roi.id}" has no dwell requirement, so glancing across it counts as reading it.`);
        }
        if (ceiling !== null && roi.minObjective > ceiling) {
            add('error', `${at}.minObjective`,
                `Region "${roi.id}" requires ${roi.minObjective}x but this archive tops out at ${round1(ceiling)}x. `
                + 'Every reader would be marked as having missed it.');
        }
        if (key.tissueBounds && !containsRect(key.tissueBounds, roi)) {
            add('warning', `${at}`,
                `Region "${roi.id}" lies outside tissueBounds, so it sits in a part of the slide the coverage grid does not score.`);
        }
        if (primary?.slideWidthPx && primary?.slideHeightPx && !withinSlide(roi, primary)) {
            add('error', `${at}`,
                `Region "${roi.id}" falls outside the slide (${primary.slideWidthPx} x ${primary.slideHeightPx} px). `
                + 'Check whether its coordinates are archive pixels rather than level-0 pixels.');
        }
    });

    if (key.tissueBounds && !(key.tissueBounds.w > 0 && key.tissueBounds.h > 0)) {
        add('error', 'answerKey.tissueBounds', 'tissueBounds has no area, so slide coverage cannot be computed.');
    }
    if (!key.tissueBounds) {
        add('warning', 'answerKey.tissueBounds',
            'No tissueBounds: coverage is measured against the whole slide including the empty glass around the section, so it will read far lower than the reader deserves.');
    }
    if (key.coverageGrid !== undefined && !(Number.isInteger(key.coverageGrid) && key.coverageGrid >= 2)) {
        add('error', 'answerKey.coverageGrid', 'coverageGrid must be an integer of at least 2.');
    }
    if (!key.diagnosis?.trim()) {
        add('note', 'answerKey.diagnosis', 'No expected diagnosis recorded. Nothing in the room grades report text, but the key is the only place that intent is written down.');
    }
}

// --- helpers --------------------------------------------------------------

const SEVERITY_ORDER = { error: 0, warning: 1, note: 2 };
const sortIssues = (issues) => [...issues].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
);

const round1 = (n) => Math.round(n * 10) / 10;

const duplicates = (values) => [...new Set(
    values.filter((v, i) => v !== undefined && values.indexOf(v) !== i),
)];

// One rule, defined next to opticalProfile() so the viewer and the editor can
// never disagree about what "calibrated" means.
const isOpticallyComplete = hasOpticalProfile;

const containsRect = (outer, inner) => inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;

const withinSlide = (roi, slide) => roi.x >= 0
    && roi.y >= 0
    && roi.x + roi.w <= slide.slideWidthPx
    && roi.y + roi.h <= slide.slideHeightPx;

function requireRect(rect, who) {
    const bad = ['x', 'y', 'w', 'h'].find(
        (k) => !(typeof rect?.[k] === 'number' && Number.isFinite(rect[k])),
    );
    if (bad) {
        throw new TypeError(`${who}: needs finite numeric x/y/w/h, ${bad} was ${JSON.stringify(rect?.[bad])}`);
    }
    return rect;
}

/**
 * Can this case be shipped?
 *
 * @param {Array<object>} issues  a validateCase() result
 * @returns {boolean}
 */
export function isShippable(issues) {
    return !issues.some((i) => i.severity === 'error');
}

/**
 * The case as the JSON file the room consumes.
 *
 * Key order is fixed and the output is indented, because these files are
 * hand-edited and diffed in version control — a serialiser that reorders keys
 * on every save turns a one-line change into a whole-file diff.
 *
 * @param {object} pathologyCase
 * @returns {string}
 */
export function caseToJSON(pathologyCase) {
    if (pathologyCase?.schemaVersion) return canonicalJSONStringify(pathologyCase);
    const ordered = {
        $comment: pathologyCase.$comment
            ?? 'Authored in the Rohy pathology case editor. Coordinates are SLIDE (level-0) pixels, so they survive a re-export at any archive level.',
        id: pathologyCase.id,
        accession: pathologyCase.accession,
        specimen: pathologyCase.specimen,
        slides: pathologyCase.slides ?? [],
        ...(pathologyCase.specimens?.length ? { specimens: pathologyCase.specimens } : {}),
        ...(pathologyCase.task ? { task: pathologyCase.task } : {}),
    };
    return JSON.stringify(ordered, null, 2);
}

/**
 * A blank case, complete enough that the editor is never in a state it cannot
 * describe.
 *
 * `screeningObjective` and `coverageGrid` are pre-filled with the values the
 * read assessment documents as sensible defaults, so an author who never opens
 * those fields still gets a case that scores properly rather than one that
 * silently measures nothing.
 *
 * @returns {object} a valid, empty case
 */
export function blankCase() {
    // Slides and nothing else. A case is a set of slides to look at; the task
    // and answer key are optional assessment scaffolding layered on top, and
    // most cases will never carry them.
    return { id: 'new-case', accession: '', specimen: '', slides: [] };
}

/**
 * A blank slide, ready to have its tile source and calibration filled in.
 *
 * The three optical fields start EMPTY rather than pre-filled with 40 / 0.25 /
 * 1. A plausible default here would be a lie about a specific scanner, and it
 * would pass validation while producing silently wrong measurements — far
 * worse than a field the checks panel tells you to complete.
 *
 * @param {number} index  for the generated id and label
 * @returns {object} slide descriptor
 */
export function blankSlide(index) {
    return {
        id: `slide-${index}`,
        label: `Slide ${index}`,
        stain: 'H&E',
        dzi: '',
        nativeObjective: undefined,
        nativeMpp: undefined,
        downsample: undefined,
    };
}
