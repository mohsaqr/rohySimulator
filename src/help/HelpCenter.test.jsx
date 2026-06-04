import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../tests/utils/renderWithProviders.jsx';

const apiGet = vi.fn();
vi.mock('../services/apiClient.js', () => ({
  apiGet: (...args) => apiGet(...args),
}));

import HelpCenter from './HelpCenter.jsx';

describe('HelpCenter', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('renders nothing when closed', () => {
    const { container } = renderWithProviders(
      <HelpCenter open={false} onClose={() => {}} />,
    );
    expect(container.textContent).toBe('');
  });

  it('shows the three tabs and trainee articles by default (no user → student scope)', () => {
    renderWithProviders(<HelpCenter open onClose={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Help' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: "What's new" })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Support' })).toBeTruthy();
    expect(screen.getByText('Getting started')).toBeTruthy();
    // educator-only article must not leak to the default (student) scope
    expect(screen.queryByText('Classes & join codes')).toBeNull();
  });

  it('loads release notes when the What\'s new tab is opened', async () => {
    apiGet.mockResolvedValueOnce({
      releases: [
        { version: '2.1.0', date: '2026-05-14', summary: 'Minor.', sections: { Added: ['A thing.'] } },
      ],
    });
    renderWithProviders(<HelpCenter open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: "What's new" }));
    // Path must be WITHOUT the /api prefix — apiUrl() prepends it. Passing
    // '/api/...' here resolves to /api/api/... → 404 (the Stage-4 regression).
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/help/release-notes'));
    expect(await screen.findByText('2.1.0')).toBeTruthy();
    expect(screen.getByText('A thing.')).toBeTruthy();
  });

  it('requests diagnostics on the un-prefixed path and surfaces a friendly load error', async () => {
    // The server can reject with a raw machine code (e.g. an error string);
    // the UI must show human-readable copy, never the raw message.
    apiGet.mockRejectedValueOnce(new Error('release_notes_unavailable'));
    renderWithProviders(<HelpCenter open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Support' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/help/diagnostics'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the support bundle right now.');
    expect(alert.textContent).not.toContain('release_notes_unavailable');
  });

  it('shows friendly copy (not the raw error code) when release notes fail to load', async () => {
    apiGet.mockRejectedValueOnce(new Error('release_notes_unavailable'));
    renderWithProviders(<HelpCenter open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: "What's new" }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/help/release-notes'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Release notes are unavailable right now.');
    expect(alert.textContent).not.toContain('release_notes_unavailable');
  });

  it('shows an empty-state when release notes load but are empty', async () => {
    apiGet.mockResolvedValueOnce({ releases: [] });
    renderWithProviders(<HelpCenter open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: "What's new" }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/help/release-notes'));
    expect(await screen.findByText('No release notes yet.')).toBeTruthy();
  });

  it('calls onClose from the close button', () => {
    const onClose = vi.fn();
    renderWithProviders(<HelpCenter open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close help'));
    expect(onClose).toHaveBeenCalled();
  });
});
