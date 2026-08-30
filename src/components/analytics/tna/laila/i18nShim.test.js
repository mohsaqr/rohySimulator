// The LAILA i18n shim humanises any key it has no override for, which keeps
// new upstream keys readable — but silently produces nonsense for dotted keys.
import { describe, it, expect } from 'vitest';
import { t } from './i18nShim';

describe('i18nShim — centrality measure labels', () => {
    // Regression lock: the Network tab rendered "Sna.m in strength",
    // "Sna.m out strength", "Sna.m closeness", "Sna.m betweenness" (reported
    // against v2.9.82). humanise() strips a `ns:` prefix but not a dotted one,
    // so 'sna.m_in_strength' → 'sna.m in strength' → capitalise first letter.
    const EXPECTED = {
        'sna.m_degree': 'Degree',
        'sna.m_in_degree': 'In-degree',
        'sna.m_out_degree': 'Out-degree',
        'sna.m_in_strength': 'In-strength',
        'sna.m_out_strength': 'Out-strength',
        'sna.m_betweenness': 'Betweenness',
        'sna.m_closeness': 'Closeness',
    };

    it('renders every centrality key as a clean user-facing label', () => {
        for (const [key, label] of Object.entries(EXPECTED)) {
            expect(t(key), key).toBe(label);
        }
    });

    it('no centrality label leaks the raw key namespace', () => {
        for (const key of Object.keys(EXPECTED)) {
            expect(t(key).toLowerCase()).not.toContain('sna');
            expect(t(key)).not.toContain('_');
        }
    });

    it('still humanises an unknown key rather than rendering it raw', () => {
        // The fallback is deliberate: a new upstream key stays readable.
        expect(t('network_density_extra')).toBe('Network density extra');
    });
});
