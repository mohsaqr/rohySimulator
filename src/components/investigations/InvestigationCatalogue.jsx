import { Check, Filter, Loader2, Plus, Search, Zap } from 'lucide-react';

// Left-rail catalogue used by InvestigationsScreen for both labs and
// radiology. Pure display — fetching, polling, and the actual order
// POST live in the parent screen. `theme` carries the modality accent
// colors so lab can be purple and radiology cyan without duplication.
export default function InvestigationCatalogue({
    kind,
    theme,
    items,
    groups,
    orders,
    selectedIds,
    onToggleSelect,
    searchQuery,
    onSearchChange,
    groupFilter,
    onGroupFilterChange,
    loading,
    onSubmit,
    onSubmitInstant,
}) {
    const filtered = items.filter((item) => {
        const matchesSearch = !searchQuery
            || item.test_name.toLowerCase().includes(searchQuery.toLowerCase())
            || (item.test_group || '').toLowerCase().includes(searchQuery.toLowerCase());
        const matchesGroup = groupFilter === 'all' || item.test_group === groupFilter;
        return matchesSearch && matchesGroup;
    });
    const grouped = groupByTestGroup(filtered);

    const KindIcon = theme.kindIcon;
    const placeholder = kind === 'radiology'
        ? 'Search studies (CT, MRI, X-ray…)'
        : 'Search tests (glucose, CBC, sodium…)';

    return (
        <div className="flex flex-col h-full bg-slate-900/60 border-r border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/80">
                <div className="flex items-center gap-2 mb-3">
                    <KindIcon className={`w-4 h-4 ${theme.accentText}`} />
                    <h2 className="text-xs uppercase tracking-wider font-semibold text-slate-300">
                        {theme.label} catalogue
                    </h2>
                    <span className="ml-auto text-xs text-slate-500">{items.length}</span>
                </div>
                <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder={placeholder}
                        className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none transition-colors"
                    />
                </div>
                <div className="relative">
                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <select
                        value={groupFilter}
                        onChange={(e) => onGroupFilterChange(e.target.value)}
                        className="w-full pl-9 pr-8 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:border-cyan-500 focus:outline-none appearance-none cursor-pointer transition-colors"
                    >
                        <option value="all">All groups</option>
                        {groups.map((group) => (
                            <option key={group} value={group}>
                                {group} ({items.filter((i) => i.test_group === group).length})
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center text-center text-slate-500 text-sm py-12 px-4">
                        <Search className="w-8 h-8 mb-2 opacity-40" />
                        {searchQuery ? `Nothing matches "${searchQuery}"` : 'No items available'}
                    </div>
                ) : Object.entries(grouped).map(([group, groupItems]) => (
                    <div key={group}>
                        <div className="px-1 pb-1.5 flex items-center gap-2">
                            <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500">{group}</span>
                            <span className="flex-1 h-px bg-slate-800" />
                            <span className="text-[10px] text-slate-600">{groupItems.length}</span>
                        </div>
                        <div className="space-y-1.5">
                            {groupItems.map((item) => (
                                <CatalogueRow
                                    key={item.id}
                                    item={item}
                                    kind={kind}
                                    theme={theme}
                                    isSelected={selectedIds.includes(item.id)}
                                    alreadyOrdered={orders.some((o) => orderMatchesItem(o, item, kind))}
                                    onToggle={() => onToggleSelect(item.id)}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {selectedIds.length > 0 && (
                <div className="p-3 border-t border-slate-800 bg-slate-900/80 flex flex-col gap-2">
                    <button
                        onClick={onSubmit}
                        disabled={loading}
                        className={`w-full px-4 py-2.5 ${theme.accentBg} disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors shadow-lg`}
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Ordering…
                            </>
                        ) : (
                            <>
                                <Plus className="w-4 h-4" />
                                Order {selectedIds.length} {pluralize(kind, selectedIds.length)}
                            </>
                        )}
                    </button>
                    {onSubmitInstant && (
                        <button
                            onClick={onSubmitInstant}
                            disabled={loading}
                            title="Skip the wait — results land in the worklist immediately"
                            className="w-full px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-700/50 disabled:cursor-not-allowed text-slate-200 border border-slate-700 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                        >
                            <Zap className="w-3.5 h-3.5 text-amber-300" />
                            Order instantly
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function CatalogueRow({ item, kind, theme, isSelected, alreadyOrdered, onToggle }) {
    const railClass = alreadyOrdered
        ? 'border-l-cyan-600/60'
        : isSelected
            ? theme.accentRail
            : 'border-l-transparent';
    const bgClass = alreadyOrdered
        ? 'bg-slate-800/30 opacity-60'
        : isSelected
            ? theme.accentRow
            : 'bg-slate-800/50 hover:bg-slate-800';
    return (
        <label
            className={`flex items-start gap-3 pl-2.5 pr-3 py-2.5 rounded-lg border border-slate-700/70 border-l-[3px] ${railClass} ${bgClass} cursor-pointer transition-all`}
        >
            <input
                type="checkbox"
                checked={isSelected}
                onChange={onToggle}
                disabled={alreadyOrdered}
                className="mt-0.5 w-4 h-4 accent-cyan-500"
            />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate leading-tight">{item.test_name}</div>
                <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-1">
                    {item.body_region && kind === 'radiology' && (
                        <span className="text-slate-500">{item.body_region}</span>
                    )}
                    {item.turnaround_minutes ? (
                        <span className="inline-flex items-center gap-1">
                            <span className="text-slate-500">{item.turnaround_minutes}m</span>
                        </span>
                    ) : null}
                    {alreadyOrdered && (
                        <span className="inline-flex items-center gap-1 text-cyan-300">
                            <Check className="w-3 h-3" /> ordered
                        </span>
                    )}
                </div>
            </div>
        </label>
    );
}

function groupByTestGroup(items) {
    return items.reduce((acc, item) => {
        const key = item.test_group || 'Other';
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});
}

function orderMatchesItem(order, item, kind) {
    if (kind === 'radiology') {
        return order.radiology_id === item.id || order.study_id === item.id;
    }
    return order.investigation_id === item.id || order.lab_id === item.id;
}

function pluralize(kind, n) {
    if (kind === 'radiology') return n === 1 ? 'study' : 'studies';
    return n === 1 ? 'test' : 'tests';
}
