// Regression lock: the debrief's text composer blurred the discussant's question out of sight while the learner typed the answer to it (QA 2026-10-04, PRV-30)
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import TextComposerModal from './TextComposerModal.jsx';

describe('TextComposerModal', () => {
    it('shows the question being answered, in a labelled dialog', () => {
        renderWithProviders(
            <TextComposerModal prompt="Walk me through the ECG first." onClose={vi.fn()} onSend={vi.fn()} busy={false} />,
        );
        const dialog = screen.getByRole('dialog', { name: 'Type a message' });
        expect(dialog.textContent).toContain('The discussant asked');
        expect(dialog.textContent).toContain('Walk me through the ECG first.');
        expect(screen.getByRole('textbox', { name: 'Type a message' })).toBeInTheDocument();
    });

    it('renders no prompt block when there is no question yet', () => {
        renderWithProviders(<TextComposerModal onClose={vi.fn()} onSend={vi.fn()} busy={false} />);
        expect(screen.queryByText('The discussant asked')).toBeNull();
    });
});
