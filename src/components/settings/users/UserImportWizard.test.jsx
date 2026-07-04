import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import UserImportWizard from './UserImportWizard.jsx';

const toast = { success: vi.fn(), error: vi.fn() };
const userSvc = { importUsers: vi.fn() };

vi.mock('../../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return { ...actual, useToast: () => toast };
});

vi.mock('../../../services/userService', () => ({
    importUsers: (...a) => userSvc.importUsers(...a),
}));

beforeEach(() => {
    Object.values(toast).forEach((f) => f.mockReset());
    Object.values(userSvc).forEach((f) => f.mockReset());
});

describe('UserImportWizard', () => {
    it('server dry-runs before review and excludes server-failed rows from commit', async () => {
        userSvc.importUsers
            .mockResolvedValueOnce({
                results: {
                    created: [{ row: 1, username: 'jdoe' }],
                    enrolled: [{ row: 1, username: 'jdoe', class: 'Cardio' }],
                    skipped: [],
                    failed: [{ row: 2, username: 'bad', email: 'bad@example.com', role: 'student', class: 'Cardio', error: 'Username already exists' }],
                },
            })
            .mockResolvedValueOnce({
                results: { created: [{ row: 1 }], enrolled: [{ row: 1 }], skipped: [], failed: [] },
            });

        render(
            <UserImportWizard
                cohorts={[{ id: 7, name: 'Cardio', join_code: 'CARD123' }]}
                existingUsers={[]}
                myRank={4}
                onClose={vi.fn()}
                onDone={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByPlaceholderText('username,name,email,password,role,class'), {
            target: {
                value: [
                    'username,name,email,password,role,class',
                    'jdoe,Jane Doe,jane@example.com,Passw0rd!,student,CARD123',
                    'bad,Bad Row,bad@example.com,Passw0rd!,student,CARD123',
                ].join('\n'),
            },
        });
        fireEvent.click(screen.getByRole('button', { name: /Parse pasted rows/i }));

        await waitFor(() => expect(screen.getByText(/2 rows detected/i)).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /Review/i }));

        await waitFor(() => expect(userSvc.importUsers).toHaveBeenCalledWith({
            rows: [
                { username: 'jdoe', name: 'Jane Doe', email: 'jane@example.com', password: 'Passw0rd!', role: 'student', class: 'CARD123' },
                { username: 'bad', name: 'Bad Row', email: 'bad@example.com', password: 'Passw0rd!', role: 'student', class: 'CARD123' },
            ],
            cohortId: undefined,
            dryRun: true,
        }));
        expect(screen.getByText('Server preview')).toBeTruthy();
        expect(screen.getByText(/Username already exists/i)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /Import 1 rows/i }));

        await waitFor(() => expect(userSvc.importUsers).toHaveBeenLastCalledWith({
            rows: [
                { username: 'jdoe', name: 'Jane Doe', email: 'jane@example.com', password: 'Passw0rd!', role: 'student', class: 'CARD123' },
            ],
            cohortId: undefined,
            dryRun: false,
        }));
        expect(toast.success).toHaveBeenCalledWith('Imported: 1 created, 1 enrolled');
    });
});
