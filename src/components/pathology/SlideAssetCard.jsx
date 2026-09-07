import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { catalogAssetPreview, selectReadyRevision } from './assetCatalog.js';

/**
 * How each status reads on a card.
 *
 * The card used to be binary — ready, or "Needs calibration" for everything
 * else. A MANAGED slide (one the host imported from a link, RPS-1 1.4) has two
 * more states that are neither: it may still be importing, or it may have
 * failed. Showing "Needs calibration" for a download that 404'd tells an author
 * to go and type optics for a slide that does not exist.
 */
const DISABLED_REASON = {
    importing: 'This slide is still being imported.',
    failed: 'This slide could not be imported.',
    needs_calibration: 'Verified scanner calibration is required before this slide can be added.',
};

/**
 * The key for each reason and each chip, written out LITERALLY beside the
 * catalogue it belongs to. Both tables are module scope and cannot take a `t`
 * prop, so the English stays as the fallback and the render translates from
 * the stable `asset.status`.
 */
const DISABLED_REASON_KEYS = {
    importing: 'asset_disabled_importing',
    failed: 'asset_disabled_failed',
    needs_calibration: 'asset_disabled_needs_calibration',
};

const STATUS_CHIPS = {
    ready: { label: 'Ready', tone: 'bg-emerald-500/15 text-emerald-300' },
    importing: { label: 'Importing…', tone: 'bg-sky-500/15 text-sky-300' },
    failed: { label: 'Failed', tone: 'bg-rose-500/15 text-rose-300' },
    needs_calibration: { label: 'Needs calibration', tone: 'bg-amber-500/15 text-amber-300' },
};

const STATUS_CHIP_KEYS = {
    ready: 'asset_status_ready',
    importing: 'asset_status_importing',
    failed: 'asset_status_failed',
    needs_calibration: 'asset_status_needs_calibration',
};

const ACTION = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-fuchsia-500/25 px-3.5 py-2 text-[13px] font-semibold text-fuchsia-50 ring-1 ring-fuchsia-400/50 transition-colors hover:bg-fuchsia-500/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:ring-slate-700';

/**
 * Preview card shared by the standalone Slide Library and Case Studio picker.
 *
 * The picture and the name open the slide; the button at the bottom is the
 * commitment. Keeping them separate is what lets someone look before they add —
 * and it keeps the action button out of a nested-button hole.
 */
export function SlideAssetCard({
    asset, actionLabel, onAction, onOpen = null, notReadyActionLabel = null, onNotReadyAction = null, disabled = false,
    t = (key, fallback) => fallback ?? key,
}) {
    const [previewFailed, setPreviewFailed] = useState(false);
    const preview = catalogAssetPreview(asset);
    const ready = asset.status === 'ready';
    const status = STATUS_CHIPS[asset.status] ? asset.status : 'needs_calibration';
    const chip = STATUS_CHIPS[status];
    let optics = null;
    if (ready) {
        try { optics = selectReadyRevision(asset).optics; } catch { optics = null; }
    }
    const body = (
        <>
            <div className="flex aspect-[3/2] items-center justify-center overflow-hidden bg-slate-950">
                {preview && !previewFailed ? (
                    <img
                        src={preview.url}
                        alt={t('asset_preview_of', `Preview of ${asset.label || asset.id}`, { name: asset.label || asset.id })}
                        loading="lazy"
                        crossOrigin="anonymous"
                        referrerPolicy="no-referrer"
                        onError={() => setPreviewFailed(true)}
                        className="h-full w-full object-contain"
                    />
                ) : (
                    <div className="flex flex-col items-center gap-2 text-[11px] text-slate-600">
                        <ImageOff className="h-6 w-6" aria-hidden="true" /> {t('no_preview', 'No preview')}
                    </div>
                )}
            </div>
            <div className="p-4 text-left">
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-slate-100">{asset.label || asset.id}</h3>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                            {asset.format || t('format_unknown', 'unknown')} · {asset.sourceId || t('source_unknown', 'source unknown')}
                        </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.tone}`}>
                        {t(STATUS_CHIP_KEYS[status], chip.label)}
                    </span>
                </div>
                {optics && (
                    <p className="mt-2 text-[11px] tabular-nums text-slate-400">
                        {optics.nativeObjective}× · {Number(optics.nativeMpp).toFixed(3)} µm/px · ÷{optics.downsample}
                    </p>
                )}
                {!ready && (asset.error || asset.reviewReason) && (
                    <p className={`mt-2 text-[11px] leading-relaxed ${asset.error ? 'text-rose-200/80' : 'text-amber-200/80'}`}>
                        {asset.error || asset.reviewReason}
                    </p>
                )}
                {asset.phase && asset.status === 'importing' && (
                    <p className="mt-2 text-[11px] tabular-nums text-sky-300/80">{asset.phase}…</p>
                )}
            </div>
        </>
    );

    return (
        <article className={`overflow-hidden rounded-2xl bg-slate-900/70 ring-1 transition-shadow ${onOpen ? 'ring-slate-800 hover:ring-fuchsia-500/50' : 'ring-slate-800'}`}>
            {onOpen
                ? (
                    <button type="button" onClick={() => onOpen(asset)} className="block w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-fuchsia-400">
                        {body}
                        <span className="sr-only">{t('open_named', `Open ${asset.label || asset.id}`, { name: asset.label || asset.id })}</span>
                    </button>
                )
                : body}
            <div className="px-4 pb-4">
                {actionLabel && (
                    <button
                        type="button"
                        className={`${ACTION} w-full`}
                        disabled={disabled || (!ready && !notReadyActionLabel)}
                        title={!ready && !notReadyActionLabel ? t(DISABLED_REASON_KEYS[status], DISABLED_REASON[status]) : undefined}
                        onClick={() => (ready ? onAction?.(asset) : onNotReadyAction?.(asset))}
                    >
                        {ready ? actionLabel : notReadyActionLabel ?? t('calibration_required', 'Calibration required')}
                    </button>
                )}
            </div>
        </article>
    );
}
