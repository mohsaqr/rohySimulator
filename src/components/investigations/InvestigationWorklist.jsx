import { useTranslation } from 'react-i18next';
import { CheckCircle, ChevronRight, Clock, Eye, Inbox } from 'lucide-react';
import { formatDate, formatTime, formatDateTime } from '../../utils/formatters';

// Right-rail worklist used by InvestigationsScreen. Splits orders into
// Pending / Ready / Viewed cards so historical results stay reachable.
// Pure display — the parent owns polling and the open-stack state.
// `openOrderIds` is the Set of order ids currently shown as cards in
// the center column; rows for those orders render with the "selected"
// highlight so the student can see which ones are already on-screen.
export default function InvestigationWorklist({
    kind,
    theme,
    orders,
    openOrderIds,
    onSelectOrder,
}) {
    const { t } = useTranslation('investigations');
    const isOpen = (id) => openOrderIds?.has?.(id) ?? false;
    const pending = orders.filter((o) => !o.is_ready);
    const ready = orders.filter((o) => o.is_ready && !o.viewed_at);
    const viewed = orders.filter((o) => o.is_ready && o.viewed_at);
    const empty = orders.length === 0;

    return (
        <div className="flex flex-col h-full bg-slate-900/40 border-r border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/80 flex items-center gap-2">
                <Inbox className={`w-4 h-4 ${theme.accentText}`} />
                <h2 className="text-xs uppercase tracking-wider font-semibold text-slate-300">
                    {t('worklist')}
                </h2>
                <span className="ml-auto text-xs text-slate-500">{orders.length}</span>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {empty && (
                    <div className="flex flex-col items-center text-center text-slate-500 text-sm py-12 px-4">
                        <Inbox className="w-8 h-8 mb-2 opacity-40" />
                        <div>{kind === 'radiology' ? t('worklist_empty_radiology') : t('worklist_empty_lab')}</div>
                        <div className="text-xs mt-1 text-slate-600">{t('worklist_empty_hint')}</div>
                    </div>
                )}

                {ready.length > 0 && (
                    <Section title={t('stat_ready')} count={ready.length} icon={CheckCircle} tint="emerald">
                        {ready.map((order) => (
                            <ReadyRow
                                key={order.id}
                                order={order}
                                selected={isOpen(order.id)}
                                theme={theme}
                                onSelect={() => onSelectOrder(order)}
                            />
                        ))}
                    </Section>
                )}

                {pending.length > 0 && (
                    <Section title={t('stat_pending')} count={pending.length} icon={Clock} tint="amber">
                        {pending.map((order) => (
                            <PendingRow key={order.id} order={order} />
                        ))}
                    </Section>
                )}

                {viewed.length > 0 && (
                    <Section title={t('stat_viewed')} count={viewed.length} icon={Eye} tint="slate">
                        {viewed.map((order) => (
                            <ViewedRow
                                key={order.id}
                                order={order}
                                selected={isOpen(order.id)}
                                onSelect={() => onSelectOrder(order)}
                            />
                        ))}
                    </Section>
                )}
            </div>
        </div>
    );
}

const SECTION_STYLES = {
    emerald: { header: 'text-emerald-300', dot: 'bg-emerald-400' },
    amber:   { header: 'text-amber-300',   dot: 'bg-amber-400' },
    slate:   { header: 'text-slate-400',   dot: 'bg-slate-500' },
};

function Section({ title, count, icon: Icon, tint, children }) {
    const s = SECTION_STYLES[tint];
    return (
        <div>
            <div className="px-1 pb-2 flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                <Icon className={`w-3.5 h-3.5 ${s.header}`} />
                <span className={`text-[11px] uppercase tracking-widest font-bold ${s.header}`}>{title}</span>
                <span className="flex-1 h-px bg-slate-800" />
                <span className="text-[11px] text-slate-500">{count}</span>
            </div>
            <div className="space-y-1.5">{children}</div>
        </div>
    );
}

function PendingRow({ order }) {
    const { t } = useTranslation('investigations');
    const remaining = pendingLabel(t, order);
    return (
        <div className="p-2.5 rounded-lg border-l-[3px] border-l-amber-500 border border-amber-700/30 bg-amber-900/15">
            <div className="text-sm font-medium text-white truncate">{order.test_name}</div>
            <div className="text-[11px] text-amber-300 mt-0.5 flex items-center gap-1.5 font-mono">
                <Clock className="w-3 h-3" />
                {remaining}
            </div>
        </div>
    );
}

function ReadyRow({ order, selected, theme, onSelect }) {
    const { t } = useTranslation('investigations');
    const baseClass = selected
        ? `border-l-[3px] ${theme.accentRail} border border-emerald-400/60 bg-emerald-900/30 ${theme.glow}`
        : 'border-l-[3px] border-l-emerald-500 border border-emerald-700/40 bg-emerald-900/15 hover:bg-emerald-900/25';
    return (
        <button
            onClick={onSelect}
            className={`w-full text-left p-2.5 rounded-lg transition-all flex items-center gap-2 ${baseClass}`}
        >
            <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">{order.test_name}</div>
                <div className="text-[11px] text-emerald-300 mt-0.5">
                    {selected ? t('showing_in_viewer') : t('tap_to_open')}
                </div>
            </div>
            <ChevronRight className={`w-4 h-4 ${selected ? 'text-emerald-200' : 'text-emerald-500'}`} />
        </button>
    );
}

function ViewedRow({ order, selected, onSelect }) {
    const { t } = useTranslation('investigations');
    const baseClass = selected
        ? 'bg-slate-700/60 border border-slate-500'
        : 'border border-transparent hover:bg-slate-800/60';
    return (
        <button
            onClick={onSelect}
            className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors text-sm ${baseClass}`}
        >
            <div className="text-slate-200 truncate">{order.test_name}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
                {t('viewed_when', { when: formatRelative(t, order.viewed_at) })}
            </div>
        </button>
    );
}

// SQLite emits "YYYY-MM-DD HH:MM:SS" with NO timezone marker — it is UTC,
// but `new Date()` parses that space-separated form as LOCAL time. That
// skew is exactly Bug 4: in a UTC-offset timezone the local parse lands
// in the past, so a still-pending order printed the literal "Ready". Any
// client-side math on these strings must normalise to UTC first.
function parseSqliteUtc(ts) {
    if (!ts) return NaN;
    // Already has tz info (ISO 'Z' or ±HH:MM) → trust it.
    if (/[zZ]|[+-]\d\d:?\d\d$/.test(ts)) return new Date(ts).getTime();
    return new Date(`${String(ts).replace(' ', 'T')}Z`).getTime();
}

// Pending rows are filtered to !is_ready (server truth). The label must
// therefore NEVER say "Ready" — it derives from the server-computed
// minutes_remaining, not a re-parsed timestamp.
function pendingLabel(t, order) {
    const mins = Number(order?.minutes_remaining);
    if (Number.isFinite(mins) && mins > 0) {
        if (mins >= 1) return t('pending_minutes_remaining', { count: Math.ceil(mins) });
        return t('pending_under_minute');
    }
    // minutes_remaining absent or 0 but the server still has it pending
    // (rounding / poll lag): show a truthful transient, not "Ready".
    const at = parseSqliteUtc(order?.available_at);
    if (Number.isFinite(at)) {
        const diff = at - Date.now();
        if (diff > 0) {
            const m = Math.floor(diff / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            return t('pending_countdown', { time: `${m}:${s.toString().padStart(2, '0')}` });
        }
    }
    return t('finalizing');
}

function formatRelative(t, timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - parseSqliteUtc(timestamp);
    if (diff < 60_000) return t('relative_just_now');
    if (diff < 3_600_000) return t('relative_minutes_ago', { count: Math.floor(diff / 60_000) });
    if (diff < 86_400_000) return t('relative_hours_ago', { count: Math.floor(diff / 3_600_000) });
    return formatDate(timestamp);
}
