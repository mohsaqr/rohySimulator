// The Learning Analytics dashboard's own card language — stat cards, the grid
// they sit in, and the titled panel every chart and table lives in.
//
// Extracted from TnaDashboardV2 so the Text and Voice tabs (signals/) draw with
// the same pieces as Activity and Network rather than a look-alike copy.
// Chrome only: the accent colours tint an icon tile, they never carry meaning.
//
// English-only by design, like the rest of src/components/analytics/**.

import React from 'react';

const ACCENTS = {
    cyan: 'from-cyan-50 to-white text-cyan-700 ring-cyan-100',
    green: 'from-emerald-50 to-white text-emerald-700 ring-emerald-100',
    amber: 'from-amber-50 to-white text-amber-700 ring-amber-100',
    teal: 'from-teal-50 to-white text-teal-700 ring-teal-100',
    rose: 'from-rose-50 to-white text-rose-700 ring-rose-100',
    slate: 'from-slate-50 to-white text-slate-700 ring-slate-100',
};

/**
 * One headline figure. `detail` is a short line under the value; it truncates
 * to one line unless `wrapDetail` is set (for context that must stay readable,
 * such as a quartile range).
 */
export function StatCard({ icon, label, value, detail = null, accent = 'cyan', title, wrapDetail = false }) {
    return (
        <div className="group relative overflow-hidden rounded-md border border-gray-200 bg-gradient-to-br from-white to-gray-50 px-4 py-3 shadow-sm" title={title}>
            <div className="flex items-start gap-3">
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-md bg-gradient-to-br ring-1 ${ACCENTS[accent] || ACCENTS.cyan}`}>
                    {icon}
                </div>
                <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</div>
                    <div className="mt-1 text-2xl font-semibold leading-none tabular-nums text-gray-950">{value}</div>
                    {detail && (
                        <div className={`mt-1 text-xs font-medium text-gray-500 ${wrapDetail ? '' : 'truncate'}`}>{detail}</div>
                    )}
                </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-gray-900/5 group-hover:bg-gray-900/10" />
        </div>
    );
}

/** `base` sets the small/medium breakpoints, `cols` the large one. */
export function MetricGrid({ children, cols = 'lg:grid-cols-5', base = 'sm:grid-cols-2 md:grid-cols-3' }) {
    return (
        <div className={`grid grid-cols-1 gap-3 ${base} ${cols}`}>
            {children}
        </div>
    );
}

/** A titled white panel. `description` is one line of plain context under the title. */
export function Panel({ title, description = null, actions, children, className = '', bodyClassName = '' }) {
    return (
        <section className={`min-w-0 rounded-md border border-gray-200 bg-white ${className}`}>
            {(title || actions) && (
                <div className={`flex min-h-11 flex-wrap justify-between gap-x-3 gap-y-2 border-b border-gray-100 px-4 py-3 ${description ? 'items-start' : 'items-center'}`}>
                    {title ? (
                        <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                            {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
                        </div>
                    ) : <span />}
                    {actions}
                </div>
            )}
            <div className={`p-4 ${bodyClassName}`}>{children}</div>
        </section>
    );
}
