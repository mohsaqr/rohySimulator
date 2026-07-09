import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Download,
  FileQuestion,
  Filter as FilterIcon,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { Card, CardBody } from './Card';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { SearchableSelect } from './SearchableSelect';
import { useTheme } from '../../hooks/useTheme';
import { getPageNumbers } from '../../utils/pagination';

/**
 * Generic instructor/admin list table. Client-side sort, per-column
 * filters, debounced global search, paginated footer with ellipses, and
 * a row-actions cell. Visual style matches CourseStudents.tsx so all
 * instructor lists share one look.
 */
export function DataTable({
  rows,
  columns,
  rowKey,
  createCta,
  secondaryCta,
  exportAction,
  globalSearch,
  pageSize = 20,
  isLoading,
  empty,
  rowActions,
  onRowClick,
}) {
  const { t } = useTranslation(['common']);
  const { isDark } = useTheme();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [columnFilters, setColumnFilters] = useState({});
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDir, setSortDir] = useState(null);
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);

  // Debounce global search.
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (globalSearch && search) {
      result = result.filter(r => globalSearch.predicate(r, search));
    }
    for (const col of columns) {
      const f = columnFilters[col.id];
      if (!f || !col.filter) continue;
      result = result.filter(r => col.filter.predicate(r, f));
    }
    return result;
  }, [rows, search, columnFilters, columns, globalSearch]);

  const sortedRows = useMemo(() => {
    if (!sortColumn || !sortDir) return filteredRows;
    const col = columns.find(c => c.id === sortColumn);
    if (!col?.sortAccessor) return filteredRows;
    const next = [...filteredRows];
    next.sort((a, b) => {
      const av = col.sortAccessor(a);
      const bv = col.sortAccessor(b);
      // Nulls sort to the bottom regardless of direction.
      const aNull = av == null || av === '';
      const bNull = bv == null || bv === '';
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      let cmp;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return next;
  }, [filteredRows, sortColumn, sortDir, columns]);

  const total = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Clamp current page when row count shrinks below it (e.g. after delete
  // or filter). Has to live in an effect so it survives React's batching.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);
  const pageRows = sortedRows.slice(rangeStart - 1, rangeEnd);
  const pageNumbers = getPageNumbers(page, totalPages);

  const headerColor = isDark ? '#94a3b8' : '#64748b';
  const borderColor = isDark ? '#334155' : '#e2e8f0';
  const subtleBorderColor = isDark ? '#1e293b' : '#f1f5f9';
  const filterableColumns = columns.filter(c => c.filter);
  const anyFiltersActive = Object.values(columnFilters).some(Boolean);

  const toggleSort = (colId) => {
    if (sortColumn !== colId) {
      setSortColumn(colId);
      setSortDir('asc');
      return;
    }
    if (sortDir === 'asc') {
      setSortDir('desc');
      return;
    }
    if (sortDir === 'desc') {
      setSortColumn(null);
      setSortDir(null);
    }
  };

  return (
    <Card>
      <CardBody>
        {/* Toolbar: global search (left) + Filter / Create CTA (right). */}
        {(globalSearch || createCta || secondaryCta || exportAction || filterableColumns.length > 0) && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
            {globalSearch ? (
              <div className="relative flex-1 max-w-sm">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                  style={{ color: headerColor }}
                />
                <input
                  type="text"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder={globalSearch.placeholder}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-offset-1"
                />
              </div>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              {filterableColumns.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterOpen(o => !o)}
                  aria-expanded={filterOpen}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <FilterIcon className="w-3.5 h-3.5" />
                  {t('common:filter', { defaultValue: 'Filter' })}
                  {anyFiltersActive && (
                    <span
                      className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: '#088F8F' }}
                    />
                  )}
                </button>
              )}
              {exportAction && (
                <button
                  type="button"
                  onClick={() => void exportAction.onClick()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  {exportAction.label ?? t('common:export', { defaultValue: 'Export' })}
                </button>
              )}
              {secondaryCta && (
                <Button
                  onClick={secondaryCta.onClick}
                  size="sm"
                  variant="secondary"
                  icon={secondaryCta.icon}
                >
                  {secondaryCta.label}
                </Button>
              )}
              {createCta && (
                <Button
                  onClick={createCta.onClick}
                  size="sm"
                  icon={createCta.icon ?? <Plus className="w-4 h-4" />}
                >
                  {createCta.label}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Inline filter card. Stacks the configured column filters
            between the toolbar and the table — toggled by the Filter
            button above. Same surface (white / dark gray) as the host
            card so it reads as one continuous block. */}
        {filterOpen && filterableColumns.length > 0 && (
          <div
            className="mb-4 rounded-xl border p-3 sm:p-4 bg-white dark:bg-slate-800"
            style={{ borderColor }}
          >
            <div className="flex items-center justify-between mb-3">
              <span
                className="text-sm font-semibold"
                style={{ color: isDark ? '#f1f5f9' : '#0f172a' }}
              >
                {t('common:filter', { defaultValue: 'Filter' })}
              </span>
              <div className="flex items-center gap-3">
                {anyFiltersActive && (
                  <button
                    type="button"
                    onClick={() => setColumnFilters({})}
                    className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                    {t('common:clear_all', { defaultValue: 'Clear all' })}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  aria-label={t('common:close', { defaultValue: 'Close' })}
                  className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filterableColumns.map(col => {
                const value = columnFilters[col.id] ?? '';
                const setValue = (v) =>
                  setColumnFilters(prev => {
                    const next = { ...prev };
                    if (v) next[col.id] = v;
                    else delete next[col.id];
                    return next;
                  });
                if (col.filter.kind === 'text' || col.filter.kind === 'date') {
                  const isDate = col.filter.kind === 'date';
                  return (
                    <div key={col.id}>
                      <label
                        className="block text-sm font-medium mb-1.5"
                        style={{ color: isDark ? '#cbd5e1' : '#334155' }}
                      >
                        {col.header}
                      </label>
                      <input
                        type={isDate ? 'date' : 'text'}
                        value={value}
                        onChange={e => {
                          setValue(e.target.value);
                          setPage(1);
                        }}
                        placeholder={
                          isDate ? undefined : col.filter.placeholder ?? col.header
                        }
                        className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-offset-1"
                      />
                    </div>
                  );
                }
                const selectFilter = col.filter;
                const options = [
                  { value: '', label: t('common:all', { defaultValue: 'All' }) },
                  ...selectFilter.options,
                ];
                return (
                  <div key={col.id}>
                    <label
                      className="block text-sm font-medium mb-1.5"
                      style={{ color: isDark ? '#cbd5e1' : '#334155' }}
                    >
                      {col.header}
                    </label>
                    <SearchableSelect
                      value={value}
                      onChange={v => {
                        setValue(v);
                        setPage(1);
                      }}
                      options={options}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Table or empty state */}
        {isLoading ? (
          <div className="space-y-2 py-4">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="h-10 rounded animate-pulse"
                style={{ backgroundColor: subtleBorderColor }}
              />
            ))}
          </div>
        ) : total === 0 ? (
          empty ?? (
            <EmptyState
              icon={FileQuestion}
              title={t('common:no_results', { defaultValue: 'No results' })}
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr
                  className="border-b text-left text-xs font-semibold"
                  style={{ borderColor, color: headerColor }}
                >
                  {columns.map(col => (
                    <HeaderCell
                      key={col.id}
                      col={col}
                      sortDir={sortColumn === col.id ? sortDir : null}
                      onToggleSort={() => toggleSort(col.id)}
                    />
                  ))}
                  {rowActions && (
                    <th
                      className="py-2 px-2 text-right"
                      style={{ width: '3rem' }}
                    >
                      <span className="sr-only">
                        {t('common:actions', { defaultValue: 'Actions' })}
                      </span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(row => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`border-b border-slate-100 dark:border-slate-800 ${
                      onRowClick
                        ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    {columns.map(col => (
                      <td
                        key={col.id}
                        className={`py-3 px-3 ${
                          col.hideOnMobile ? 'hidden sm:table-cell' : ''
                        } ${
                          col.align === 'right'
                            ? 'text-right'
                            : col.align === 'center'
                            ? 'text-center'
                            : ''
                        }`}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                    {rowActions && (
                      <td
                        className="py-3 px-2 text-right"
                        style={{ width: '3rem' }}
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1">
                          {rowActions(row)}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination footer */}
        {total > pageSize && (
          <div
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t"
            style={{ borderColor }}
          >
            <p className="text-xs" style={{ color: headerColor }}>
              {t('common:showing_range', {
                defaultValue: 'Showing {{from}}–{{to}} of {{total}}',
                from: rangeStart,
                to: rangeEnd,
                total,
              })}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t('common:previous', { defaultValue: 'Previous' })}
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {pageNumbers.map((p, idx) =>
                p === 'dots' ? (
                  <span
                    key={`dots-${idx}`}
                    className="px-2 text-xs text-slate-400 dark:text-slate-500 select-none"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    aria-current={p === page ? 'page' : undefined}
                    className={`min-w-[2rem] px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      p === page
                        ? 'bg-primary-600 border-primary-600 text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                type="button"
                aria-label={t('common:next', { defaultValue: 'Next' })}
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function HeaderCell({ col, sortDir, onToggleSort }) {
  const sortable = !!col.sortAccessor;
  return (
    <th
      className={`py-2 px-3 font-medium ${col.hideOnMobile ? 'hidden sm:table-cell' : ''} ${
        col.align === 'right'
          ? 'text-right'
          : col.align === 'center'
          ? 'text-center'
          : ''
      }`}
      style={{ width: col.width }}
      aria-sort={
        sortDir === 'asc'
          ? 'ascending'
          : sortDir === 'desc'
          ? 'descending'
          : 'none'
      }
    >
      {sortable ? (
        <button
          type="button"
          onClick={onToggleSort}
          className="inline-flex items-center gap-1 text-xs font-semibold hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
        >
          <span>{col.header}</span>
          {sortDir === 'asc' ? (
            <ChevronUp className="w-3 h-3" />
          ) : sortDir === 'desc' ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronsUpDown className="w-3 h-3 opacity-40" />
          )}
        </button>
      ) : (
        <span>{col.header}</span>
      )}
    </th>
  );
}
