// Regression lock: the admin create-user form sent any password to the server, which answered 400 for one the form had accepted — it did not share the register page's password rules (QA PRV-9)
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import renderWithProviders from '../../../../tests/utils/renderWithProviders.jsx';
import UserFormModal from './UserFormModal.jsx';

const createUser = vi.fn(() => Promise.resolve({}));
vi.mock('../../../services/userService', () => ({
    createUser: (...a) => createUser(...a),
    updateUser: vi.fn(() => Promise.resolve({})),
    getUser: vi.fn(() => Promise.resolve({ user: {}, memberships: [] })),
}));

const passwordInput = (container) => container.querySelector('input[type="password"]');

describe('UserFormModal password policy', () => {
    it('lists the server rules and refuses a weak password before any request', () => {
        const { container } = renderWithProviders(<UserFormModal myRank={4} onClose={vi.fn()} onSaved={vi.fn()} />, {});
        expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
        expect(screen.getByText('An uppercase letter')).toBeInTheDocument();

        fireEvent.change(passwordInput(container), { target: { value: 'short' } });
        const save = screen.getByRole('button', { name: 'Create user' });
        expect(save).toBeDisabled();
        expect(passwordInput(container)).toHaveAttribute('aria-invalid', 'true');
        fireEvent.click(save);
        expect(createUser).not.toHaveBeenCalled();
    });

    it('accepts a password that meets every rule', () => {
        const { container } = renderWithProviders(<UserFormModal myRank={4} onClose={vi.fn()} onSaved={vi.fn()} />, {});
        fireEvent.change(passwordInput(container), { target: { value: 'Str0ngPass' } });
        expect(screen.getByRole('button', { name: 'Create user' })).not.toBeDisabled();
        expect(passwordInput(container)).toHaveAttribute('aria-invalid', 'false');
    });
});
