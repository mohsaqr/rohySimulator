import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronRight, Eye, ImageIcon, Layers,
    ImagePlus, LayoutGrid, Link2, LoaderCircle, Microscope, Pencil, Plus, RefreshCw,
    Ruler, Save, Send, Trash2, Upload, UploadCloud, X, Undo2, GitBranch, Archive,
} from 'lucide-react';
import { PathologyRoom } from './PathologyRoom.jsx';
import { NEXT_ACTION_KEYS, NEXT_ACTION_LABELS, filterCatalogAssets, catalogAssetNextActionCode } from './assetCatalog.js';
import { SlideAssetCard } from './SlideAssetCard.jsx';
import {
    addStudioActivity, addStudioBlock, addStudioGrossImage, addStudioRoi, addStudioSlide,
    addStudioSpecimen, ensureActivityRubric, ensureSlideCriteria, ensureStudioGrossTarget,
    removeSlideCriteria, studioTransitions,
    ensureStudioSlideTarget, manualStudioAsset,
    moveStudioGrossImage, removeStudioEntity, removeStudioGrossImage, removeStudioRoi,
    replaceStudioSlideAsset, studioGrossImages, studioIssues, studioPreviewManifest,
    updateActivityRubric, updateSlideCriteria, updateStudioEntity, updateStudioGrossImage,
    TRANSITION_LABEL_KEYS,
    updateStudioMetadata, updateStudioRoi,
} from './caseStudioModel.js';
import { specimenDisplayName } from './specimenNaming.js';
import { plural } from './i18n.js';
import { sha256Bytes } from './caseCore/packageFiles.js';
import { assetDziUrl } from './slideThumbnail.js';
import { SlidePreview } from './SlidePreview.jsx';
import { isRemoteRef, loadableSource, toRemoteRef } from './remoteRef.js';
import { embedImageFile } from './imageEmbed.js';

/**
 * Shared controlled editor. Hosts own persistence, lifecycle, identity, assets.
 *
 * Two ideas drive the layout. First, a case has exactly two kinds of evidence —
 * macroscopic (gross plates hanging off a specimen part) and microscopic (slides
 * hanging off a block hanging off the same part) — so the specimen workspace
 * shows both as sibling cards rather than burying gross photography in a form
 * field. Second, every control a teacher clicks is a full-height target with a
 * word on it: icon-only 24px affordances read as decoration, not as buttons.
 */

const FIELD = 'mt-1.5 w-full rounded-lg bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 ring-1 ring-slate-700 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/60';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-slate-400';
const BTN = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-slate-200 ring-1 ring-slate-700 transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400';
const PRIMARY = `${BTN} bg-fuchsia-500/25 text-fuchsia-50 ring-fuchsia-400/50 hover:bg-fuchsia-500/35`;
const DANGER = `${BTN} text-rose-200 ring-rose-500/30 hover:bg-rose-500/15`;
const ADD = 'flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 px-3 py-2.5 text-[13px] font-semibold text-slate-300 transition-colors hover:border-fuchsia-400/60 hover:bg-fuchsia-500/10 hover:text-fuchsia-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400';
const NOOP_LOGGER = Object.freeze({ log() {} });

/**
 * The manual-DZI form's fields, as a catalogue with its key beside each label.
 *
 * A module-scope table cannot take a `t` prop, so the English is the fallback
 * and the render translates from the stable `key`. Spelled out literally, so
 * every key is visible to an extractor.
 */
const MANUAL_DZI_FIELDS = [
    { key: 'id', labelKey: 'asset_id', label: 'Asset ID' },
    { key: 'label', labelKey: 'label', label: 'Label' },
    { key: 'url', labelKey: 'dzi_url', label: 'DZI URL' },
    { key: 'nativeObjective', labelKey: 'scanned_at', label: 'Scanned at (x)' },
    { key: 'nativeMpp', labelKey: 'microns_per_pixel', label: 'µm per pixel' },
    { key: 'downsample', labelKey: 'archive_downsample', label: 'Archive ÷' },
    { key: 'slideWidthPx', labelKey: 'level0_width', label: 'Level-0 width (px)' },
    { key: 'slideHeightPx', labelKey: 'level0_height', label: 'Level-0 height (px)' },
];

/** The next action for an asset, translated from its stable code. */
const nextActionLabel = (asset, can, t) => {
    const code = catalogAssetNextActionCode(asset, can);
    return code === null ? null : t(NEXT_ACTION_KEYS[code], NEXT_ACTION_LABELS[code]);
};

const firstError = (issues) => issues.find((issue) => issue.severity === 'error');
const numberValue = (text) => {
    const normalized = String(text).trim().replace(',', '.');
    if (normalized === '') return undefined;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : undefined;
};
const named = (value, fallback) => (typeof value === 'string' && value.trim() !== '' ? value : fallback);
// Scanner calibration is stored at full precision and shown at three decimals,
// matching the slide card. 0.22976093523424945 µm/px is a true number and a
// useless label.
const mpp = (value) => (Number.isFinite(value) ? Number(value).toFixed(3) : '—');
// The coded stain value is for exchanging a case with other software; nothing
// here displays it, so it is derived rather than asked for. Same rule the legacy
// migrator uses, so an authored case and a migrated one agree.
const stainCode = (display) => String(display ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 24);

/**
 * The key for each revision status, written out LITERALLY. The status is a
 * stable id on the document; the English beside it is the fallback.
 */
const REVISION_STATUS_KEYS = {
    draft: 'revision_status_draft',
    review: 'revision_status_review',
    published: 'revision_status_published',
    retired: 'revision_status_retired',
};

const TRANSITION_ICONS = {
    saveDraft: Save,
    submitForReview: Send,
    returnToDraft: Undo2,
    publish: UploadCloud,
    fork: GitBranch,
    retire: Archive,
};

export function CaseStudio({
    document, onChange, assetService = null, onSaveDraft, onSubmitReview, onPublish,
    // The rest of the lifecycle. `onReturnToDraft` is the one whose absence
    // stranded the editor: once a revision reached `review`, nothing on screen
    // could move it, and every other button threw.
    onReturnToDraft, onFork, onRetire,
    topBarControls = null, instructorPreview = false, t = (key, fallback) => fallback ?? key,
    // How this host turns a `remote:` reference into something a browser can
    // load. Absent means "no referenced content here" — a plain path or a
    // data: URL still works, and a reference renders as a placeholder that
    // says so rather than as a broken image.
    resolveRef = null,
}) {
    const [selection, setSelection] = useState({ kind: 'overview', id: null, section: null });
    const [activityId, setActivityId] = useState(document?.manifest?.activities?.[0]?.id ?? '');
    const [assetTarget, setAssetTarget] = useState(null);
    const [preview, setPreview] = useState(false);
    const [pendingDelete, setPendingDelete] = useState(null);
    const [action, setAction] = useState({ state: 'idle', message: '' });
    // Every transition is applied to the document as it is at click time, not
    // as it was at render time. Synchronous handlers cannot tell the
    // difference; a handler that awaits a digest can, and closing over a stale
    // document there would silently discard whatever was typed meanwhile.
    const documentRef = useRef(document);
    const photoInputRef = useRef(null);
    const pendingGrossSpecimen = useRef(null);
    useEffect(() => { documentRef.current = document; });
    const issues = useMemo(() => studioIssues(document), [document]);
    const publishIssues = useMemo(() => studioIssues(document, { forPublication: true }), [document]);
    const transitions = useMemo(() => studioTransitions(document), [document]);
    // One place mapping the model's transition ids to this host's callbacks.
    // A transition the host did not wire reports that plainly through
    // lifecycle(), rather than looking available and doing nothing.
    const TRANSITION_HANDLERS = {
        saveDraft: onSaveDraft,
        submitForReview: onSubmitReview,
        returnToDraft: onReturnToDraft,
        publish: onPublish,
        fork: onFork,
        retire: onRetire,
    };
    const malformed = firstError(issues)?.code === 'malformed_document';

    useEffect(() => {
        const ids = document?.manifest?.activities?.map((entry) => entry.id) ?? [];
        if (!ids.includes(activityId)) setActivityId(ids[0] ?? '');
    }, [document, activityId]);

    const emit = useCallback((next, nextSelection) => {
        if (typeof onChange !== 'function') {
            setAction({ state: 'error', message: t('studio_no_onchange', 'This host did not provide an onChange callback.') });
            return;
        }
        onChange(next);
        if (nextSelection) setSelection(nextSelection);
        setPendingDelete(null);
    }, [onChange, t]);

    // Model calls raise rather than returning a half-applied document, so the
    // one place that applies them is also the one place that reports failure.
    const attempt = useCallback((transition, nextSelection) => {
        try {
            emit(transition(documentRef.current), nextSelection);
            setAction({ state: 'idle', message: '' });
            return true;
        } catch (error) {
            setAction({ state: 'error', message: error?.message ?? String(error) });
            return false;
        }
    }, [emit]);

    const lifecycle = useCallback(async (name, callback, blockers = []) => {
        const blocker = firstError(blockers);
        if (blocker) {
            setAction({ state: 'error', message: t('action_blocked', `${name} blocked: ${blocker.message}`, { action: name, reason: blocker.message }) });
            return;
        }
        if (typeof callback !== 'function') {
            setAction({ state: 'error', message: t('action_unavailable', `${name} is unavailable because the host did not provide its callback.`, { action: name }) });
            return;
        }
        setAction({ state: 'busy', message: t('action_busy', `${name}…`, { action: name }) });
        try {
            await callback(document);
            setAction({ state: 'success', message: t('action_completed', `${name} completed.`, { action: name }) });
        } catch (error) {
            setAction({ state: 'error', message: t('action_failed', `${name} failed: ${error?.message ?? error}`, { action: name, reason: error?.message ?? error }) });
        }
    }, [document, t]);

    if (malformed) {
        return <div className="flex h-screen w-screen items-center justify-center bg-slate-950 p-8 text-slate-100"><p role="alert" className="max-w-xl rounded-xl bg-rose-500/10 p-5 text-sm text-rose-200 ring-1 ring-rose-500/30">{firstError(issues).message}</p></div>;
    }

    const { manifest, rubric } = document;
    const entityKey = { specimen: 'specimens', block: 'blocks', slide: 'slides', activity: 'activities' }[selection.kind];
    const entity = entityKey ? manifest[entityKey].find((entry) => entry.id === selection.id) ?? null : null;
    const activeActivityId = manifest.activities.some((entry) => entry.id === activityId)
        ? activityId : manifest.activities[0]?.id ?? '';

    const select = (kind, id, section = null) => setSelection({ kind, id, section });
    const requestDelete = (kind, id) => {
        const key = `${kind}:${id}`;
        if (pendingDelete !== key) { setPendingDelete(key); return; }
        attempt((current) => removeStudioEntity(current, kind, id), { kind: 'metadata', id: null, section: null });
    };
    // "Add a slide" must work on an empty case. The specimen part and block are
    // created for the author rather than demanded before the interesting part.
    // Intent first, structure second.
    //
    // These used to create the specimen part (and block) and THEN open a chooser,
    // so cancelling left an empty part behind forever — and the next real
    // specimen became "B" with a ghost "A" above it. Nothing is created now
    // until the author has actually picked a slide or a photograph.
    const addSlideAnywhere = (specimenId = null) => {
        setAssetTarget({ specimenId: typeof specimenId === 'string' ? specimenId : null, blockId: null, slideId: null });
    };
    /** Files chosen anywhere in the case: read them, THEN grow the lineage. */
    const addPhotographsAnywhere = async (fileList) => {
        const files = Array.from(fileList ?? []);
        if (files.length === 0) return;
        setAction({ state: 'busy', message: files.length === 1
            ? t('reading_file', `Reading ${files[0].name}…`, { name: files[0].name })
            : plural(t, 'reading_photographs', 'Reading {count, plural, one {# photograph} other {# photographs}}…', { count: files.length }) });
        const prepared = [];
        const failures = [];
        await files.reduce(async (previous, file) => {
            await previous;
            try { prepared.push(await preparePhotograph(file)); }
            catch (error) { failures.push(error?.message ?? String(error)); }
        }, Promise.resolve());
        if (prepared.length === 0) {
            setAction({ state: 'error', message: failures.join(' ') || t('no_photograph_read', 'No photograph could be read.') });
            return;
        }
        let landedOn = null;
        const ok = attempt((current) => {
            const target = ensureStudioGrossTarget(current, { specimenId: pendingGrossSpecimen.current });
            landedOn = target.specimenId;
            return prepared.reduce(
                (next, photo) => addStudioGrossImage(next, target.specimenId, photo),
                target.document,
            );
        });
        // Only go to the part when there is more than one; with a single part the
        // gross card the author is already looking at is the destination.
        if (ok && landedOn && documentRef.current.manifest.specimens.length > 1) {
            setSelection({ kind: 'specimen', id: landedOn, section: 'gross' });
        }
        if (failures.length > 0) setAction({ state: 'error', message: failures.join(' ') });
    };
    const openPreview = () => {
        const blocker = firstError(issues);
        if (blocker || manifest.slides.length === 0) {
            setAction({ state: 'error', message: blocker
                ? t('preview_blocked', `Preview blocked: ${blocker.message}`, { reason: blocker.message })
                : t('preview_blocked_no_slide', 'Preview blocked: add a slide first.') });
        } else setPreview(true);
    };

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 text-slate-100" role="application" aria-label={t('case_studio_app', 'Pathology Case Studio')}>
            <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-800/80 bg-slate-950/85 px-4 py-3">
                {topBarControls}
                <div className="min-w-0">
                    <h1 className="truncate text-base font-semibold">{named(manifest.title, t('case_studio', 'Case Studio'))}</h1>
                    <p className="text-[11px] text-slate-500">{t('revision_n', `Revision ${manifest.revision.number}`, { number: manifest.revision.number })} · {t(REVISION_STATUS_KEYS[manifest.revision.status] ?? manifest.revision.status, manifest.revision.status)}</p>
                </div>
                <IssueBadge issues={publishIssues} t={t} />
                {/* Only the transitions this revision actually permits.
                    Offering all four regardless of status was not offering
                    choices — it was offering four ways to meet a
                    LifecycleError, and after "Submit review" there was no way
                    back at all. The permitted set comes from the model, so the
                    header cannot offer something the model would refuse. */}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <ActionButton icon={Eye} label={instructorPreview ? t('instructor_preview', 'Instructor preview') : t('learner_preview', 'Learner preview')} onClick={openPreview} />
                    {transitions.map((transition) => (
                        <ActionButton
                            key={transition.id}
                            icon={TRANSITION_ICONS[transition.id] ?? Save}
                            label={t(TRANSITION_LABEL_KEYS[transition.id] ?? transition.id, transition.label)}
                            t={t}
                            primary={transition.primary}
                            disabled={Boolean(transition.blockedBy)}
                            title={transition.blockedBy?.message}
                            onClick={() => lifecycle(
                                t(TRANSITION_LABEL_KEYS[transition.id] ?? transition.id, transition.label),
                                TRANSITION_HANDLERS[transition.id],
                                transition.blockedBy ? [transition.blockedBy] : [],
                            )}
                        />
                    ))}
                </div>
            </header>
            {action.message && <p role={action.state === 'error' ? 'alert' : 'status'} aria-live="polite" className={`shrink-0 px-4 py-2 text-xs ${action.state === 'error' ? 'bg-rose-500/15 text-rose-200' : action.state === 'success' ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-900 text-slate-300'}`}>{action.state === 'busy' && <LoaderCircle className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{action.message}</p>}
            <div className="flex min-h-0 flex-1 overflow-hidden">
                <Outline
                    t={t}
                    manifest={manifest} selection={selection} onSelect={select}
                    pendingDelete={pendingDelete} onDelete={requestDelete}
                    onAddSpecimen={() => attempt((current) => {
                        const next = addStudioSpecimen(current);
                        setSelection({ kind: 'specimen', id: next.manifest.specimens.at(-1).id, section: null });
                        return next;
                    })}
                    onAddActivity={() => attempt((current) => {
                        const next = addStudioActivity(current);
                        const id = next.manifest.activities.at(-1).id;
                        setActivityId(id);
                        setSelection({ kind: 'activity', id, section: null });
                        return next;
                    })}
                />
                <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6 lg:px-10 lg:py-8">
                    {selection.kind === 'overview' && (
                        <Overview
                    t={t}
                    resolveRef={resolveRef}
                            document={document} onSelect={select}
                            onAddSlide={addSlideAnywhere}
                            onApply={(transition) => attempt(transition)}
                            onNotice={(message) => setAction({ state: 'notice', message })}
                            onPatchSpecimen={(id, patch) => attempt((current) => updateStudioEntity(current, 'specimen', id, patch))}
                            onAddSpecimen={() => attempt((current) => {
                                const next = addStudioSpecimen(current);
                                setSelection({ kind: 'specimen', id: next.manifest.specimens.at(-1).id, section: null });
                                return next;
                            })}
                            onDelete={requestDelete} pendingDelete={pendingDelete}
                        />
                    )}
                    {selection.kind === 'metadata' && <Metadata t={t} manifest={manifest} onPatch={(patch) => attempt((current) => updateStudioMetadata(current, patch))} />}
                    {selection.kind === 'specimen' && entity && (
                        <SpecimenWorkspace
                    t={t}
                    resolveRef={resolveRef}
                            document={document} specimen={entity} section={selection.section}
                            pendingDelete={pendingDelete} onDelete={requestDelete} onSelect={select}
                            onNotice={(message) => setAction({ state: 'notice', message })}
                            onPatch={(patch) => attempt((current) => updateStudioEntity(current, 'specimen', entity.id, patch))}
                            onApply={(transition) => attempt(transition)}
                            onAddSlide={(blockId) => (blockId
                                ? setAssetTarget({ blockId, slideId: null })
                                : addSlideAnywhere(entity.id))}
                        />
                    )}
                    {selection.kind === 'block' && entity && <Block t={t} document={document} block={entity} onSelect={select} onPatch={(patch) => attempt((current) => updateStudioEntity(current, 'block', entity.id, patch))} onAddSlide={() => setAssetTarget({ blockId: entity.id, slideId: null })} />}
                    {selection.kind === 'activity' && entity && <Activity t={t} activity={entity} protectedActivity={rubric.activities.find((entry) => entry.activityId === entity.id)} onPatch={(patch) => attempt((current) => updateStudioEntity(current, 'activity', entity.id, patch))} onEnsure={() => attempt((current) => ensureActivityRubric(current, entity.id))} onRubric={(patch) => attempt((current) => updateActivityRubric(current, entity.id, patch))} />}
                    {selection.kind === 'slide' && entity && <Slide t={t} document={document} slide={entity} activityId={activeActivityId} onActivityId={setActivityId} onSelect={select} onPatch={(patch) => attempt((current) => updateStudioEntity(current, 'slide', entity.id, patch))} onChooseAsset={() => setAssetTarget({ blockId: entity.blockId, slideId: entity.id })} onApply={(transition) => attempt(transition)} />}
                </main>
                {publishIssues.length > 0 && <Checks issues={publishIssues} t={t} />}
            </div>
            <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                aria-label={t('choose_gross_for_case', 'Choose gross photographs for this case')}
                onChange={(event) => { addPhotographsAnywhere(event.target.files); event.target.value = ''; }}
            />
            {assetTarget && <AssetPicker t={t} assetService={assetService} actionLabel={assetTarget.slideId ? t('replace_slide', 'Replace slide') : t('add_slide', 'Add slide')} onClose={() => setAssetTarget(null)} onSelect={(asset) => {
                if (assetTarget.slideId) attempt((current) => replaceStudioSlideAsset(current, assetTarget.slideId, asset));
                else {
                    attempt((current) => {
                        // The block is grown here, at the moment the slide
                        // exists — never before it.
                        const target = assetTarget.blockId
                            ? { document: current, blockId: assetTarget.blockId }
                            : ensureStudioSlideTarget(current, { specimenId: assetTarget.specimenId });
                        // Stay put. You just added a slide to your case; being
                        // thrown into a form about it loses the case you were
                        // building.
                        return addStudioSlide(target.document, target.blockId, asset);
                    });
                }
                setAssetTarget(null);
            }} />}
            {preview && <Preview t={t} document={document} activityId={activeActivityId} includeProtected={instructorPreview} onClose={() => setPreview(false)} resolveRef={resolveRef} />}
        </div>
    );
}

function ActionButton({ icon: Icon, label, primary, onClick, disabled = false, title = null, t = (key, fallback) => fallback ?? key }) {
    return (
        <button
            type="button"
            className={`${primary ? PRIMARY : BTN} ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
            onClick={onClick}
            disabled={disabled}
            title={title ?? undefined}
            // The reason goes in the accessible name, not only the tooltip: a
            // greyed button with a hover-only explanation tells a keyboard or
            // screen-reader user nothing about why it will not work.
            aria-label={disabled && title ? t('unavailable_because', `${label} — unavailable: ${title}`, { action: label, reason: title }) : undefined}
        >
            <Icon className="h-4 w-4" aria-hidden="true" />{label}
        </button>
    );
}
function IssueBadge({ issues, t }) {
    const errors = issues.filter((issue) => issue.severity === 'error').length;
    return (
        <span className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 ${errors ? 'bg-rose-500/15 text-rose-200 ring-rose-500/30' : 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30'}`}>
            {errors
                ? plural(t, 'issue_errors', '{count, plural, one {# error} other {# errors}}', { count: errors })
                : t('ready', 'Ready')}
        </span>
    );
}

/** Two-step delete: the first click arms, the second removes. */
function DeleteButton({ label, pending, onClick, compact = false, t = (key, fallback) => fallback ?? key }) {
    if (compact) {
        return (
            <button
                type="button"
                aria-label={pending
                    ? t('confirm_delete_named', `Confirm delete ${label}`, { name: label })
                    : t('delete_named', `Delete ${label}`, { name: label })}
                onClick={onClick}
                className={`inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition-colors ${pending ? 'bg-rose-500/25 text-rose-100 ring-1 ring-rose-400/50' : 'text-slate-500 hover:bg-rose-500/15 hover:text-rose-200'}`}
            >
                {pending ? t('confirm', 'Confirm') : <Trash2 className="h-4 w-4" aria-hidden="true" />}
            </button>
        );
    }
    return (
        <button type="button" className={DANGER} onClick={onClick}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />{pending ? t('confirm_delete_long', `Confirm — delete ${label}`, { name: label }) : t('delete', 'Delete')}
        </button>
    );
}

// --- Outline ---------------------------------------------------------------

function Outline({ manifest, selection, onSelect, onAddSpecimen, onAddActivity, onDelete, pendingDelete, t }) {
    const active = (kind, id) => selection.kind === kind && selection.id === id;
    const row = (label, current, onClick, icon) => (
        <button
            type="button"
            aria-current={current}
            onClick={onClick}
            className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold ring-1 transition-colors ${current ? 'bg-fuchsia-500/15 text-fuchsia-100 ring-fuchsia-500/40' : 'text-slate-300 ring-slate-800 hover:bg-slate-800/60'}`}
        >
            {icon}{label}
        </button>
    );
    return (
        <nav aria-label={t('case_outline', 'Case outline')} className="w-64 shrink-0 space-y-4 overflow-y-auto border-r border-slate-800/80 bg-slate-950/45 p-3 max-xl:w-56">
            <div className="space-y-2">
                {row(t('case_overview', 'Case overview'), selection.kind === 'overview', () => onSelect('overview', null), <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" />)}
                {row(t('clinical_metadata', 'Clinical metadata'), selection.kind === 'metadata', () => onSelect('metadata', null), <Layers className="h-4 w-4 shrink-0" aria-hidden="true" />)}
            </div>

            {/* The rail navigates; it no longer holds the case structure. Blocks
                and slides live in the main area, where there is room for them. */}
            {/* One part is not a choice, so it is not shown. A case has gross
                photographs and slides; the part only becomes something an
                author manages once they deliberately add a second. */}
            {manifest.specimens.length > 1 && (
            <section className="space-y-2">
                <SectionHeading label={t('specimen_parts', 'Specimen parts')} count={manifest.specimens.length} />
                {manifest.specimens.map((specimen) => {
                    const blocks = manifest.blocks.filter((block) => block.specimenId === specimen.id);
                    const slideCount = manifest.slides.filter((slide) => blocks.some((block) => block.id === slide.blockId)).length;
                    return (
                        <div key={specimen.id} className={`flex items-center gap-1 rounded-xl p-1.5 ring-1 transition-colors ${active('specimen', specimen.id) ? 'bg-slate-900/70 ring-fuchsia-500/40' : 'bg-slate-950/40 ring-slate-800'}`}>
                            <button
                                type="button"
                                aria-current={active('specimen', specimen.id)}
                                onClick={() => onSelect('specimen', specimen.id)}
                                className="min-h-10 min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-800/50"
                            >
                                <span className="block truncate text-[13px] font-semibold text-slate-100">{specimenDisplayName(specimen)}</span>
                                <span className="block truncate text-[11px] tabular-nums text-slate-500">
                                    {plural(t, 'gross_and_slide_counts', '{gross, plural, other {# gross}} · {slides, plural, one {# slide} other {# slides}}', { gross: specimen.grossImageAssetIds.length, slides: slideCount })}
                                </span>
                            </button>
                            <DeleteButton t={t} compact label={named(specimen.label, t('this_part', 'this part'))} pending={pendingDelete === `specimen:${specimen.id}`} onClick={() => onDelete('specimen', specimen.id)} />
                        </div>
                    );
                })}
                <button type="button" onClick={onAddSpecimen} className={ADD}><Plus className="h-4 w-4" aria-hidden="true" />{t('add_specimen_part', 'Add specimen part')}</button>
            </section>
            )}

            <section className="space-y-2">
                <SectionHeading label={t('learner_activities', 'Learner activities')} count={manifest.activities.length} />
                {manifest.activities.map((activity) => (
                    <div key={activity.id} className={`flex items-center gap-1 rounded-xl p-1.5 ring-1 ${active('activity', activity.id) ? 'bg-slate-900/70 ring-fuchsia-500/40' : 'bg-slate-950/40 ring-slate-800'}`}>
                        <button
                            type="button"
                            aria-current={active('activity', activity.id)}
                            onClick={() => onSelect('activity', activity.id)}
                            className="min-h-10 min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] text-slate-300 hover:bg-slate-800/60"
                        >
                            {named(activity.prompt, named(activity.kind, t('untitled_activity', 'Untitled activity')))}
                        </button>
                        <DeleteButton t={t} compact label={t('this_activity', 'this activity')} pending={pendingDelete === `activity:${activity.id}`} onClick={() => onDelete('activity', activity.id)} />
                    </div>
                ))}
                {manifest.activities.length === 0 && <Empty>{t('no_activity_yet', 'No learner activity yet.')}</Empty>}
                <button type="button" onClick={onAddActivity} className={ADD}><Plus className="h-4 w-4" aria-hidden="true" />{t('add_activity', 'Add activity')}</button>
            </section>
        </nav>
    );
}

/**
 * The Slides card's one-line description.
 *
 * Two separate calls with LITERAL keys rather than one call with a key chosen
 * by a ternary: `t(variable)` is invisible to a key extractor, and a message
 * that never appears in the source is a message nobody translates.
 *
 * @param {{t:Function, slides:number, blocks:number}} p
 * @returns {string}
 */
function slidesDescription({ t, slides, blocks }) {
    if (slides === 0) return t('slides_card_empty', 'Whole-slide scans the learner reads under the microscope.');
    if (blocks > 1) {
        return plural(
            t,
            'slides_across_blocks',
            '{slides, plural, one {# slide} other {# slides}} across {blocks, plural, other {# blocks}}.',
            { slides, blocks },
        );
    }
    return plural(t, 'slides_count', '{slides, plural, one {# slide} other {# slides}}.', { slides });
}

/**
 * The landing surface, and the answer to "where are the slides".
 *
 * Both kinds of evidence get a full-width entry point that works on an empty
 * case: neither one asks the author to invent a specimen part and a paraffin
 * block first. The lineage is still created — it is just created for them.
 */
function Overview({ document, onSelect, onAddSlide, onAddSpecimen, onApply, onNotice, onPatchSpecimen, onDelete, pendingDelete, resolveRef = null, t }) {
    const { manifest } = document;
    const plates = manifest.specimens.flatMap((specimen) => studioGrossImages(document, specimen.id)
        .map((image) => ({ ...image, specimen })));
    const blockCount = manifest.blocks.length;
    const single = manifest.specimens.length === 1;

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            {/* One place per action. A summary tile above a section that does the
                same thing is two of everything to read and two to click. */}
            <Card
                title={t('slides', 'Slides')}
                icon={Microscope}
                accent="sky"
                description={slidesDescription({ t, slides: manifest.slides.length, blocks: blockCount })}
                actions={<button type="button" className={PRIMARY} onClick={() => onAddSlide()}><Plus className="h-4 w-4" aria-hidden="true" />{t('add_slide', 'Add slide')}</button>}
            >
                {manifest.slides.length === 0
                    ? <Empty>{t('no_slide_yet', 'No slide yet. Choose one from the slide library.')}</Empty>
                    : (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {manifest.slides.map((slide) => {
                                const block = manifest.blocks.find((entry) => entry.id === slide.blockId);
                                const specimen = manifest.specimens.find((entry) => entry.id === block?.specimenId);
                                const asset = manifest.assets.find((entry) => entry.id === slide.assetId);
                                return (
                                    <article key={slide.id} className="overflow-hidden rounded-2xl bg-slate-900/60 ring-1 ring-slate-800 transition-shadow hover:ring-fuchsia-500/40">
                                        <button type="button" onClick={() => onSelect('slide', slide.id)} className="block w-full text-left hover:opacity-90">
                                            <SlidePreview t={t} dziUrl={assetDziUrl(asset)} alt={t('slide_overview_alt', `Whole-slide overview of ${named(slide.label, t('this_slide', 'this slide'))}`, { name: named(slide.label, t('this_slide', 'this slide')) })} className="h-36" />
                                        </button>
                                        <div className="flex items-center gap-1 p-2">
                                            <button type="button" onClick={() => onSelect('slide', slide.id)} className="min-h-14 min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-800/60">
                                                <span className="block truncate text-sm font-semibold text-slate-100">{named(slide.label, t('untitled_slide', 'Untitled slide'))}</span>
                                                <span className="mt-0.5 block truncate text-xs text-slate-400">{named(slide.stain.display, t('no_stain', 'no stain'))}</span>
                                                <span className="mt-1 block truncate text-[11px] tabular-nums text-slate-500">
                                                    {single ? '' : `${specimen ? specimenDisplayName(specimen) : t('no_part', 'no part')} · ${named(block?.label, t('no_block', 'no block'))} · `}
                                                    {asset?.metadata?.nativeObjective ? `${asset.metadata.nativeObjective}x` : t('no_calibration', 'no calibration')}
                                                    {asset?.metadata?.nativeMpp ? ` · ${mpp(asset.metadata.nativeMpp)} µm/px` : ''}
                                                </span>
                                            </button>
                                            <DeleteButton t={t} compact label={named(slide.label, t('this_slide', 'this slide'))} pending={pendingDelete === `slide:${slide.id}`} onClick={() => onDelete('slide', slide.id)} />
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
            </Card>

            {/* With one part there is nothing to navigate to: the gross card is
                the case's gross section, edited right here. */}
            {single
                ? (
                    <GrossCard
                    t={t}
                    resolveRef={resolveRef}
                        document={document}
                        specimen={manifest.specimens[0]}
                        onApply={onApply}
                        onNotice={onNotice}
                        onPatch={(patch) => onPatchSpecimen(manifest.specimens[0].id, patch)}
                    />
                )
                : (
                    <section aria-label={t('gross_photographs', 'Gross photographs')}>
                        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{t('gross_photographs', 'Gross photographs')} ({plates.length})</h2>
                        {plates.length === 0
                            ? <Empty>{t('gross_empty_multipart', 'No gross photograph yet. Add photograph attaches one to a specimen part.')}</Empty>
                            : (
                                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
                                    {plates.map((plate) => (
                                        <button
                                            key={plate.id}
                                            type="button"
                                            onClick={() => onSelect('specimen', plate.specimen.id, 'gross')}
                                            className="overflow-hidden rounded-xl bg-slate-900/60 text-left ring-1 ring-slate-800 hover:ring-fuchsia-500/40"
                                        >
                                            <img src={plate.uri} referrerPolicy="no-referrer" alt="" className="h-36 w-full bg-slate-950 object-cover" />
                                            <span className="block truncate px-3 py-2 text-xs font-semibold text-slate-200">{specimenDisplayName(plate.specimen)}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                    </section>
                )}

            {single && (
                <p className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-800 p-4 text-xs text-slate-500">
                    {t('one_specimen_note', 'This case is one specimen. Add a second part only if the accession really had one — a lymph node alongside a resection, say.')}
                    <button type="button" className={`${BTN} ml-auto`} onClick={onAddSpecimen}>
                        <Plus className="h-4 w-4" aria-hidden="true" />{t('add_specimen_part', 'Add specimen part')}
                    </button>
                </p>
            )}
        </div>
    );
}

function SectionHeading({ label, count }) {
    return <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label} ({count})</h2>;
}
function Empty({ children }) { return <p className="rounded-xl border border-dashed border-slate-800 p-3 text-xs leading-relaxed text-slate-500">{children}</p>; }

// --- Shared panel furniture -------------------------------------------------

function Card({ title, description, icon: Icon, accent = 'slate', actions = null, highlighted = false, children }) {
    const tint = {
        slate: 'text-slate-300',
        amber: 'text-amber-300',
        sky: 'text-sky-300',
    }[accent];
    return (
        <section className={`rounded-2xl bg-slate-900/55 p-5 ring-1 transition-shadow ${highlighted ? 'ring-2 ring-fuchsia-400/60' : 'ring-slate-800'}`}>
            <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
                        {Icon && <Icon className={`h-5 w-5 shrink-0 ${tint}`} aria-hidden="true" />}{title}
                    </h2>
                    {description && <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
            {children && <div className="mt-4">{children}</div>}
        </section>
    );
}
function Fields({ children }) { return <div className="grid gap-4 sm:grid-cols-2">{children}</div>; }

/**
 * A hint is described-by, never part of the label. Nesting it inside <label>
 * would append the whole sentence to the field's accessible name, so a screen
 * reader — and every by-label query — would see "Part The letter or number on
 * the accession, e.g. A." instead of "Part".
 */
function Hint({ id, children }) {
    return <p id={id} className="mt-1 text-[11px] font-normal normal-case tracking-normal text-slate-500">{children}</p>;
}
function TextField({ label, value, onChange, multiline = false, hint = '', className = '' }) {
    const Input = multiline ? 'textarea' : 'input';
    const hintId = `${useId()}-hint`;
    return (
        <div className={className}>
            <label className={LABEL}>
                {label}
                <Input type={multiline ? undefined : 'text'} rows={multiline ? 4 : undefined} value={value ?? ''} onChange={(event) => onChange(event.target.value)} aria-describedby={hint ? hintId : undefined} className={FIELD} />
            </label>
            {hint && <Hint id={hintId}>{hint}</Hint>}
        </div>
    );
}
function NumericField({ label, value, onChange, hint = '', className = '' }) {
    const hintId = `${useId()}-hint`;
    return (
        <div className={className}>
            <label className={LABEL}>
                {label}
                <input type="text" inputMode="decimal" value={value ?? ''} onChange={(event) => onChange(numberValue(event.target.value))} aria-describedby={hint ? hintId : undefined} className={FIELD} />
            </label>
            {hint && <Hint id={hintId}>{hint}</Hint>}
        </div>
    );
}
function Breadcrumb({ trail, t = (key, fallback) => fallback ?? key }) {
    return (
        <nav aria-label={t('breadcrumb', 'Breadcrumb')} className="mb-4 flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {trail.map((step, index) => (
                <span key={`${step.label}-${index}`} className="flex items-center gap-1">
                    {index > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                    {step.onClick
                        ? <button type="button" onClick={step.onClick} className="rounded px-1.5 py-1 font-semibold text-slate-300 hover:bg-slate-800 hover:text-fuchsia-100">{step.label}</button>
                        : <span className="px-1.5 py-1 font-semibold text-slate-200">{step.label}</span>}
                </span>
            ))}
        </nav>
    );
}

// --- Panels -----------------------------------------------------------------

function Metadata({ manifest, onPatch, t }) {
    return (
        <div className="mx-auto max-w-6xl">
            <Card title={t('clinical_metadata', 'Clinical metadata')} icon={Layers} description={t('clinical_metadata_note', 'Public context every learner sees. Protected answers and hints live in the activity rubric.')}>
                <Fields>
                    <TextField label={t('case_title', 'Case title')} value={manifest.title} onChange={(title) => onPatch({ title })} className="sm:col-span-2" />
                    <TextField label={t('accession', 'Accession')} value={manifest.clinical.accession} onChange={(accession) => onPatch({ accession })} />
                    <TextField label={t('specimen_summary', 'Specimen summary')} value={manifest.clinical.specimenSummary} onChange={(specimenSummary) => onPatch({ specimenSummary })} />
                    <TextField label={t('clinical_history', 'Clinical history')} value={manifest.clinical.history} onChange={(history) => onPatch({ history })} multiline className="sm:col-span-2" />
                </Fields>
            </Card>
        </div>
    );
}

/**
 * One specimen part, shown as its three real concerns: what was received, what
 * it looked like to the naked eye, and what was cut from it.
 */
function SpecimenWorkspace({ document, specimen, section, onPatch, onApply, onNotice, onSelect, onAddSlide, onDelete, pendingDelete, resolveRef = null, t }) {
    const grossRef = useRef(null);
    const histoRef = useRef(null);
    useEffect(() => {
        const gross = section === 'gross' || section === 'gross-add';
        const target = gross ? grossRef.current : section === 'histology' ? histoRef.current : null;
        target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, [section, specimen.id]);

    const blocks = document.manifest.blocks.filter((block) => block.specimenId === specimen.id);
    return (
        <div className="mx-auto max-w-6xl space-y-5">
            {/* Identity only, and inline. Naming the part is not a task to
                complete before the evidence can be added — it is a caption. */}
            <section className="flex flex-wrap items-end gap-3 rounded-2xl bg-slate-900/40 p-4 ring-1 ring-slate-800">
                <Layers className="mb-2.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="w-20 shrink-0">
                    <TextField label={t('part', 'Part')} value={specimen.part} onChange={(part) => onPatch({ part })} />
                </div>
                <div className="min-w-56 flex-1">
                    <TextField label={t('label', 'Label')} value={specimen.label} onChange={(label) => onPatch({ label })} />
                </div>
                <DeleteButton t={t} label={named(specimen.label, t('this_part', 'this part'))} pending={pendingDelete === `specimen:${specimen.id}`} onClick={() => onDelete('specimen', specimen.id)} />
            </section>

            <div ref={grossRef}>
                <GrossCard
                    t={t}
                    resolveRef={resolveRef}
                    document={document} specimen={specimen} onApply={onApply} onNotice={onNotice} onPatch={onPatch}
                    highlighted={section === 'gross' || section === 'gross-add'}
                    autoOpen={section === 'gross-add'}
                />
            </div>

            <div ref={histoRef}>
                <HistologyCard
                    t={t}
                    document={document} specimen={specimen} blocks={blocks} highlighted={section === 'histology'}
                    onApply={onApply} onSelect={onSelect} onAddSlide={onAddSlide}
                    onDelete={onDelete} pendingDelete={pendingDelete}
                />
            </div>
        </div>
    );
}

/**
 * Read the bytes a URL actually serves and return the digest a published case
 * can be pinned to. It doubles as proof the URL resolves — a plate that cannot
 * be fetched is one the learner would not see either.
 */
// A RangeError message, not UI copy: it is raised from a plain async helper
// with no `t` in scope, and every place it surfaces routes it through the
// notice channel where it is shown as the reason a pin failed.
const pinLimitMessage = (maxBytes) => `Photograph exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB pinning limit.`;

async function pinOf(uri) {
    const maxBytes = 32 * 1024 * 1024;
    const response = await fetch(uri, {
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText || 'request failed'}`);
    const declared = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new RangeError(pinLimitMessage(maxBytes));
    }
    const chunks = [];
    let total = 0;
    if (response.body?.getReader) {
        const reader = response.body.getReader();
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new RangeError(pinLimitMessage(maxBytes));
            }
            chunks.push(value);
        }
    } else {
        const value = new Uint8Array(await response.arrayBuffer());
        total = value.byteLength;
        if (total > maxBytes) throw new RangeError(pinLimitMessage(maxBytes));
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
    return `sha256:${await sha256Bytes(bytes)}`;
}

/** Embed and pin one picked file. Pinning may fail; the picture still counts. */
async function preparePhotograph(file) {
    const embedded = await embedImageFile(file);
    try { return { uri: embedded.uri, checksum: await pinOf(embedded.uri) }; }
    catch { return { uri: embedded.uri, checksum: null }; }
}

/**
 * Gross pathology.
 *
 * A plate is an ordinary photograph, so the only calibration it can honestly
 * carry is the real-world width it spans. That single number is what the room
 * turns into a scale bar that stays true at any zoom; leaving it blank shows
 * the photograph without a scale bar rather than inventing one.
 *
 * The digest is taken while the author is still filling the form rather than on
 * submit, so the pin is visible before the plate is added and the transition
 * itself stays synchronous.
 */
/**
 * One gross plate's picture.
 *
 * A `remote:` reference is a NAME, not a URL. Handing it to an <img> produces a
 * broken-image icon and a console error the author cannot act on, so when this
 * host cannot resolve references the plate says what it is instead. The author
 * still sees the plate, its width field and its order controls — the reference
 * is authored correctly here and resolves wherever it is served.
 */
function GrossPlateImage({ uri, resolveRef, alt, t }) {
    const src = loadableSource(uri, resolveRef);
    if (src === '') {
        return (
            <div className="flex h-40 w-full flex-col items-center justify-center gap-1 bg-slate-900 px-3 text-center">
                <Link2 className="h-6 w-6 text-slate-600" aria-hidden="true" />
                <p className="text-xs font-medium text-slate-400">{t('referenced_photograph', 'Referenced photograph')}</p>
                <p className="text-[11px] text-slate-500">{t('referenced_photograph_note', 'Not previewable here. It loads wherever this case is served.')}</p>
            </div>
        );
    }
    return <img src={src} referrerPolicy="no-referrer" alt={alt} className="h-40 w-full bg-slate-900 object-cover" />;
}

function GrossCard({ document, specimen, onApply, onNotice, onPatch, highlighted, autoOpen = false, resolveRef = null, t }) {
    const solo = document.manifest.specimens.length === 1;
    const [linking, setLinking] = useState(false);
    const [linkUrl, setLinkUrl] = useState('');
    const [busy, setBusy] = useState('');
    const [dragging, setDragging] = useState(false);
    const [pinning, setPinning] = useState('');
    const fileRef = useRef(null);
    const images = studioGrossImages(document, specimen.id);

    // Arriving via "Add photograph" should open the file chooser, not park the
    // author in front of another button.
    useEffect(() => { if (autoOpen) fileRef.current?.click(); }, [autoOpen, specimen.id]);

    /** Add one already-resolved picture, pinning it by its own bytes. */
    const attach = async (uri, label) => {
        let checksum = null;
        // Pinned by the bytes a reader will actually receive, so the resolver
        // has to run first: `remote:gross/a.jpg` is a name, not something
        // fetch() can open.
        const loadable = loadableSource(uri, resolveRef);
        try { checksum = loadable === '' ? null : await pinOf(loadable); } catch { checksum = null; }
        const added = onApply((current) => addStudioGrossImage(current, specimen.id, { uri, checksum }));
        if (!added) return false;
        if (checksum === null) onNotice(t('added_unpinned', `Added ${label}, but it could not be pinned. Publication needs a pinned photograph — use "Pin now" once it is reachable.`, { name: label }));
        return true;
    };

    const addFiles = async (fileList) => {
        const files = Array.from(fileList ?? []);
        if (files.length === 0) return;
        setBusy(files.length === 1
            ? t('reading_file', `Reading ${files[0].name}…`, { name: files[0].name })
            : plural(t, 'reading_photographs', 'Reading {count, plural, one {# photograph} other {# photographs}}…', { count: files.length }));
        // Sequential on purpose: each add is applied to the document the
        // previous one produced, so a multi-file drop keeps every picture.
        const failures = await files.reduce(async (previous, file) => {
            const sofar = await previous;
            try {
                const embedded = await embedImageFile(file);
                await attach(embedded.uri, file.name);
                return sofar;
            } catch (error) {
                return [...sofar, error?.message ?? String(error)];
            }
        }, Promise.resolve([]));
        setBusy('');
        if (failures.length > 0) onNotice(failures.join(' '));
    };

    /**
     * Add a photograph the case POINTS AT rather than carries.
     *
     * A bare path becomes a `remote:` reference; a complete http(s) URL is kept
     * as written, because that is a real address and turning it into a
     * reference would silently change which machine serves it.
     */
    const addLink = async () => {
        const typed = linkUrl.trim();
        if (typed === '') return;
        let uri;
        try {
            uri = /^https?:\/\//i.test(typed) || typed.startsWith('data:') ? typed : toRemoteRef(typed);
        } catch (error) {
            onNotice(error?.message ?? String(error));
            return;
        }
        setBusy(t('adding_photograph', 'Adding the photograph…'));
        const ok = await attach(uri, uri);
        setBusy('');
        if (ok) { setLinkUrl(''); setLinking(false); }
    };

    const pinPlate = async (image) => {
        setPinning(image.id);
        try {
            const source = loadableSource(image.uri, resolveRef);
            if (source === '') throw new Error(t('cannot_resolve_reference', 'This host cannot resolve referenced content, so the photograph cannot be fetched to pin it.'));
            const checksum = await pinOf(source);
            onApply((current) => updateStudioGrossImage(current, specimen.id, image.id, { checksum }));
        } catch (error) {
            onNotice(t('pin_failed', `Could not pin this photograph: ${error?.message ?? error}`, { reason: error?.message ?? error }));
        } finally {
            setPinning('');
        }
    };

    return (
        <Card
            title={t('gross_pathology', 'Gross pathology')}
            icon={ImageIcon}
            accent="amber"
            highlighted={highlighted}
            description={solo
                ? t('gross_card_note', 'Macroscopic photographs, shown to the learner as a contact sheet in the order below.')
                : t('gross_card_note_part', 'Macroscopic photographs of this part, shown to the learner as a contact sheet in the order below.')}
            actions={(
                <button type="button" className={PRIMARY} onClick={() => fileRef.current?.click()}>
                    <ImagePlus className="h-4 w-4" aria-hidden="true" />{t('add_photographs', 'Add photographs')}
                </button>
            )}
        >
            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                aria-label={t('choose_gross', 'Choose gross photographs')}
                onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }}
            />

            {/* Choosing the file IS adding the photograph. Everything optional
                about a plate — its width in millimetres, its order — is set on
                the plate afterwards, not demanded before the picture exists. */}
            <div
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer?.files); }}
                className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-amber-400/70 bg-amber-400/10' : 'border-slate-700 bg-slate-950/40'}`}
            >
                {busy
                    ? <p className="flex items-center justify-center gap-2 text-sm text-slate-300"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />{busy}</p>
                    : (
                        <>
                            <Upload className="mx-auto h-7 w-7 text-slate-600" aria-hidden="true" />
                            <p className="mt-2 text-sm text-slate-300">{t('drop_photographs', 'Drop photographs here')}</p>
                            <p className="mt-1 text-xs text-slate-500">{t('drop_photographs_note', 'JPEG, PNG, HEIC or WebP, straight from your camera or phone. Large photographs are resized to fit inside the case.')}</p>
                            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                                <button type="button" className={PRIMARY} onClick={() => fileRef.current?.click()}>
                                    <ImagePlus className="h-4 w-4" aria-hidden="true" />{t('choose_photographs', 'Choose photographs')}
                                </button>
                                <button type="button" className={BTN} onClick={() => setLinking((open) => !open)} aria-expanded={linking}>
                                    <Link2 className="h-4 w-4" aria-hidden="true" />{t('reference_instead', 'Reference one instead')}
                                </button>
                            </div>
                        </>
                    )}
                {linking && (
                    <div className="mx-auto mt-4 flex max-w-xl flex-wrap items-end gap-2 text-left">
                        <div className="min-w-56 flex-1">
                            <TextField
                                label={t('path_or_address', 'Path or web address')}
                                value={linkUrl}
                                onChange={setLinkUrl}
                                hint={t('path_or_address_hint', 'A path such as gross/case42/a-fresh.jpg names a photograph kept with your slides — the case points at it and stays small. A full https:// address is used as written.')}
                            />
                        </div>
                        <button type="button" className={PRIMARY} onClick={addLink}><Plus className="h-4 w-4" aria-hidden="true" />{t('add', 'Add')}</button>
                    </div>
                )}
            </div>

            {images.length === 0 && (
                <p className="mt-3 text-xs text-slate-500">
                    {solo
                        ? t('gross_empty_solo', 'No gross photograph yet. The learner opens the Gross tab and finds it empty.')
                        : t('gross_empty_part', 'No gross photograph yet. The learner opens the Gross tab and finds this part empty.')}
                </p>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {images.map((image, index) => (
                    <figure key={image.id} className="overflow-hidden rounded-xl bg-slate-950/60 ring-1 ring-slate-800">
                        <GrossPlateImage
                            t={t}
                            uri={image.uri}
                            resolveRef={resolveRef}
                            alt={t('gross_plate_alt', `Gross plate ${index + 1} of ${named(specimen.label, t('this_part', 'this part'))}`, { n: index + 1, part: named(specimen.label, t('this_part', 'this part')) })}
                        />
                        <figcaption className="space-y-3 p-3">
                            <div className="flex items-center gap-2">
                                <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[11px] font-bold text-slate-300">{index + 1}</span>
                                <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
                                    {image.uri.startsWith('data:') ? t('stored_in_case', 'Stored in this case') : image.uri}
                                </span>
                                {isRemoteRef(image.uri) && (
                                    <span className="shrink-0 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                        {t('referenced', 'Referenced')}
                                    </span>
                                )}
                            </div>
                            <NumericField
                                label={t('plate_width_label', 'Plate width (mm)')}
                                value={image.scaleMm}
                                onChange={(scaleMm) => onApply((current) => updateStudioGrossImage(current, specimen.id, image.id, { scaleMm: scaleMm ?? null }))}
                                hint={image.scaleMm ? t('plate_width_set', 'Scale bar is live in the room.') : t('plate_width_hint', 'Optional — fill this in to give the learner a scale bar.')}
                            />
                            {image.checksum
                                ? <PinStatus t={t} state="pinned" checksum={image.checksum} />
                                : (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <PinStatus t={t} state="unpinned" />
                                        <button type="button" className={BTN} onClick={() => pinPlate(image)}>
                                            {pinning === image.id
                                                ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                                                : <Ruler className="h-4 w-4" aria-hidden="true" />}
                                            {t('pin_now', 'Pin now')}
                                        </button>
                                    </div>
                                )}
                            <div className="flex flex-wrap items-center gap-1.5">
                                <button type="button" aria-label={t('move_plate_earlier', `Move plate ${index + 1} earlier`, { n: index + 1 })} disabled={index === 0} onClick={() => onApply((current) => moveStudioGrossImage(current, specimen.id, image.id, -1))} className={`${BTN} px-2.5 disabled:opacity-30`}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                                <button type="button" aria-label={t('move_plate_later', `Move plate ${index + 1} later`, { n: index + 1 })} disabled={index === images.length - 1} onClick={() => onApply((current) => moveStudioGrossImage(current, specimen.id, image.id, 1))} className={`${BTN} px-2.5 disabled:opacity-30`}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                                <button type="button" onClick={() => onApply((current) => removeStudioGrossImage(current, specimen.id, image.id))} className={`${DANGER} ml-auto`}><Trash2 className="h-4 w-4" aria-hidden="true" />{t('remove', 'Remove')}</button>
                            </div>
                        </figcaption>
                    </figure>
                ))}
            </div>

            {/* The macroscopic description, where a report puts it: with the
                photographs, written after looking at them. */}
            <details className="mt-5 rounded-xl bg-slate-950/40 ring-1 ring-slate-800" open={Boolean(specimen.description || specimen.dimensions || specimen.weight)}>
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-200 marker:content-['']">
                    {t('gross_description', 'Gross description')}
                    <span className="ml-2 text-xs font-normal text-slate-500">{t('gross_description_note', 'what the specimen looked like, in words')}</span>
                </summary>
                <div className="space-y-4 px-4 pb-4">
                    <TextField label={t('description', 'Description')} value={specimen.description} onChange={(description) => onPatch({ description })} multiline />
                    <div className="grid gap-4 sm:grid-cols-2">
                        <TextField label={t('dimensions', 'Dimensions')} value={specimen.dimensions} onChange={(dimensions) => onPatch({ dimensions })} hint={t('dimensions_hint', 'e.g. 45 x 30 x 20 mm.')} />
                        <TextField label={t('weight', 'Weight')} value={specimen.weight} onChange={(weight) => onPatch({ weight })} hint={t('weight_hint', 'e.g. 32 g.')} />
                    </div>
                </div>
            </details>
        </Card>
    );
}

/** Whether a plate is immutable enough to publish, said in one line. */
function PinStatus({ state, checksum = null, message = '', t = (key, fallback) => fallback ?? key }) {
    const tone = {
        busy: 'bg-slate-800/70 text-slate-300 ring-slate-700',
        pinned: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30',
        unreachable: 'bg-rose-500/15 text-rose-200 ring-rose-500/30',
        unpinned: 'bg-amber-500/15 text-amber-200 ring-amber-500/30',
        idle: 'bg-slate-800/70 text-slate-400 ring-slate-700',
    }[state] ?? 'bg-slate-800/70 text-slate-400 ring-slate-700';
    const label = {
        busy: t('pin_busy', 'Reading the image…'),
        pinned: t('pin_pinned', `Pinned · ${String(checksum).slice(0, 14)}…`, { digest: String(checksum).slice(0, 14) }),
        unreachable: t('pin_unreachable', `Not reachable — ${message}`, { reason: message }),
        unpinned: t('pin_unpinned', 'Not pinned — publication will be blocked'),
        idle: t('pin_idle', 'Waiting for a URL'),
    }[state] ?? state;
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ring-1 ${tone}`}>
            {state === 'busy' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {state === 'pinned' && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
            {(state === 'unpinned' || state === 'unreachable') && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
            {label}
        </span>
    );
}

/** Histology for one part: blocks, and the scanned slides cut from each. */
function HistologyCard({ document, specimen, blocks, highlighted, onApply, onSelect, onAddSlide, onDelete, pendingDelete, t }) {
    return (
        <Card
            title={t('histology', 'Histology')}
            icon={Microscope}
            accent="sky"
            highlighted={highlighted}
            description={t('histology_note', 'Scanned slides for this part. Each is filed under a block — the piece of tissue it was cut from.')}
            actions={(
                <>
                    {/* The slide is the point; the block is bookkeeping that
                        happens on the way. Leading with "Add block" put the
                        filing cabinet in front of the thing being filed. */}
                    <button type="button" className={PRIMARY} onClick={() => onAddSlide(blocks.at(-1)?.id ?? null)}>
                        <Plus className="h-4 w-4" aria-hidden="true" />{t('add_slide', 'Add slide')}
                    </button>
                    <button type="button" className={BTN} onClick={() => onApply((current) => addStudioBlock(current, specimen.id))}>
                        <Plus className="h-4 w-4" aria-hidden="true" />{t('add_block', 'Add block')}
                    </button>
                </>
            )}
        >
            {blocks.length === 0 && (
                <Empty>{t('histology_empty', 'No slide yet. A block is created automatically with your first slide — add one yourself only when you want to name it.')}</Empty>
            )}
            <div className="space-y-3">
                {blocks.map((block) => {
                    const slides = document.manifest.slides.filter((slide) => slide.blockId === block.id);
                    return (
                        <div key={block.id} className="rounded-xl bg-slate-950/50 p-4 ring-1 ring-slate-800">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{named(block.label, t('untitled_block', 'Untitled block'))}</h3>
                                <span className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300">{plural(t, 'slide_count', '{count, plural, one {# slide} other {# slides}}', { count: slides.length })}</span>
                                <button type="button" className={BTN} onClick={() => onSelect('block', block.id)}><Pencil className="h-4 w-4" aria-hidden="true" />{t('edit_block', 'Edit block')}</button>
                                <DeleteButton t={t} compact label={named(block.label, t('this_block', 'this block'))} pending={pendingDelete === `block:${block.id}`} onClick={() => onDelete('block', block.id)} />
                            </div>
                            {block.description && <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{block.description}</p>}
                            <div className="mt-3 space-y-2">
                                {slides.map((slide) => {
                                    const asset = document.manifest.assets.find((entry) => entry.id === slide.assetId);
                                    return (
                                        <div key={slide.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-900/70 p-2 ring-1 ring-slate-800">
                                            <button type="button" onClick={() => onSelect('slide', slide.id)} className="w-24 shrink-0 overflow-hidden rounded-lg hover:opacity-90">
                                                <SlidePreview t={t} dziUrl={assetDziUrl(asset)} alt={t('slide_overview_alt', `Whole-slide overview of ${named(slide.label, t('this_slide', 'this slide'))}`, { name: named(slide.label, t('this_slide', 'this slide')) })} className="h-16" />
                                            </button>
                                            <button type="button" onClick={() => onSelect('slide', slide.id)} className="min-h-10 min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-800/70">
                                                <span className="block truncate text-[13px] font-semibold text-slate-100">{named(slide.label, t('untitled_slide', 'Untitled slide'))}</span>
                                                <span className="block truncate text-[11px] tabular-nums text-slate-500">
                                                    {named(slide.stain.display, t('no_stain', 'no stain'))}
                                                    {asset?.metadata?.nativeObjective ? ` · ${asset.metadata.nativeObjective}x` : ''}
                                                    {asset?.metadata?.nativeMpp ? ` · ${mpp(asset.metadata.nativeMpp)} µm/px` : ''}
                                                </span>
                                            </button>
                                            <DeleteButton t={t} compact label={named(slide.label, t('this_slide', 'this slide'))} pending={pendingDelete === `slide:${slide.id}`} onClick={() => onDelete('slide', slide.id)} />
                                        </div>
                                    );
                                })}
                                <button type="button" className={ADD} onClick={() => onAddSlide(block.id)}><Plus className="h-4 w-4" aria-hidden="true" />{t('add_slide_from_library', 'Add slide from the slide library')}</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}

function Block({ document, block, onPatch, onSelect, onAddSlide, t }) {
    const specimen = document.manifest.specimens.find((entry) => entry.id === block.specimenId);
    const slides = document.manifest.slides.filter((entry) => entry.blockId === block.id);
    return (
        <div className="mx-auto max-w-6xl">
            <Breadcrumb trail={[
                { label: specimen ? specimenDisplayName(specimen) : t('specimen', 'Specimen'), onClick: () => onSelect('specimen', block.specimenId) },
                { label: t('histology', 'Histology'), onClick: () => onSelect('specimen', block.specimenId, 'histology') },
                { label: named(block.label, t('untitled_block', 'Untitled block')) },
            ]} t={t} />
            <Card
                title={named(block.label, t('untitled_block', 'Untitled block'))}
                icon={Microscope}
                accent="sky"
                description={t('block_note', 'A paraffin block belongs to exactly one specimen part.')}
                actions={<button type="button" className={PRIMARY} onClick={() => onAddSlide()}><Plus className="h-4 w-4" aria-hidden="true" />{t('add_slide', 'Add slide')}</button>}
            >
                <Fields>
                    <label className={LABEL}>
                        {t('specimen_part', 'Specimen part')}
                        <select value={block.specimenId} onChange={(event) => onPatch({ specimenId: event.target.value })} className={FIELD}>
                            {document.manifest.specimens.map((entry) => <option key={entry.id} value={entry.id}>{specimenDisplayName(entry)}</option>)}
                        </select>
                    </label>
                    <TextField label={t('block_label', 'Block label')} value={block.label} onChange={(label) => onPatch({ label })} hint={t('block_label_hint', 'e.g. A1.')} />
                    <TextField label={t('description', 'Description')} value={block.description} onChange={(description) => onPatch({ description })} multiline className="sm:col-span-2" />
                </Fields>
                <p className="mt-4 text-xs text-slate-500">{plural(t, 'slides_cut_from_block', '{count, plural, one {# slide is} other {# slides are}} cut from this block.', { count: slides.length })}</p>
            </Card>
        </div>
    );
}

function Activity({ activity, protectedActivity, onPatch, onEnsure, onRubric, t }) {
    const diagnosis = protectedActivity?.diagnosis ?? { expected: '', accept: [], requireTerms: [], rejectTerms: [] };
    const lines = (text) => text.split('\n').filter((line) => line.trim() !== '');
    return (
        <div className="mx-auto max-w-6xl space-y-5">
            <Card title={t('learner_activity', 'Learner activity')} description={t('learner_activity_note', 'Prompt and instructions are public.')}>
                <Fields>
                    <TextField label={t('kind', 'Kind')} value={activity.kind} onChange={(kind) => onPatch({ kind })} />
                    <TextField label={t('prompt', 'Prompt')} value={activity.prompt} onChange={(prompt) => onPatch({ prompt })} />
                    <TextField label={t('instructions', 'Instructions')} value={activity.instructions} onChange={(instructions) => onPatch({ instructions })} multiline className="sm:col-span-2" />
                </Fields>
            </Card>
            {!protectedActivity
                ? <button type="button" className={PRIMARY} onClick={onEnsure}><Plus className="h-4 w-4" aria-hidden="true" />{t('create_protected_rubric', 'Create protected rubric')}</button>
                : (
                    <Card title={t('protected_rubric', 'Protected rubric')} description={t('protected_rubric_note', 'Never included in a learner package.')}>
                        <Fields>
                            <TextField label={t('hints_one_per_line', 'Hints · one per line')} value={protectedActivity.hints.join('\n')} onChange={(text) => onRubric({ hints: lines(text) })} multiline className="sm:col-span-2" />
                            <TextField label={t('expected_diagnosis', 'Expected diagnosis')} value={diagnosis.expected} onChange={(expected) => onRubric({ diagnosis: { ...diagnosis, expected } })} className="sm:col-span-2" />
                            <TextField label={t('accepted_synonyms', 'Accepted synonyms')} value={diagnosis.accept.join('\n')} onChange={(text) => onRubric({ diagnosis: { ...diagnosis, accept: lines(text) } })} multiline />
                            <TextField label={t('required_terms', 'Required terms')} value={diagnosis.requireTerms.join('\n')} onChange={(text) => onRubric({ diagnosis: { ...diagnosis, requireTerms: lines(text) } })} multiline />
                            <TextField label={t('rejected_terms', 'Rejected terms')} value={diagnosis.rejectTerms.join('\n')} onChange={(text) => onRubric({ diagnosis: { ...diagnosis, rejectTerms: lines(text) } })} multiline />
                        </Fields>
                    </Card>
                )}
        </div>
    );
}

function Slide({ document, slide, activityId, onActivityId, onPatch, onChooseAsset, onApply, onSelect, t }) {
    const asset = document.manifest.assets.find((entry) => entry.id === slide.assetId);
    const block = document.manifest.blocks.find((entry) => entry.id === slide.blockId);
    const specimen = document.manifest.specimens.find((entry) => entry.id === block?.specimenId);
    const protectedActivity = document.rubric.activities.find((entry) => entry.activityId === activityId);
    const criteria = protectedActivity?.slideCriteria.find((entry) => entry.slideId === slide.id);
    const multiPart = document.manifest.specimens.length > 1;
    return (
        <div className="mx-auto max-w-6xl space-y-5">
            {multiPart
                ? (
                    <Breadcrumb t={t} trail={[
                        { label: t('case', 'Case'), onClick: () => onSelect('overview', null) },
                        { label: specimen ? specimenDisplayName(specimen) : t('specimen', 'Specimen'), onClick: () => specimen && onSelect('specimen', specimen.id) },
                        { label: named(slide.label, t('untitled_slide', 'Untitled slide')) },
                    ]} />
                )
                : (
                    <button type="button" className={`${BTN} mb-4`} onClick={() => onSelect('overview', null)}>
                        <ChevronRight className="h-4 w-4 rotate-180" aria-hidden="true" />{t('back_to_case', 'Back to the case')}
                    </button>
                )}
            <Card
                title={named(slide.label, t('untitled_slide', 'Untitled slide'))}
                icon={Microscope}
                accent="sky"
                description={t('slide_note', 'Its label and stain are what the learner sees.')}
                actions={<button type="button" className={BTN} onClick={onChooseAsset}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('choose_asset', 'Choose asset')}</button>}
            >
                <Fields>
                    <TextField label={t('slide_label', 'Slide label')} value={slide.label} onChange={(label) => onPatch({ label })} />
                    {document.manifest.blocks.length > 1 && (
                        <label className={LABEL}>
                            {t('block', 'Block')}
                            <select value={slide.blockId} onChange={(event) => onPatch({ blockId: event.target.value })} className={FIELD}>
                                {document.manifest.blocks.map((entry) => <option key={entry.id} value={entry.id}>{named(entry.label, entry.id)}</option>)}
                            </select>
                        </label>
                    )}
                    <TextField
                        label={t('stain', 'Stain')}
                        value={slide.stain.display}
                        onChange={(display) => onPatch({ stain: { ...slide.stain, display, code: stainCode(display) } })}
                        hint={t('stain_hint', 'e.g. H&E, CK7, PAS.')}
                    />
                </Fields>
                <div className="mt-4 grid gap-4 sm:grid-cols-[240px_1fr]">
                    <div className="overflow-hidden rounded-xl ring-1 ring-slate-800">
                        <SlidePreview t={t} dziUrl={assetDziUrl(asset)} alt={t('slide_overview_alt', `Whole-slide overview of ${named(slide.label, t('this_slide', 'this slide'))}`, { name: named(slide.label, t('this_slide', 'this slide')) })} className="h-40" />
                    </div>
                    <div className="rounded-xl bg-slate-950/60 p-4 ring-1 ring-slate-800">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Ruler className="h-4 w-4 text-slate-400" aria-hidden="true" />
                            <strong className="text-slate-200">{t('scanner_calibration', 'Scanner calibration')}</strong>
                            <span className="text-slate-500">{t('scanner_calibration_note', 'what every measurement in the room is derived from')}</span>
                        </div>
                        {asset?.metadata && <p className="mt-2 text-xs tabular-nums text-slate-400">{asset.metadata.nativeObjective ?? '—'}x · {mpp(asset.metadata.nativeMpp)} µm/px · ÷{asset.metadata.downsample ?? '—'} · {asset.metadata.widthPx ?? '—'} × {asset.metadata.heightPx ?? '—'} px</p>}
                    </div>
                </div>
            </Card>

            {document.manifest.activities.length > 0 && (
                <Card
                    title={t('per_slide_rubric', 'Per-slide rubric')}
                    description={t('per_slide_rubric_note', 'Coordinates are level-0 slide pixels.')}
                    actions={(
                        <label className={`${LABEL} min-w-56`}>
                            {t('activity', 'Activity')}
                            <select value={activityId} onChange={(event) => onActivityId(event.target.value)} className={FIELD}>
                                {document.manifest.activities.map((activity) => <option key={activity.id} value={activity.id}>{named(activity.prompt, activity.id)}</option>)}
                            </select>
                        </label>
                    )}
                >
                    {!protectedActivity && <button type="button" className={PRIMARY} onClick={() => onApply((current) => ensureActivityRubric(current, activityId))}><Plus className="h-4 w-4" aria-hidden="true" />{t('create_protected_rubric', 'Create protected rubric')}</button>}
                    {protectedActivity && !criteria && <button type="button" className={PRIMARY} onClick={() => onApply((current) => ensureSlideCriteria(current, activityId, slide.id))}><Plus className="h-4 w-4" aria-hidden="true" />{t('add_scoring_for_slide', 'Add scoring for this slide')}</button>}
                    {criteria && (
                        <Criteria
                            t={t}
                            activityId={activityId} slide={slide}
                            criteria={criteria} onApply={onApply}
                            onRemove={() => onApply((current) => removeSlideCriteria(current, activityId, slide.id))}
                        />
                    )}
                </Card>
            )}
        </div>
    );
}

function Criteria({ activityId, slide, criteria, onApply, onRemove, t }) {
    const patch = (next) => onApply((current) => updateSlideCriteria(current, activityId, slide.id, next));
    return (
        <div className="space-y-4">
            {/* Adding scoring is one click, so removing it has to be too.
                Without this, a mis-click left criteria on the case that the
                author could not take off — and until the bounds were seeded to
                the whole slide, that also meant the case could never publish. */}
            <div className="flex justify-end">
                <button type="button" className={BTN} onClick={onRemove}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />{t('stop_scoring_slide', 'Stop scoring this slide')}
                </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
                <NumericField label={t('weight', 'Weight')} value={criteria.weight} onChange={(weight) => patch({ weight })} />
                <NumericField label={t('screening_objective', 'Screening (x)')} value={criteria.screeningObjective} onChange={(screeningObjective) => patch({ screeningObjective })} />
                <NumericField label={t('coverage_objective', 'Coverage (x)')} value={criteria.coverageObjective} onChange={(coverageObjective) => patch({ coverageObjective })} />
                <NumericField label={t('coverage_grid', 'Coverage grid')} value={criteria.coverageGrid} onChange={(coverageGrid) => patch({ coverageGrid })} />
            </div>
            <fieldset className="rounded-xl bg-slate-950/50 p-4 ring-1 ring-slate-800">
                <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t('tissue_bounds', 'Tissue bounds · slide pixels')}</legend>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {['x', 'y', 'w', 'h'].map((field) => <NumericField key={field} label={field.toUpperCase()} value={criteria.tissueBounds[field]} onChange={(value) => patch({ tissueBounds: { ...criteria.tissueBounds, [field]: value } })} />)}
                </div>
            </fieldset>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t('regions_of_interest', 'Regions of interest')} ({criteria.rois.length})</h3>
                <button type="button" className={BTN} onClick={() => onApply((current) => addStudioRoi(current, activityId, slide.id))}><Plus className="h-4 w-4" aria-hidden="true" />{t('add_roi', 'Add ROI')}</button>
            </div>
            <div className="space-y-3">
                {criteria.rois.map((roi) => (
                    <Roi
                        key={roi.id}
                        t={t}
                        roi={roi}
                        onPatch={(next) => onApply((current) => updateStudioRoi(current, activityId, slide.id, roi.id, next))}
                        onDelete={() => onApply((current) => removeStudioRoi(current, activityId, slide.id, roi.id))}
                    />
                ))}
                {criteria.rois.length === 0 && <Empty>{t('rois_empty', 'Add each finding the learner must resolve.')}</Empty>}
            </div>
        </div>
    );
}

function Roi({ roi, onPatch, onDelete, t }) {
    return (
        <fieldset className="rounded-xl bg-slate-950/50 p-4 ring-1 ring-slate-800">
            <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{named(roi.label, roi.id)}</legend>
            <div className="grid gap-4 sm:grid-cols-4">
                <TextField label={t('label', 'Label')} value={roi.label} onChange={(label) => onPatch({ label })} className="sm:col-span-2" />
                <NumericField label={t('minimum_objective', 'Minimum objective (x)')} value={roi.minObjective} onChange={(minObjective) => onPatch({ minObjective })} />
                <NumericField label={t('dwell_ms', 'Dwell (ms)')} value={roi.dwellMs} onChange={(dwellMs) => onPatch({ dwellMs })} />
                {['x', 'y', 'w', 'h'].map((field) => <NumericField key={field} label={field.toUpperCase()} value={roi[field]} onChange={(value) => onPatch({ [field]: value })} />)}
                <label className="flex items-center gap-2 text-[13px] text-slate-300 sm:col-span-2">
                    <input type="checkbox" checked={roi.critical} onChange={(event) => onPatch({ critical: event.target.checked })} className="h-4 w-4" />
                    {t('critical_finding', 'Critical finding')}
                </label>
                <button type="button" onClick={onDelete} className={`${DANGER} sm:col-span-2`}><Trash2 className="h-4 w-4" aria-hidden="true" />{t('remove_roi', 'Remove ROI')}</button>
            </div>
        </fieldset>
    );
}

function Checks({ issues, t }) {
    return (
        <aside aria-label={t('publish_checks', 'Publish checks')} className="w-80 shrink-0 overflow-y-auto border-l border-slate-800/80 bg-slate-950/45 p-4 max-xl:w-72">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('publish_checks', 'Publish checks')} ({issues.length})</h2>
            {issues.length === 0
                ? <p className="mt-3 flex gap-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />{t('no_blockers', 'No blockers found.')}</p>
                : (
                    <ul className="mt-3 space-y-3">
                        {issues.map((issue) => (
                            <li key={`${issue.path}:${issue.code}`} className={`flex gap-2 text-xs leading-relaxed ${issue.severity === 'error' ? 'text-rose-200' : 'text-amber-200'}`}>
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <span>{issue.message}<code className="mt-0.5 block text-[10px] text-slate-600">{issue.path}</code></span>
                            </li>
                        ))}
                    </ul>
                )}
        </aside>
    );
}


/** Optics for a slide whose file did not carry them. Both values required. */
function CalibrationForm({ asset, onSave, onCancel, t }) {
    const [objective, setObjective] = useState('');
    const [mpp, setMpp] = useState('');
    const valid = numberValue(objective) > 0 && numberValue(mpp) > 0;
    return (
        <fieldset className="mt-4 rounded-2xl bg-slate-900/55 p-5 ring-1 ring-amber-500/30">
            <legend className="px-1 text-sm font-semibold">{t('calibrate_named', `Calibrate “${asset.label || asset.id}”`, { name: asset.label || asset.id })}</legend>
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
                {t('calibrate_note', 'This file carries no scanner optics. Every measurement a reader makes is scaled by these two numbers, so they are asked for rather than assumed.')}
            </p>
            <div className="grid grid-cols-2 gap-4">
                <TextField label={t('scanned_at', 'Scanned at (x)')} value={objective} onChange={setObjective} />
                <TextField label={t('microns_per_pixel', 'µm per pixel')} value={mpp} onChange={setMpp} />
            </div>
            <div className="mt-4 flex gap-2">
                <button type="button" className={PRIMARY} disabled={!valid} onClick={() => onSave(numberValue(objective), numberValue(mpp))}>{t('save_calibration', 'Save calibration')}</button>
                <button type="button" className={BTN} onClick={onCancel}>{t('cancel', 'Cancel')}</button>
            </div>
        </fieldset>
    );
}

function AssetPicker({ assetService, actionLabel, onSelect, onClose, t }) {
    const [assets, setAssets] = useState([]); const [query, setQuery] = useState('');
    const [scanSourceId, setScanSourceId] = useState('');
    const [state, setState] = useState({ busy: true, error: '' });
    // Import-from-link (RPS-1 1.4). Every method it needs is OPTIONAL on the
    // asset service, so the standalone app — which has no host to import
    // through — simply does not render the panel.
    const [importForm, setImportForm] = useState({ url: '', label: '' });
    const [importing, setImporting] = useState(null);
    const [calibrating, setCalibrating] = useState(null);
    const [manual, setManual] = useState({ id: '', label: '', url: '', nativeObjective: '', nativeMpp: '', downsample: '', slideWidthPx: '', slideHeightPx: '' });
    const refresh = useCallback(async () => {
        if (!assetService?.list) { setState({ busy: false, error: t('no_asset_service', 'No asset service is configured. Add an existing DZI manually below.') }); return; }
        setState({ busy: true, error: '' });
        try { const catalog = await assetService.list(); setAssets(catalog.assets ?? []); setState({ busy: false, error: catalog.unavailableReason ?? '' }); }
        catch (error) { setState({ busy: false, error: error?.message ?? String(error) }); }
    }, [assetService, t]);
    useEffect(() => { refresh(); return assetService?.subscribe?.(() => refresh(), { onError: (error) => setState({ busy: false, error: error?.message ?? String(error) }) }); }, [assetService, refresh]);
    const filtered = useMemo(() => filterCatalogAssets(assets, { query }), [assets, query]);
    const useManual = () => {
        try {
            const input = { id: manual.id, label: manual.label, url: manual.url, nativeObjective: numberValue(manual.nativeObjective), nativeMpp: numberValue(manual.nativeMpp), downsample: numberValue(manual.downsample), slideWidthPx: numberValue(manual.slideWidthPx), slideHeightPx: numberValue(manual.slideHeightPx) };
            onSelect(assetService?.addManualDzi ? assetService.addManualDzi(input) : manualStudioAsset(input));
        } catch (error) { setState({ busy: false, error: error?.message ?? String(error) }); }
    };
    const scan = async () => {
        if (!assetService?.scan) { setState({ busy: false, error: t('scan_needs_service', 'Scanning requires a configured asset service.') }); return; }
        try {
            setState({ busy: true, error: '' });
            const job = await assetService.scan(scanSourceId);
            if (job?.id && assetService.pollJob) await assetService.pollJob(job.id).promise;
            await refresh();
        }
        catch (error) { setState({ busy: false, error: error?.message ?? String(error) }); }
    };
    /**
     * Import a slide from a URL, then follow the job to completion.
     *
     * The phase is surfaced as it arrives rather than only at the end: tiling a
     * whole-slide image is minutes of work, and a spinner with no phase is
     * indistinguishable from a hang.
     */
    const importFromLink = async (url, label) => {
        if (!assetService?.importUrl) return;
        setState({ busy: true, error: '' });
        setImporting({ url, phase: 'queued', progress: 0 });
        try {
            const job = await assetService.importUrl({ url, label });
            if (job?.jobId && assetService.pollJob) {
                await assetService.pollJob(job.jobId, {
                    onProgress: (status) => setImporting({
                        url, phase: status?.phase ?? status?.state ?? 'working', progress: status?.progress ?? 0,
                    }),
                }).promise;
            }
            setImportForm({ url: '', label: '' });
            setImporting(null);
            await refresh();
        } catch (error) {
            setImporting(null);
            setState({ busy: false, error: error?.message ?? String(error) });
        }
    };

    const removeAsset = async (assetId) => {
        if (!assetService?.remove) return;
        setState({ busy: true, error: '' });
        try { await assetService.remove(assetId); await refresh(); }
        catch (error) { setState({ busy: false, error: error?.message ?? String(error) }); }
    };

    /**
     * Supply the optics a file did not carry.
     *
     * Both numbers are required and neither is defaulted: this is what every
     * measurement a reader makes is scaled by, and a plausible-looking 40x/0.25
     * is the exact failure `needs_calibration` exists to prevent.
     */
    const calibrateAsset = async (assetId, nativeObjective, nativeMpp) => {
        if (!assetService?.calibrate) return;
        setState({ busy: true, error: '' });
        try { await assetService.calibrate(assetId, { nativeObjective, nativeMpp }); await refresh(); }
        catch (error) { setState({ busy: false, error: error?.message ?? String(error) }); }
    };

    const processAsset = async (assetId) => {
        try {
            setState({ busy: true, error: '' });
            const job = await assetService.process(assetId, {});
            if (job?.id && assetService.pollJob) await assetService.pollJob(job.id).promise;
            await refresh();
        } catch (error) { setState({ busy: false, error: error?.message ?? String(error) }); }
    };
    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/65" role="dialog" aria-modal="true" aria-labelledby="asset-picker-title">
            <section className="flex h-full w-full max-w-2xl flex-col bg-slate-950 text-slate-100 shadow-2xl ring-1 ring-slate-700">
                <header className="flex items-center gap-2 border-b border-slate-800 p-4">
                    <div>
                        <h2 id="asset-picker-title" className="text-base font-semibold">{t('slide_library', 'Slide Library')}</h2>
                        <p className="text-xs text-slate-500">{t('slide_library_note', 'Preview a verified slide, then add it to this case.')}</p>
                    </div>
                    <button type="button" className={`${BTN} ml-auto`} onClick={refresh}>
                        <RefreshCw className={`h-4 w-4 ${state.busy ? 'animate-spin' : ''}`} aria-hidden="true" />{t('refresh', 'Refresh')}
                    </button>
                    <button type="button" aria-label={t('close_slide_library', 'Close slide library')} className={BTN} onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {state.error && <p role="alert" className="mb-3 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-200 ring-1 ring-amber-500/30">{state.error}</p>}
                    {assetService?.available && (
                        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                            <TextField label={t('source_id_to_scan', 'Source ID to scan')} value={scanSourceId} onChange={setScanSourceId} />
                            <button type="button" className={BTN} onClick={scan}>{t('scan_source', 'Scan source')}</button>
                        </div>
                    )}
                    {assetService?.importUrl && (
                        <fieldset className="mt-3 rounded-2xl bg-slate-900/55 p-4 ring-1 ring-slate-800">
                            <legend className="px-1 text-sm font-semibold">{t('import_from_link', 'Import from link')}</legend>
                            <p className="mb-3 text-xs leading-relaxed text-slate-500">
                                {t('import_from_link_note', 'Paste a link to a whole-slide image (.svs, .ndpi, .tiff). It is downloaded, tiled and added to this library. Only hosts your administrator has allowed can be used.')}
                            </p>
                            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                                <TextField label={t('slide_url', 'Slide URL')} value={importForm.url} onChange={(url) => setImportForm((f) => ({ ...f, url }))} />
                                <button
                                    type="button"
                                    className={PRIMARY}
                                    disabled={!importForm.url.trim() || Boolean(importing)}
                                    onClick={() => importFromLink(importForm.url.trim(), importForm.label.trim())}
                                >
                                    {t('import', 'Import')}
                                </button>
                            </div>
                            <div className="mt-2"><TextField label={t('label_optional', 'Label (optional)')} value={importForm.label} onChange={(label) => setImportForm((f) => ({ ...f, label }))} /></div>
                            {importing && (
                                <p role="status" className="mt-3 text-[11px] tabular-nums text-sky-300">
                                    {importing.phase}… {importing.progress > 0 ? `${Math.round(importing.progress)}%` : ''}
                                </p>
                            )}
                        </fieldset>
                    )}
                    <div className="mt-3"><TextField label={t('search_slide_library', 'Search slide library')} value={query} onChange={setQuery} /></div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {filtered.map((asset) => (
                            <SlideAssetCard
                                key={asset.id}
                                t={t}
                                asset={asset}
                                actionLabel={actionLabel}
                                onAction={onSelect}
                                notReadyActionLabel={nextActionLabel(asset, {
                                    remove: Boolean(assetService?.remove),
                                    calibrate: Boolean(assetService?.calibrate),
                                    process: Boolean(assetService?.available),
                                }, t)}
                                onNotReadyAction={(candidate) => {
                                    if (candidate.status === 'failed') return removeAsset(candidate.id);
                                    if (candidate.status === 'needs_calibration') return setCalibrating(candidate);
                                    return processAsset(candidate.id);
                                }}
                            />
                        ))}
                    </div>
                    {calibrating && (
                        <CalibrationForm
                            t={t}
                            asset={calibrating}
                            onCancel={() => setCalibrating(null)}
                            onSave={(objective, mpp) => { setCalibrating(null); return calibrateAsset(calibrating.id, objective, mpp); }}
                        />
                    )}
                    {!state.busy && filtered.length === 0 && <div className="mt-3"><Empty>{t('no_assets_match', 'No catalog assets match.')}</Empty></div>}
                    <fieldset className="mt-6 rounded-2xl bg-slate-900/55 p-5 ring-1 ring-slate-800">
                        <legend className="px-1 text-sm font-semibold">{t('existing_dzi_url', 'Existing DZI URL')}</legend>
                        <p className="mb-3 text-xs leading-relaxed text-slate-500">{t('existing_dzi_note', 'Every calibration field is required. Case Studio will not guess scanner optics.')}</p>
                        <div className="grid grid-cols-2 gap-4">
                            {MANUAL_DZI_FIELDS.map(({ key, labelKey, label }) => (
                                <TextField key={key} label={t(labelKey, label)} value={manual[key]} onChange={(value) => setManual((current) => ({ ...current, [key]: value }))} className={key === 'url' ? 'col-span-2' : ''} />
                            ))}
                        </div>
                        <button type="button" className={`${PRIMARY} mt-4`} onClick={useManual}>{t('use_manual_dzi', 'Use manual DZI')}</button>
                    </fieldset>
                </div>
            </section>
        </div>
    );
}

function Preview({ document, activityId, includeProtected, onClose, resolveRef = null, t }) {
    const pathologyCase = useMemo(() => studioPreviewManifest(document, activityId), [document, activityId]);
    const previewName = includeProtected ? t('instructor_preview', 'Instructor preview') : t('learner_preview', 'Learner preview');
    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950" role="dialog" aria-modal="true" aria-label={previewName}>
            <header className="flex shrink-0 items-center gap-3 bg-amber-400 px-4 py-2.5 text-slate-950">
                <strong className="text-xs uppercase tracking-wide">{t('preview_unsaved_draft', `${previewName} · unsaved author draft`, { preview: previewName })}</strong>
                <span className="text-xs">{t('preview_isolated', 'Events and work are isolated and will not be saved.')}</span>
                <button type="button" onClick={onClose} className="ml-auto min-h-9 rounded-lg bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white">{t('close_preview', 'Close preview')}</button>
            </header>
            <div className="flex min-h-0 flex-1"><PathologyRoom t={t} pathologyCase={pathologyCase} rubric={includeProtected ? document.rubric : null} eventLogger={NOOP_LOGGER} resolveRef={resolveRef} /></div>
        </div>
    );
}
