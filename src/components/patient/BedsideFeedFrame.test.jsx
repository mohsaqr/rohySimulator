import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import BedsideFeedFrame from './BedsideFeedFrame';

describe('BedsideFeedFrame', () => {
    it('is inert: it must never intercept a click meant for the avatar', () => {
        const { container } = render(<BedsideFeedFrame />);
        const layer = container.firstChild;
        expect(layer.className).toContain('pointer-events-none');
        expect(layer.getAttribute('aria-hidden')).toBe('true');
    });

    it('lights the tally while the patient is speaking', () => {
        const { container, rerender } = render(<BedsideFeedFrame speaking={false} />);
        expect(container.innerHTML).not.toContain('bg-rose-400');
        rerender(<BedsideFeedFrame speaking />);
        expect(container.innerHTML).toContain('bg-rose-400');
    });

    it('draws four corner brackets, not a box around the face', () => {
        const { container } = render(<BedsideFeedFrame />);
        const brackets = container.querySelectorAll('span.w-5.h-5');
        expect(brackets.length).toBe(4);
    });
});
