import { useId } from 'react';

/**
 * The image-manipulation panel: window/level, transfer function, gamma, edge
 * enhancement, interpolation.
 *
 * Two design decisions worth stating.
 *
 * WINDOW IS SHOWN IN THE IMAGE'S OWN UNITS, not as "brightness 0-100". A CT
 * window of C40/W400 is a clinical instruction a reader can be taught, write
 * down and hand to someone else; "brightness 62%" is not, and it cannot be
 * compared between two studies. So the numbers are the real ones, and the
 * sliders move them over a range derived from the window the study opened with.
 *
 * EVERY CONTROL HAS A NUMBER AND A SLIDER. The slider is for hunting, the field
 * is for reproducing — a reader who has been told to look at C-600/W1500 should
 * be able to type it rather than drag towards it.
 */
export function ImageControls({ viewport, baseWindow, onWindow, onAdjust, onReset, t = (k, d) => d }) {
    if (!viewport) return null;

    const base = baseWindow ?? viewport.window;
    // Ranges are relative to the study's own window, because the units are not
    // comparable between modalities: a CR runs 0..32767 and a CT -1024..3071.
    const span = Math.max(1, base.width);
    const centreMin = Math.round(base.center - span);
    const centreMax = Math.round(base.center + span);
    const widthMax = Math.round(span * 3);

    return (
        <div className="p-3 space-y-4 text-xs">
            <Section title={t('radoyon_ctl_window', 'Window / level')}>
                <Control
                    label={t('radoyon_ctl_width', 'Width')}
                    hint={t('radoyon_ctl_width_hint', 'Narrower = more contrast')}
                    value={Math.round(viewport.window.width)}
                    min={1} max={widthMax} step={Math.max(1, Math.round(span / 200))}
                    onChange={(v) => onWindow({ width: v })}
                />
                <Control
                    label={t('radoyon_ctl_centre', 'Level')}
                    hint={t('radoyon_ctl_centre_hint', 'Lower = brighter')}
                    value={Math.round(viewport.window.center)}
                    min={centreMin} max={centreMax} step={Math.max(1, Math.round(span / 200))}
                    onChange={(v) => onWindow({ center: v })}
                />
            </Section>

            <Section title={t('radoyon_ctl_transfer', 'Transfer function')}>
                <div className="flex gap-1">
                    {[
                        ['LINEAR', t('radoyon_ctl_linear', 'Linear')],
                        ['SIGMOID', t('radoyon_ctl_sigmoid', 'Sigmoid')],
                    ].map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => onAdjust('voiFunction', id)}
                            aria-pressed={(viewport.voiFunction ?? 'LINEAR') === id}
                            className={`flex-1 rounded-md border px-2 py-1 ${
                                (viewport.voiFunction ?? 'LINEAR') === id
                                    ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                                    : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <p className="text-[11px] text-slate-500 leading-snug">
                    {t('radoyon_ctl_sigmoid_hint',
                        'Sigmoid rolls contrast off instead of clipping — it holds the apices and the abdomen on one film.')}
                </p>
                <Control
                    label={t('radoyon_ctl_gamma', 'Gamma')}
                    hint={t('radoyon_ctl_gamma_hint', 'Above 1 lifts the dark half')}
                    value={viewport.gamma ?? 1}
                    min={0.2} max={5} step={0.05} decimals={2}
                    onChange={(v) => onAdjust('gamma', v)}
                />
            </Section>

            <Section title={t('radoyon_ctl_detail', 'Detail')}>
                <Control
                    label={t('radoyon_ctl_sharpen', 'Edge enhancement')}
                    hint={t('radoyon_ctl_sharpen_hint', 'Display only — measurements are unaffected')}
                    value={viewport.sharpen ?? 0}
                    min={0} max={3} step={0.05} decimals={2}
                    onChange={(v) => onAdjust('sharpen', v)}
                />
                <label className="flex items-center gap-2 text-slate-400 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={viewport.smooth !== false}
                        onChange={(e) => onAdjust('smooth', e.target.checked)}
                        className="accent-cyan-500"
                    />
                    {t('radoyon_ctl_smooth', 'Interpolate when zoomed out')}
                </label>
            </Section>

            <button
                type="button"
                onClick={onReset}
                className="w-full rounded-md border border-slate-700 px-2 py-1.5 text-slate-300 hover:border-slate-500"
            >
                {t('radoyon_ctl_reset', 'Reset to as acquired')}
            </button>
        </div>
    );
}

function Section({ title, children }) {
    return (
        <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500">{title}</h3>
            {children}
        </section>
    );
}

/** A labelled slider with the real number beside it, editable. */
function Control({ label, hint, value, min, max, step, decimals = 0, onChange }) {
    const id = useId();
    return (
        <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={id} className="text-slate-300">{label}</label>
                <input
                    id={id}
                    type="number"
                    value={Number(value).toFixed(decimals)}
                    min={min} max={max} step={step}
                    // `valueAsNumber`, not `Number(e.target.value)`. A number
                    // input is DISPLAYED in the viewer's locale, so on a machine
                    // that writes decimals with a comma the field reads "1,60"
                    // and `Number()` returns NaN — the control would silently
                    // refuse everything typed into it. valueAsNumber is defined
                    // to do the locale-correct conversion.
                    onChange={(e) => {
                        const v = e.target.valueAsNumber;
                        if (Number.isFinite(v)) onChange(v);
                    }}
                    className="w-20 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-right font-mono text-slate-200"
                />
            </div>
            <input
                type="range"
                aria-label={label}
                value={value}
                min={min} max={max} step={step}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full accent-cyan-500"
            />
            {hint && <p className="text-[10px] text-slate-600">{hint}</p>}
        </div>
    );
}

export default ImageControls;
