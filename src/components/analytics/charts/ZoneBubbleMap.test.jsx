// Smoke test — ZoneBubbleMap renders the full 3×3 zone grid with % labels
// and one translucent bubble per student per zone they looked at.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ZoneBubbleMap from './ZoneBubbleMap';

const ZONE_WEIGHTS = { top_left: 0.5, middle_center: 0.3, bottom_right: 0.2 };
const STUDENTS = [
    { student: 'alice', color: '#4e79a7', zones: { top_left: 0.6, middle_center: 0.4 } },
    { student: 'bob', color: '#e15759', zones: { bottom_right: 1 } },
];

describe('ZoneBubbleMap', () => {
    it('renders all 9 zone cells with % labels', () => {
        const { container } = render(
            <ZoneBubbleMap title="Gaze zones" zoneWeights={ZONE_WEIGHTS} studentZoneWeights={STUDENTS} />);
        expect(container.querySelectorAll('[data-testid^="zone-cell-"]')).toHaveLength(9);
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('30%')).toBeInTheDocument();
        expect(screen.getAllByText('0%')).toHaveLength(6); // zones with no weight
    });

    it('renders one bubble per student per zone with share > 0, with a labelled title', () => {
        const { container } = render(
            <ZoneBubbleMap zoneWeights={ZONE_WEIGHTS} studentZoneWeights={STUDENTS} />);
        const bubbles = container.querySelectorAll('[data-testid="zone-bubble"]');
        expect(bubbles).toHaveLength(3); // alice×2 zones + bob×1 zone
        const titles = [...bubbles].map((b) => b.querySelector('title').textContent);
        expect(titles).toContain('alice · top_left · 60%');
        expect(titles).toContain('alice · middle_center · 40%');
        expect(titles).toContain('bob · bottom_right · 100%');
    });

    it('renders no bubbles for empty data but keeps the 9-cell grid', () => {
        const { container } = render(<ZoneBubbleMap zoneWeights={{}} studentZoneWeights={[]} />);
        expect(container.querySelectorAll('[data-testid^="zone-cell-"]')).toHaveLength(9);
        expect(container.querySelectorAll('[data-testid="zone-bubble"]')).toHaveLength(0);
    });
});
