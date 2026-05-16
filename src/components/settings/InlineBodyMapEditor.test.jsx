// Regression lock for Bug 1 (16.5.2026 report): "Open Body Map Editor"
// did nothing. It linked to /?debug=bodymap, an auth-bypassing branch
// gated to import.meta.env.DEV, so production builds never opened it.
// The editor now mounts inline inside the admin-gated settings tab.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// BodyMapDebug fetches /bodymap-regions on mount; stub it so this test
// stays a focused contract on the open/close behaviour.
vi.mock('../examination/BodyMapDebug', () => ({
    default: ({ gender, view }) => (
        <div data-testid="bodymap-debug">{`bodymap:${gender}:${view}`}</div>
    ),
}));

import { InlineBodyMapEditor } from './ConfigPanel.jsx';

afterEach(cleanup);

describe('InlineBodyMapEditor (Bug 1)', () => {
    it('shows the editor in-place on click (no external /?debug=bodymap link)', () => {
        const { container } = render(<InlineBodyMapEditor />);

        // It must NOT be an anchor to the dead debug URL.
        expect(container.querySelector('a[href*="debug=bodymap"]')).toBeNull();

        const openBtn = screen.getByRole('button', { name: /Open Body Map Editor/i });
        fireEvent.click(openBtn);

        // Editor surface mounts inline, in the authenticated admin tab.
        expect(screen.getByTestId('bodymap-debug')).toBeTruthy();
        expect(screen.getByTestId('bodymap-debug').textContent).toBe('bodymap:male:anterior');
    });

    it('switches gender/view and can close again', () => {
        render(<InlineBodyMapEditor />);
        fireEvent.click(screen.getByRole('button', { name: /Open Body Map Editor/i }));

        const selects = screen.getAllByRole('combobox');
        fireEvent.change(selects[0], { target: { value: 'female' } });
        fireEvent.change(selects[1], { target: { value: 'posterior' } });
        expect(screen.getByTestId('bodymap-debug').textContent).toBe('bodymap:female:posterior');

        fireEvent.click(screen.getByRole('button', { name: /Close editor/i }));
        expect(screen.queryByTestId('bodymap-debug')).toBeNull();
        // Back to the open affordance.
        expect(screen.getByRole('button', { name: /Open Body Map Editor/i })).toBeTruthy();
    });
});
