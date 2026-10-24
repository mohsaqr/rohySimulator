// Regression lock: a lesson file stored as a javascript:/data:/relative URL reached the FileCard's <a href> verbatim
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileCard } from './FileCard.jsx';
import { resolveFileUrl } from '../../api/client.js';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_k, o) => o?.defaultValue ?? _k }),
}));
vi.mock('../../hooks/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));

describe('FileCard link allow-list', () => {
    it('renders no link at all for a refused address', () => {
        render(<FileCard fileName="evil.pdf" fileType="pdf" url={resolveFileUrl('javascript:alert(1)')} />);
        expect(screen.getByText('evil.pdf')).toBeTruthy();
        expect(screen.queryByRole('link')).toBeNull();
        expect(document.querySelector('a')).toBeNull();
    });

    it('links an /uploads file as before', () => {
        render(<FileCard fileName="notes.pdf" fileType="pdf" url={resolveFileUrl('/uploads/notes.pdf')} />);
        const link = screen.getByRole('link');
        expect(link.getAttribute('href')).toMatch(/\/uploads\/notes\.pdf$/);
    });
});
