import { describe, expect, it } from 'vitest';
import { pickWaitPhase, formatRemaining, waitProgressPct } from './agentWait';

// Fixed reference times so the elapsed fraction is deterministic.
// 180 s wait, sampled at 0/45/90/135/179 s in.
const PAGED = '2026-05-13T12:00:00.000Z';
const ARRIVES = '2026-05-13T12:03:00.000Z'; // 3 min later
const ms = (sec) => new Date(PAGED).getTime() + sec * 1000;

// pickWaitPhase returns chat-namespace translation KEYS (i18n, 2026-07-08);
// the English copy lives in src/locales/en/chat.json and the render site
// wraps the key in t(). The catalogue-side contract (keys exist + English
// values) is asserted separately below.
describe('pickWaitPhase', () => {
    it('returns the first phase key at t=0 for a known agent type', () => {
        expect(pickWaitPhase('consultant', PAGED, ARRIVES, ms(0)))
            .toBe('wait_consultant_0');
    });

    it('advances through phase keys as elapsed fraction grows', () => {
        // 4 consultant phases over 180s → boundaries at 45/90/135s.
        expect(pickWaitPhase('consultant', PAGED, ARRIVES, ms(50)))
            .toBe('wait_consultant_1');
        expect(pickWaitPhase('consultant', PAGED, ARRIVES, ms(95)))
            .toBe('wait_consultant_2');
        expect(pickWaitPhase('consultant', PAGED, ARRIVES, ms(170)))
            .toBe('wait_consultant_3');
    });

    it('never overflows the phase array even at/past arrival', () => {
        // frac is clamped to 0.999 so floor(0.999 * len) === len-1.
        expect(pickWaitPhase('consultant', PAGED, ARRIVES, ms(180)))
            .toBe('wait_consultant_3');
        expect(pickWaitPhase('consultant', PAGED, ARRIVES, ms(10_000)))
            .toBe('wait_consultant_3');
    });

    it('falls back to default phase keys for unknown agent types', () => {
        expect(pickWaitPhase('janitor', PAGED, ARRIVES, ms(0))).toBe('wait_default_0');
        expect(pickWaitPhase('janitor', PAGED, ARRIVES, ms(170))).toBe('wait_default_2');
    });

    it('returns the first phase key if timestamps are missing', () => {
        expect(pickWaitPhase('consultant', null, ARRIVES, ms(50))).toBe('wait_consultant_0');
        expect(pickWaitPhase('consultant', PAGED, null, ms(50))).toBe('wait_consultant_0');
    });

    it('every key it can return exists in the en chat catalogue with the original copy', async () => {
        const catalogue = (await import('../locales/en/chat.json')).default;
        const allKeys = [
            'wait_consultant_0', 'wait_consultant_1', 'wait_consultant_2', 'wait_consultant_3',
            'wait_relative_0', 'wait_relative_1', 'wait_relative_2',
            'wait_nurse_0', 'wait_nurse_1', 'wait_nurse_2',
            'wait_default_0', 'wait_default_1', 'wait_default_2'
        ];
        for (const key of allKeys) {
            expect(catalogue[key], `missing catalogue entry for ${key}`).toBeTruthy();
        }
        expect(catalogue.wait_consultant_0).toBe('Paging the consultant…');
        expect(catalogue.wait_default_2).toBe('Almost here…');
    });
});

describe('formatRemaining', () => {
    it('formats mm:ss with zero-padded seconds', () => {
        expect(formatRemaining(ARRIVES, ms(0))).toBe('3:00');
        expect(formatRemaining(ARRIVES, ms(45))).toBe('2:15');
        expect(formatRemaining(ARRIVES, ms(178))).toBe('0:02');
    });

    it('clamps to 0:00 at or past arrival', () => {
        expect(formatRemaining(ARRIVES, ms(180))).toBe('0:00');
        expect(formatRemaining(ARRIVES, ms(500))).toBe('0:00');
    });

    it('returns empty string when no arrival timestamp', () => {
        expect(formatRemaining(null, ms(0))).toBe('');
    });
});

describe('waitProgressPct', () => {
    it('is 0 at the start and 100 at arrival', () => {
        expect(waitProgressPct(PAGED, ARRIVES, ms(0))).toBe(0);
        expect(waitProgressPct(PAGED, ARRIVES, ms(180))).toBe(100);
    });

    it('interpolates linearly between start and end', () => {
        expect(waitProgressPct(PAGED, ARRIVES, ms(90))).toBeCloseTo(50, 5);
    });

    it('clamps below 0 and above 100', () => {
        expect(waitProgressPct(PAGED, ARRIVES, ms(-100))).toBe(0);
        expect(waitProgressPct(PAGED, ARRIVES, ms(1_000))).toBe(100);
    });

    it('returns 0 when timestamps are missing', () => {
        expect(waitProgressPct(null, ARRIVES, ms(50))).toBe(0);
        expect(waitProgressPct(PAGED, null, ms(50))).toBe(0);
    });
});
