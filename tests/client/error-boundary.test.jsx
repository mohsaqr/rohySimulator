// Regression lock: there was NO React error boundary anywhere in src/ — one
// render throw (concretely: the pathology viewer rejecting a malformed slide)
// blanked the whole SPA. ErrorBoundary is now mounted app-wide in App.jsx and
// per-plugin in PluginRoom; this locks its contract.
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../../src/components/common/ErrorBoundary.jsx';

// The boundary reads i18n'd copy via useTranslation('common'); in tests the
// bare keys come back, which is fine — the contract under test is containment.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key) => key }),
}));

function Bomb({ defused }) {
    if (!defused) throw new Error('boom');
    return <div data-testid="defused">recovered</div>;
}

describe('ErrorBoundary', () => {
    it('renders children when nothing throws', () => {
        render(
            <ErrorBoundary scope="test">
                <div data-testid="child">fine</div>
            </ErrorBoundary>,
        );
        expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('contains a render throw as an alert panel instead of unmounting the tree', () => {
        // React logs the error twice in dev; keep the test output clean.
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onError = vi.fn();
        render(
            <ErrorBoundary scope="test" onError={onError}>
                <Bomb defused={false} />
            </ErrorBoundary>,
        );
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0].message).toBe('boom');
        spy.mockRestore();
    });

    it('the retry button re-renders the children', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        function Harness() {
            const [defused, setDefused] = useState(false);
            return (
                <>
                    <button data-testid="defuse" onClick={() => setDefused(true)}>defuse</button>
                    <ErrorBoundary scope="test">
                        <Bomb defused={defused} />
                    </ErrorBoundary>
                </>
            );
        }
        render(<Harness />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
        // Fix the underlying state, then retry — the boundary must reset.
        fireEvent.click(screen.getByTestId('defuse'));
        fireEvent.click(screen.getByText('error_boundary_retry'));
        expect(screen.getByTestId('defused')).toBeInTheDocument();
        spy.mockRestore();
    });

    it('a throwing onError handler never escalates the failure', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(
            <ErrorBoundary scope="test" onError={() => { throw new Error('handler blew up'); }}>
                <Bomb defused={false} />
            </ErrorBoundary>,
        );
        expect(screen.getByRole('alert')).toBeInTheDocument();
        spy.mockRestore();
    });
});
