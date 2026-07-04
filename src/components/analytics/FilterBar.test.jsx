// CONTRACT: FilterBar is the shared contextual filter bar every log table
// mounts above its LogGrid. These tests lock:
//
//   1. deriveOptions — distinct options from loaded rows: label = display
//      NAME, value = internal id, counts per option, label-sorted.
//   2. applyClientFilters — selecting a student's user_id keeps only that
//      student's rows; inactive ('') keys are ignored.
//   3. filterByDateRange — from/to native-date-input strings, `to`
//      inclusive of the whole day; unparseable timestamps are never hidden.
//   4. deriveSessionOptions + contextual narrowing — session options narrow
//      to the selected case/student and carry readable labels
//      ("Attempt 2 — <case> — <time>"), never bare ids.
//   5. useOptionMemory — options seen before a server-param refetch survive
//      it (so picking a student doesn't collapse the dropdown to one entry).
//   6. The component — options render with counts, picking an option fires
//      onChange(key, internal id), typing filters the list, keyboard
//      up/down/enter selects, Escape closes, chips remove one filter,
//      "Clear all" fires onClearAll.

import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import FilterBar, {
    applyClientFilters,
    contextualOptions,
    deriveOptions,
    deriveSessionOptions,
    filterByDateRange,
    uniqueValues,
    useOptionMemory,
} from './FilterBar';

const ROWS = [
    { user_id: 7, username: 'alice', case_id: 1, case_name: 'Chest pain', session_id: 11, attempt: 1, timestamp: '2026-06-30T14:02:00', verb: 'VIEWED' },
    { user_id: 7, username: 'alice', case_id: 1, case_name: 'Chest pain', session_id: 11, attempt: 1, timestamp: '2026-06-30T14:05:00', verb: 'CHECKED' },
    { user_id: 7, username: 'alice', case_id: 2, case_name: 'Sepsis', session_id: 12, attempt: 1, timestamp: '2026-07-01T09:00:00', verb: 'VIEWED' },
    { user_id: 9, username: 'bob', case_id: 1, case_name: 'Chest pain', session_id: 13, attempt: 1, timestamp: '2026-06-28T10:00:00', verb: 'ORDERED' },
    { user_id: 9, username: 'bob', case_id: 1, case_name: 'Chest pain', session_id: 14, attempt: 2, timestamp: '2026-06-29T11:30:00', verb: 'VIEWED' },
];

const ACCESSORS = {
    user_id: (r) => r.user_id,
    case_id: (r) => r.case_id,
    verb: (r) => r.verb,
};

describe('deriveOptions', () => {
    it('derives distinct name-labelled options with counts, sorted by label', () => {
        const options = deriveOptions(ROWS, (r) => r.user_id, (r) => r.username);
        expect(options).toEqual([
            { value: '7', label: 'alice', count: 3 },
            { value: '9', label: 'bob', count: 2 },
        ]);
    });

    it('skips rows with a null/empty value', () => {
        const options = deriveOptions(
            [...ROWS, { user_id: null, username: 'ghost' }],
            (r) => r.user_id, (r) => r.username,
        );
        expect(options.map((o) => o.label)).toEqual(['alice', 'bob']);
    });

    it('explodes array-valued options for multi-course rows', () => {
        const rows = [
            { course_ids: ['1', '2'], course_names: ['Cardio', 'Neuro'] },
            { course_ids: ['2'], course_names: ['Neuro'] },
        ];
        const options = deriveOptions(rows, (r) => r.course_ids, (r, value) => {
            const idx = r.course_ids.indexOf(value);
            return r.course_names[idx];
        });
        expect(options).toEqual([
            { value: '1', label: 'Cardio', count: 1 },
            { value: '2', label: 'Neuro', count: 2 },
        ]);
    });
});

describe('uniqueValues', () => {
    it('returns sorted distinct values for per-column select filters', () => {
        expect(uniqueValues(ROWS, (r) => r.verb)).toEqual(['CHECKED', 'ORDERED', 'VIEWED']);
    });
});

describe('applyClientFilters', () => {
    it('keeps only the selected student rows', () => {
        const out = applyClientFilters(ROWS, ACCESSORS, { user_id: '7' });
        expect(out).toHaveLength(3);
        expect(out.every((r) => r.user_id === 7)).toBe(true);
    });

    it('combines active filters and ignores empty ones', () => {
        const out = applyClientFilters(ROWS, ACCESSORS, { user_id: '9', verb: 'VIEWED', case_id: '' });
        expect(out).toHaveLength(1);
        expect(out[0].session_id).toBe(14);
    });

    it('matches array-valued accessors by membership', () => {
        const rows = [
            { id: 1, course_ids: ['1', '2'] },
            { id: 2, course_ids: ['3'] },
        ];
        const out = applyClientFilters(rows, { course_id: (r) => r.course_ids }, { course_id: '2' });
        expect(out.map((r) => r.id)).toEqual([1]);
    });

    it('returns rows untouched when nothing is active', () => {
        expect(applyClientFilters(ROWS, ACCESSORS, {})).toBe(ROWS);
    });
});

describe('filterByDateRange', () => {
    it('applies from/to with `to` inclusive of that whole day', () => {
        const out = filterByDateRange(ROWS, (r) => r.timestamp, { from: '2026-06-29', to: '2026-06-30' });
        expect(out.map((r) => r.session_id)).toEqual([11, 11, 14]);
    });

    it('never hides rows whose timestamp cannot be parsed', () => {
        const rows = [{ timestamp: 'not-a-date', id: 1 }];
        expect(filterByDateRange(rows, (r) => r.timestamp, { from: '2026-06-29' })).toEqual(rows);
    });
});

describe('contextual session narrowing', () => {
    it('narrows session options to the selected student and labels them readably', () => {
        const narrowed = applyClientFilters(ROWS, { user_id: ACCESSORS.user_id }, { user_id: '9' });
        const options = deriveSessionOptions(narrowed, {
            id: (r) => r.session_id,
            ts: (r) => r.timestamp,
            attempt: (r) => r.attempt,
            caseName: (r) => r.case_name,
        });
        expect(options.map((o) => o.value)).toEqual(['14', '13']); // most recent first
        expect(options[0].label).toMatch(/^Attempt 2 — Chest pain — /);
        expect(options[0].label).not.toMatch(/14/); // label never shows the raw id
    });

    it('contextualOptions excludes the filter\'s own key from the narrowing', () => {
        const options = contextualOptions(ROWS, ACCESSORS, { user_id: '7', verb: 'VIEWED' }, 'user_id', (r) => r.username);
        // verb=VIEWED narrows, but user_id itself must not — both students visible
        expect(options.map((o) => o.label)).toEqual(['alice', 'bob']);
    });
});

describe('useOptionMemory', () => {
    function Probe({ options }) {
        const merged = useOptionMemory(options);
        return <div data-testid="merged">{merged.map((o) => `${o.label}${o.count ?? ''}`).join(',')}</div>;
    }

    it('remembers options across a narrowing reload (server-param refetch)', () => {
        const all = deriveOptions(ROWS, (r) => r.user_id, (r) => r.username);
        const { rerender } = render(<Probe options={all} />);
        expect(screen.getByTestId('merged')).toHaveTextContent('alice3,bob2');
        // Refetch narrowed to alice: bob's rows are gone, but the option survives
        const onlyAlice = deriveOptions(ROWS.filter((r) => r.user_id === 7), (r) => r.user_id, (r) => r.username);
        rerender(<Probe options={onlyAlice} />);
        expect(screen.getByTestId('merged')).toHaveTextContent('alice3,bob');
    });
});

describe('<FilterBar />', () => {
    const studentFilter = {
        key: 'user_id',
        label: 'Student',
        options: deriveOptions(ROWS, (r) => r.user_id, (r) => r.username),
    };

    it('shows name-labelled options with counts and fires onChange with the internal id', () => {
        const onChange = vi.fn();
        render(
            <FilterBar
                filters={[studentFilter]}
                values={{}}
                onChange={onChange}
                onClearAll={() => {}}
            />,
        );
        fireEvent.focus(screen.getByRole('combobox', { name: 'Student' }));
        const listbox = screen.getByRole('listbox', { name: 'Student options' });
        expect(within(listbox).getByText('alice (3)')).toBeInTheDocument();
        expect(within(listbox).getByText('bob (2)')).toBeInTheDocument();
        fireEvent.mouseDown(within(listbox).getByText('alice (3)'));
        expect(onChange).toHaveBeenCalledWith('user_id', '7');
    });

    it('filters the list as the user types and supports keyboard selection', () => {
        const onChange = vi.fn();
        render(
            <FilterBar
                filters={[studentFilter]}
                values={{}}
                onChange={onChange}
                onClearAll={() => {}}
            />,
        );
        const input = screen.getByRole('combobox', { name: 'Student' });
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'bo' } });
        const listbox = screen.getByRole('listbox', { name: 'Student options' });
        expect(within(listbox).queryByText('alice (3)')).not.toBeInTheDocument();
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onChange).toHaveBeenCalledWith('user_id', '9');
    });

    it('Escape closes the list without selecting', () => {
        const onChange = vi.fn();
        render(
            <FilterBar
                filters={[studentFilter]}
                values={{}}
                onChange={onChange}
                onClearAll={() => {}}
            />,
        );
        const input = screen.getByRole('combobox', { name: 'Student' });
        fireEvent.focus(input);
        expect(screen.getByRole('listbox', { name: 'Student options' })).toBeInTheDocument();
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByRole('listbox', { name: 'Student options' })).not.toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('renders removable chips for active filters and a working Clear all', () => {
        const onChange = vi.fn();
        const onClearAll = vi.fn();
        render(
            <FilterBar
                filters={[studentFilter]}
                values={{ user_id: '7', from: '2026-06-01' }}
                onChange={onChange}
                onClearAll={onClearAll}
            />,
        );
        expect(screen.getByText('Student: alice')).toBeInTheDocument();
        expect(screen.getByText('From: 2026-06-01')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Student: alice filter' }));
        expect(onChange).toHaveBeenCalledWith('user_id', null);
        fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
        expect(onClearAll).toHaveBeenCalled();
    });

    it('date inputs fire onChange with from/to keys', () => {
        const onChange = vi.fn();
        render(
            <FilterBar filters={[]} values={{}} onChange={onChange} onClearAll={() => {}} />,
        );
        fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-06-29' } });
        expect(onChange).toHaveBeenCalledWith('from', '2026-06-29');
        fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-06-30' } });
        expect(onChange).toHaveBeenCalledWith('to', '2026-06-30');
    });

    it('end-to-end: a stateful host filters rows by the picked student', () => {
        function Host() {
            const [values, setValues] = useState({});
            const filtered = applyClientFilters(ROWS, ACCESSORS, values);
            return (
                <div>
                    <FilterBar
                        filters={[studentFilter]}
                        values={values}
                        onChange={(key, v) => setValues((prev) => ({ ...prev, [key]: v ?? '' }))}
                        onClearAll={() => setValues({})}
                    />
                    <div data-testid="rowcount">{filtered.length}</div>
                </div>
            );
        }
        render(<Host />);
        expect(screen.getByTestId('rowcount')).toHaveTextContent('5');
        fireEvent.focus(screen.getByRole('combobox', { name: 'Student' }));
        fireEvent.mouseDown(screen.getByText('bob (2)'));
        expect(screen.getByTestId('rowcount')).toHaveTextContent('2');
        fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
        expect(screen.getByTestId('rowcount')).toHaveTextContent('5');
    });
});
