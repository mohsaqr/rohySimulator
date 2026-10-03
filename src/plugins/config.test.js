import { describe, it, expect } from 'vitest';
import {
    BEDSIDE_PORTRAIT,
    BEDSIDE_VIEW,
    BEDSIDE_VIEWS,
    BEDSIDE_HEAD_DIRECTION,
    BEDSIDE_HEAD_DIRECTIONS,
} from './config';

// The portrait circle defaults to the pre-3D head; the bedside camera is
// opt-in, and its framing options must name a framing the package knows.
describe('plugin config: bedside portrait', () => {
    it('keeps the pre-3D head portrait by default', () => {
        expect(BEDSIDE_PORTRAIT).toBe(false);
    });

    it('names a known bedside view and head direction', () => {
        expect(BEDSIDE_VIEWS).toContain(BEDSIDE_VIEW);
        expect(BEDSIDE_HEAD_DIRECTIONS).toContain(BEDSIDE_HEAD_DIRECTION);
    });

    it('offers every framing the package ships, nothing invented', () => {
        expect([...BEDSIDE_VIEWS]).toEqual(['three-quarter', 'profile', 'head-up', 'overhead']);
        expect([...BEDSIDE_HEAD_DIRECTIONS]).toEqual(['right', 'left']);
    });
});
