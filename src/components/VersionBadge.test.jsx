import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import VersionBadge from './VersionBadge.jsx';
import pkg from '../../package.json';

describe('VersionBadge', () => {
    it('renders "Rohy <full version>" from package.json', () => {
        const { container } = render(<VersionBadge />);
        // Full version now (including patch) — patch bumps like 2.1.1 →
        // 2.1.2 used to disappear because the badge truncated to
        // major.minor; the truncation is intentionally gone.
        expect(container.textContent).toBe(`Rohy ${pkg.version}`);
    });

    it('includes the patch version in the label', () => {
        const { container } = render(<VersionBadge />);
        expect(container.textContent).toMatch(/^Rohy \d+\.\d+\.\d+$/);
    });

    it('renders as a click-through wordmark with no fixed positioning of its own', () => {
        const { container } = render(<VersionBadge />);
        const el = container.firstChild;
        const classes = el.className.split(/\s+/);

        // Aria-hidden + click-through — purely decorative.
        expect(el.getAttribute('aria-hidden')).toBe('true');
        expect(classes).toContain('pointer-events-none');
        expect(classes).toContain('select-none');

        // Bold teal wordmark — the look the project has used since launch.
        expect(classes).toContain('font-bold');
        expect(classes).toContain('text-teal-300');

        // No more `fixed` / `top-3` / `left-1/2`. Positioning lives in the
        // caller (PatientMonitor) so the badge can be re-mounted anywhere.
        expect(classes).not.toContain('fixed');
        expect(classes).not.toContain('left-1/2');
    });
});
