import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { catalogAssetPreview, selectReadyRevision } from './assetCatalog.js';

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
}) {
    const [previewFailed, setPreviewFailed] = useState(false);
    const preview = catalogAssetPreview(asset);
    const ready = asset.status === 'ready';
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
                        alt={`Preview of ${asset.label || asset.id}`}
                        loading="lazy"
                        crossOrigin="anonymous"
                        onError={() => setPreviewFailed(true)}
                        className="h-full w-full object-contain"
                    />
                ) : (
                    <div className="flex flex-col items-center gap-2 text-[11px] text-slate-600">
                        <ImageOff className="h-6 w-6" aria-hidden="true" /> No preview
                    </div>
                )}
            </div>
            <div className="p-4 text-left">
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-slate-100">{asset.label || asset.id}</h3>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                            {asset.format || 'unknown'} · {asset.sourceId || 'source unknown'}
                        </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ready ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                        {ready ? 'Ready' : 'Needs calibration'}
                    </span>
                </div>
                {optics && (
                    <p className="mt-2 text-[11px] tabular-nums text-slate-400">
                        {optics.nativeObjective}× · {Number(optics.nativeMpp).toFixed(3)} µm/px · ÷{optics.downsample}
                    </p>
                )}
                {!ready && asset.reviewReason && (
                    <p className="mt-2 text-[11px] leading-relaxed text-amber-200/80">{asset.reviewReason}</p>
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
                        <span className="sr-only">Open {asset.label || asset.id}</span>
                    </button>
                )
                : body}
            <div className="px-4 pb-4">
                {actionLabel && (
                    <button
                        type="button"
                        className={`${ACTION} w-full`}
                        disabled={disabled || (!ready && !notReadyActionLabel)}
                        title={!ready && !notReadyActionLabel ? 'Verified scanner calibration is required before this slide can be added.' : undefined}
                        onClick={() => (ready ? onAction?.(asset) : onNotReadyAction?.(asset))}
                    >
                        {ready ? actionLabel : notReadyActionLabel ?? 'Calibration required'}
                    </button>
                )}
            </div>
        </article>
    );
}
