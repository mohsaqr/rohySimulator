// TermsDocument renders the shared markdown subset as React elements, never
// HTML. It also renders LICENSE / NOTICE.md in the Settings About dialog, so it
// must keep "#" titles, "###" subheadings, tables, fences and safe links.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TermsDocument from './TermsDocument';

describe('TermsDocument', () => {
    it('renders titles, headings, tables, code fences and only safe links', () => {
        const body = [
            '# Licence title', '', '## Section', '', '### Sub', '',
            'See [repo](https://example.test/r), [`LICENSE`](LICENSE) and [x](javascript:alert(1)).', '',
            '| Component | License |', '|---|---|', '| **WebGazer.js** | GPL |', '',
            '```', 'npm run license:sync', '```', '', '<img src=x onerror=alert(1)>',
        ].join('\n');
        const { container } = render(<TermsDocument body={body} />);
        expect(screen.getByRole('heading', { level: 2, name: 'Licence title' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 3, name: 'Section' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 4, name: 'Sub' })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: 'Component' })).toBeInTheDocument();
        expect(screen.getByRole('cell', { name: 'WebGazer.js' })).toBeInTheDocument();
        expect(container.querySelector('pre').textContent).toBe('npm run license:sync');
        const links = screen.getAllByRole('link');
        expect(links).toHaveLength(1);
        expect(links[0]).toHaveAttribute('href', 'https://example.test/r');
        expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
        expect(screen.getByText('LICENSE').tagName).toBe('CODE');
        // Raw HTML stays text.
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    });
});
