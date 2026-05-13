import { CheckCircle, ChevronRight, Clock, Eye, Inbox } from 'lucide-react';

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
                    Worklist
                </h2>
                <span className="ml-auto text-xs text-slate-500">{orders.length}</span>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {empty && (
                    <div className="flex flex-col items-center text-center text-slate-500 text-sm py-12 px-4">
                        <Inbox className="w-8 h-8 mb-2 opacity-40" />
                        <div>No {kind === 'radiology' ? 'studies' : 'tests'} ordered yet.</div>
                        <div className="text-xs mt-1 text-slate-600">Pick from the catalogue on the left.</div>
                    </div>
                )}

                {ready.length > 0 && (
                    <Section title="Ready" count={ready.length} icon={CheckCircle} tint="emerald">
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
                    <Section title="Pending" count={pending.length} icon={Clock} tint="amber">
                        {pending.map((order) => (
                            <PendingRow key={order.id} order={order} />
                        ))}
                    </Section>
                )}

                {viewed.length > 0 && (
                    <Section title="Viewed" count={viewed.length} icon={Eye} tint="slate">
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
    const remaining = getTimeRemaining(order.available_at);
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
                    {selected ? 'Showing in viewer →' : 'Tap to open report'}
                </div>
            </div>
            <ChevronRight className={`w-4 h-4 ${selected ? 'text-emerald-200' : 'text-emerald-500'}`} />
        </button>
    );
}

function ViewedRow({ order, selected, onSelect }) {
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
                Viewed {formatRelative(order.viewed_at)}
            </div>
        </button>
    );
}

function getTimeRemaining(availableAt) {
    if (!availableAt) return 'Ready soon';
    const diff = new Date(availableAt).getTime() - Date.now();
    if (diff <= 0) return 'Ready';
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')} remaining`;
}

function formatRelative(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - new Date(timestamp).getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
}
