import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import VersionBadge from './VersionBadge.jsx';
import pkg from '../../package.json';

describe('VersionBadge', () => {
    it('renders "Rohy <major>.<minor>" from package.json', () => {
        const { container } = render(<VersionBadge />);
        const [major, minor] = pkg.version.split('.');
        expect(container.textContent).toBe(`Rohy ${major}.${minor}`);
    });

    it('drops the patch version from the label', () => {
        const { container } = render(<VersionBadge />);
        // Even if pkg.version is "2.1.5", the label is "Rohy 2.1".
        expect(container.textContent).not.toMatch(/\.\d+\.\d+/);
    });

    it('is fixed, top-centred, high z-index, and click-through', () => {
        const { container } = render(<VersionBadge />);
        const el = container.firstChild;
        const classes = el.className.split(/\s+/);
        // Tailwind utilities contain `/` and `-` which are tricky for regex
        // word-boundaries; assert exact class presence instead.
        expect(classes).toContain('fixed');
        expect(classes).toContain('top-2');
        expect(classes).toContain('left-1/2');
        expect(classes).toContain('-translate-x-1/2');
        expect(classes).toContain('z-[9999]');
        expect(classes).toContain('pointer-events-none');
        expect(el.getAttribute('aria-hidden')).toBe('true');
    });
});
