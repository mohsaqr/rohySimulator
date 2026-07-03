// LogGrid — single data-grid component for every log surface.
//
// Each log tab (Activity / System Log / Chat Log / Sessions) mounts this
// with its own `columns` config and a fetch function. The mechanics —
// sorting, column visibility, density, sticky header, expand row,
// click-to-copy, paginated load-more, search box — live here so every
// surface has identical UX.
//
// Built on TanStack Table v8 (headless). All markup + Tailwind classes
// are local so the dark theme matches the rest of Settings.

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    flexRender,
} from '@tanstack/react-table';
import {
    Loader2, RefreshCw, Search, Eye,
    ChevronUp, ChevronDown, Rows3, Rows4, Check,
} from 'lucide-react';

const DEFAULT_PAGE_SIZE = 100;
const PAGE_STEPS = [100, 500, 2000, 10000];

// Exact, case-insensitive, type-tolerant equality for select-based
// per-column filters (null-safe; numbers compared via String()).
function exactValueFilterFn(row, columnId, filterValue) {
    return String(row.getValue(columnId) ?? '').toLowerCase() === String(filterValue).toLowerCase();
}

// Click any cell to copy its value. Visual confirmation lasts ~1s, then
// reverts. Only fires on simple values — clicking inside an expand
// chevron or a link wouldn't trigger because event.stopPropagation in
// the rendered cell takes precedence.
function CopyableCell({ value, className = '', children }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback((e) => {
        if (value === null || value === undefined || value === '') return;
        e.stopPropagation();
        navigator.clipboard?.writeText(String(value)).then(
            () => { setCopied(true); setTimeout(() => setCopied(false), 900); },
            () => {},
        );
    }, [value]);
    return (
        <span
            onClick={handleCopy}
            className={`cursor-pointer select-text inline-flex items-center gap-1 ${className}`}
            title={copied ? 'Copied' : 'Click to copy'}
        >
            {children ?? (value ?? '—')}
            {copied && <Check className="w-3 h-3 text-emerald-400 inline" />}
        </span>
    );
}

// Per-column quick filter row sitting under the header. Each cell is
// either a free-text contains filter or a select if the column declares
// `meta.filterOptions` — a static array OR a `(rows) => options` function
// evaluated against the currently-loaded data, so options track what's
// actually in the table. Options may be plain strings or
// `{ value, label }` objects (label shown, value filtered on).
function FilterRow({ table, density, data }) {
    const cells = table.getVisibleLeafColumns();
    return (
        <tr className={`bg-neutral-850 ${density === 'compact' ? '' : 'h-8'}`}>
            {cells.map((col) => {
                const meta = col.columnDef.meta || {};
                if (meta.filterable === false) {
                    return <td key={col.id} className="px-2 py-1 border-b border-neutral-800" />;
                }
                const value = col.getFilterValue() ?? '';
                if (meta.filterOptions) {
                    const raw = typeof meta.filterOptions === 'function'
                        ? meta.filterOptions(data)
                        : meta.filterOptions;
                    const options = (raw || []).map((o) => (
                        o !== null && typeof o === 'object'
                            ? { value: String(o.value), label: String(o.label ?? o.value) }
                            : { value: String(o), label: String(o) }
                    ));
                    return (
                        <td key={col.id} className="px-2 py-1 border-b border-neutral-800">
                            <select
                                value={value}
                                onChange={(e) => col.setFilterValue(e.target.value || undefined)}
                                className="w-full bg-neutral-900 border border-neutral-700 rounded text-xs px-1 py-0.5 text-neutral-200"
                            >
                                <option value="">(any)</option>
                                {options.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </td>
                    );
                }
                return (
                    <td key={col.id} className="px-2 py-1 border-b border-neutral-800">
                        <input
                            type="text"
                            value={value}
                            onChange={(e) => col.setFilterValue(e.target.value || undefined)}
                            placeholder="filter…"
                            className="w-full bg-neutral-900 border border-neutral-700 rounded text-xs px-1 py-0.5 text-neutral-200"
                        />
                    </td>
                );
            })}
        </tr>
    );
}

export default function LogGrid({
    columns,                  // TanStack ColumnDef[] (optional meta.filterOptions: array | (rows) => array of strings or {value,label}; meta.filterable=false)
    data,                     // row array
    loading = false,
    error = null,
    onRefresh,                // () => void | Promise<void>
    onLoadMore,               // (newLimit: number) => void
    currentLimit = DEFAULT_PAGE_SIZE,
    totalKnown,               // optional: when server returns a total count
    initialSorting = [],
    initialColumnVisibility = {},
    expandRender,             // (row) => ReactNode rendered as the expanded panel under a row
    headerActions,            // ReactNode or ({ visibleRows, visibleCount, totalRows, table }) => ReactNode injected on the toolbar
    headerExtras,             // ReactNode injected to the left of the search input (date pickers etc.)
    emptyMessage = 'No rows recorded yet.',
    storageKey,               // when set, density + visibility persist in localStorage
}) {
    const [globalFilter, setGlobalFilter] = useState('');
    const [sorting, setSorting] = useState(initialSorting);
    const [density, setDensity] = useState(() => {
        if (!storageKey) return 'compact';
        return localStorage.getItem(`${storageKey}.density`) || 'compact';
    });
    const [columnVisibility, setColumnVisibility] = useState(() => {
        if (!storageKey) return initialColumnVisibility;
        try {
            const stored = localStorage.getItem(`${storageKey}.visibility`);
            return stored ? { ...initialColumnVisibility, ...JSON.parse(stored) } : initialColumnVisibility;
        } catch { return initialColumnVisibility; }
    });
    const [columnSizing, setColumnSizing] = useState({});
    const [showFilterRow, setShowFilterRow] = useState(false);
    const [showColMenu, setShowColMenu] = useState(false);
    const [expanded, setExpanded] = useState(() => new Set());

    // Persist density / column visibility per surface.
    useEffect(() => {
        if (storageKey) localStorage.setItem(`${storageKey}.density`, density);
    }, [storageKey, density]);
    useEffect(() => {
        if (storageKey) localStorage.setItem(`${storageKey}.visibility`, JSON.stringify(columnVisibility));
    }, [storageKey, columnVisibility]);

    // Columns whose quick filter is a select get exact (case-insensitive)
    // matching instead of the free-text contains default — selecting
    // "CHECKED" must not also match "CHECKED_VITALS". Columns that declare
    // their own filterFn keep it. (Not TanStack's 'equalsString': that
    // calls .toLowerCase() on the raw cell value and would throw on
    // numbers/null.)
    const resolvedColumns = useMemo(
        () => columns.map((col) => (
            col.meta?.filterOptions && !col.filterFn
                ? { ...col, filterFn: exactValueFilterFn }
                : col
        )),
        [columns],
    );

    // TanStack Table owns its internal function identity; this headless grid
    // intentionally follows the library API and does not pass the instance
    // into memoized children.
    // eslint-disable-next-line react-hooks/incompatible-library
    const table = useReactTable({
        data,
        columns: resolvedColumns,
        state: { globalFilter, sorting, columnVisibility, columnSizing },
        onGlobalFilterChange: setGlobalFilter,
        onSortingChange: setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        columnResizeMode: 'onChange',
        enableColumnResizing: true,
        // Search across every visible column. Default contains-match,
        // case-insensitive. Numbers are coerced to string.
        globalFilterFn: (row, _id, search) => {
            const q = String(search || '').toLowerCase();
            if (!q) return true;
            return row.getAllCells().some((cell) => {
                const v = cell.getValue();
                if (v === null || v === undefined) return false;
                return String(v).toLowerCase().includes(q);
            });
        },
    });

    const rowModel = table.getRowModel();
    const visibleRows = rowModel.rows.map((row) => row.original);
    const visibleCount = rowModel.rows.length;
    const totalRows = data.length;
    const renderedHeaderActions = typeof headerActions === 'function'
        ? headerActions({ visibleRows, visibleCount, totalRows, table })
        : headerActions;

    const toggleExpand = (rowId) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(rowId)) next.delete(rowId);
            else next.add(rowId);
            return next;
        });
    };

    const cellPad = density === 'compact' ? 'px-2 py-0.5' : 'px-3 py-1.5';
    const headPad = density === 'compact' ? 'px-2 py-1' : 'px-3 py-2';

    return (
        <div className="flex flex-col h-full bg-neutral-900 text-white">
            {/* Toolbar */}
            <div className="flex flex-col gap-2 p-3 border-b border-neutral-700 bg-neutral-800">
                <div className="flex items-center gap-2 flex-wrap">
                    {headerExtras}
                    <div className="relative flex-1 min-w-[180px]">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                        <input
                            type="text"
                            value={globalFilter}
                            onChange={(e) => setGlobalFilter(e.target.value)}
                            placeholder="Search any column…"
                            className="w-full pl-9 pr-3 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-sm"
                        />
                    </div>

                    <button
                        onClick={() => setShowFilterRow((v) => !v)}
                        title={showFilterRow ? 'Hide per-column filters' : 'Show per-column filters'}
                        className={`px-2 py-1.5 rounded text-xs flex items-center gap-1 border ${
                            showFilterRow
                                ? 'bg-cyan-700 border-cyan-600 text-white'
                                : 'bg-neutral-700 border-neutral-600 hover:bg-neutral-600 text-neutral-200'
                        }`}
                    >
                        <Search className="w-3 h-3" /> Cols
                    </button>

                    <div className="relative">
                        <button
                            onClick={() => setShowColMenu((v) => !v)}
                            title="Show / hide columns"
                            className="px-2 py-1.5 rounded text-xs flex items-center gap-1 bg-neutral-700 border border-neutral-600 hover:bg-neutral-600 text-neutral-200"
                        >
                            <Eye className="w-3 h-3" /> Columns
                        </button>
                        {showColMenu && (
                            <div className="absolute right-0 top-full mt-1 z-30 bg-neutral-900 border border-neutral-700 rounded shadow-lg p-2 max-h-80 overflow-auto min-w-[200px]">
                                {table.getAllLeafColumns().map((col) => (
                                    <label key={col.id} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer hover:bg-neutral-800 px-1 rounded">
                                        <input
                                            type="checkbox"
                                            checked={col.getIsVisible()}
                                            onChange={col.getToggleVisibilityHandler()}
                                        />
                                        <span className="text-neutral-200">
                                            {typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id}
                                        </span>
                                    </label>
                                ))}
                                <div className="border-t border-neutral-800 mt-1 pt-1 flex gap-1">
                                    <button
                                        onClick={() => table.toggleAllColumnsVisible(true)}
                                        className="flex-1 text-xs py-0.5 hover:bg-neutral-800 rounded text-neutral-300"
                                    >
                                        All
                                    </button>
                                    <button
                                        onClick={() => table.toggleAllColumnsVisible(false)}
                                        className="flex-1 text-xs py-0.5 hover:bg-neutral-800 rounded text-neutral-300"
                                    >
                                        None
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))}
                        title={density === 'compact' ? 'Switch to comfortable rows' : 'Switch to compact rows'}
                        className="px-2 py-1.5 rounded text-xs flex items-center gap-1 bg-neutral-700 border border-neutral-600 hover:bg-neutral-600 text-neutral-200"
                    >
                        {density === 'compact' ? <Rows4 className="w-3 h-3" /> : <Rows3 className="w-3 h-3" />}
                        {density === 'compact' ? 'Compact' : 'Comfortable'}
                    </button>

                    {onRefresh && (
                        <button
                            onClick={onRefresh}
                            disabled={loading}
                            className="px-2 py-1.5 bg-neutral-700 hover:bg-neutral-600 border border-neutral-600 rounded text-xs flex items-center gap-1 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                    )}

                    {renderedHeaderActions}

                    <span className="text-xs text-neutral-400 whitespace-nowrap ml-auto">
                        {visibleCount === totalRows
                            ? `${totalRows.toLocaleString()} rows`
                            : `${visibleCount.toLocaleString()} of ${totalRows.toLocaleString()}`}
                        {totalKnown != null && totalKnown > totalRows && ` (server: ${totalKnown.toLocaleString()})`}
                    </span>
                </div>
            </div>

            {error && (
                <div className="p-3 bg-red-900/40 border-b border-red-700 text-red-200 text-sm">
                    {error}
                </div>
            )}

            {/* Grid body */}
            <div className="flex-1 overflow-auto relative">
                {loading && data.length === 0 ? (
                    <div className="p-12 text-center text-neutral-400">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                        Loading…
                    </div>
                ) : visibleCount === 0 ? (
                    <div className="p-12 text-center text-neutral-500 text-sm">
                        {totalRows === 0 ? emptyMessage : 'No rows match the current filters.'}
                    </div>
                ) : (
                    <table className="text-xs border-separate border-spacing-0" style={{ width: table.getTotalSize() }}>
                        <thead className="bg-neutral-800 sticky top-0 z-20">
                            {table.getHeaderGroups().map((hg) => (
                                <tr key={hg.id}>
                                    {hg.headers.map((header) => {
                                        const canSort = header.column.getCanSort();
                                        const sorted = header.column.getIsSorted();
                                        return (
                                            <th
                                                key={header.id}
                                                style={{ width: header.getSize() }}
                                                className={`${headPad} text-left font-semibold text-neutral-200 border-b border-neutral-700 relative whitespace-nowrap ${
                                                    canSort ? 'cursor-pointer select-none hover:text-white' : ''
                                                }`}
                                                onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                                            >
                                                <span className="inline-flex items-center gap-1">
                                                    {flexRender(header.column.columnDef.header, header.getContext())}
                                                    {sorted === 'asc' && <ChevronUp className="w-3 h-3 text-cyan-400" />}
                                                    {sorted === 'desc' && <ChevronDown className="w-3 h-3 text-cyan-400" />}
                                                </span>
                                                {header.column.getCanResize() && (
                                                    <span
                                                        onMouseDown={header.getResizeHandler()}
                                                        onTouchStart={header.getResizeHandler()}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none bg-transparent hover:bg-cyan-500/50"
                                                    />
                                                )}
                                            </th>
                                        );
                                    })}
                                </tr>
                            ))}
                            {showFilterRow && <FilterRow table={table} density={density} data={data} />}
                        </thead>
                        <tbody>
                            {rowModel.rows.map((row) => {
                                const rowKey = row.id;
                                const isExpanded = expanded.has(rowKey);
                                return (
                                    <ExpandableRow
                                        key={rowKey}
                                        row={row}
                                        isExpanded={isExpanded}
                                        onToggle={() => toggleExpand(rowKey)}
                                        cellPad={cellPad}
                                        expandRender={expandRender}
                                    />
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {onLoadMore && data.length >= currentLimit && (
                <div className="px-3 py-2 border-t border-neutral-700 bg-neutral-800 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-neutral-400">
                        Cap reached ({currentLimit.toLocaleString()}). Load more:
                    </span>
                    {PAGE_STEPS.filter((n) => n > currentLimit).map((n) => (
                        <button
                            key={n}
                            onClick={() => onLoadMore(n)}
                            disabled={loading}
                            className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-xs disabled:opacity-50"
                        >
                            {n.toLocaleString()}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// Split into its own component so the row's `useState` for the
// per-row expanded-content stays scoped — keeps re-renders tight when
// one row expands and the rest don't need to update their cells.
function ExpandableRow({ row, isExpanded, onToggle, cellPad, expandRender }) {
    const cells = row.getVisibleCells();
    const colCount = cells.length;
    const expandable = !!expandRender;
    return (
        <>
            <tr
                className={`hover:bg-neutral-800/60 ${expandable ? 'cursor-pointer' : ''}`}
                onClick={expandable ? onToggle : undefined}
            >
                {cells.map((cell) => (
                    <td
                        key={cell.id}
                        style={{ width: cell.column.getSize() }}
                        className={`${cellPad} border-b border-neutral-800/60 align-top text-neutral-200`}
                    >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                ))}
            </tr>
            {isExpanded && expandable && (
                <tr className="bg-neutral-950 border-b border-neutral-800">
                    <td colSpan={colCount} className="px-4 py-3">
                        {expandRender(row.original)}
                    </td>
                </tr>
            )}
        </>
    );
}

// Re-export the copyable cell helper so column definitions can wrap
// values in <CopyableCell value={x}>{x}</CopyableCell> without each
// surface importing from their own helper file.
export { CopyableCell };
