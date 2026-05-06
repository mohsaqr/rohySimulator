// Unit tests for the three search proxies. Mock fetch via setFetch from
// proxyCache.js — the proxies all funnel through `getFetch()` so the
// override applies process-wide.
//
// Why unit-test the proxies separately from the routes: the route test
// spawns the real server in a child process, so an in-process fetch mock
// wouldn't apply. These tests prove cache hit/miss + result normalization
// without touching the network. The route test can then assume the
// proxies work and only verify wiring (auth, query-param plumbing).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setFetch, cacheClear } from '../../server/services/proxyCache.js';
import { searchRxNorm, lookupRxCui } from '../../server/services/rxnormProxy.js';
import { searchOpenFda } from '../../server/services/openfdaProxy.js';
import { searchLoinc } from '../../server/services/loincProxy.js';

function mockResponse(json, { status = 200 } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => json,
        text: async () => JSON.stringify(json),
    };
}

describe('proxyCache + search proxies', () => {
    beforeEach(() => {
        cacheClear();
    });

    describe('rxnormProxy.searchRxNorm', () => {
        it('returns empty array for blank query without hitting fetch', async () => {
            const fetchSpy = vi.fn();
            setFetch(fetchSpy);
            const out = await searchRxNorm('   ');
            expect(out).toEqual([]);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('parses and normalizes RxNav approximateTerm response', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse({
                approximateGroup: {
                    candidate: [
                        { rxcui: '1191', name: 'Aspirin', score: '95' },
                        { rxcui: '1191', name: 'ASA', score: '90', synonym: 'Acetylsalicylic acid' },
                        { rxcui: '32968', name: 'Clopidogrel', score: '85' },
                    ],
                },
            }));
            setFetch(fetchSpy);
            const hits = await searchRxNorm('aspirin');
            expect(fetchSpy).toHaveBeenCalledOnce();
            expect(hits).toHaveLength(2);
            const aspirin = hits.find((h) => h.rxcui === '1191');
            expect(aspirin.display_name).toBe('Aspirin');
            expect(aspirin.score).toBe(95);
            expect(aspirin.external_source).toBe('rxnorm');
            // De-dup keeps the higher-score row for the same rxcui.
            expect(hits.find((h) => h.rxcui === '1191').score).toBe(95);
        });

        it('caches results — second identical call does not refetch', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse({
                approximateGroup: { candidate: [{ rxcui: '7242', name: 'Naloxone', score: '100' }] },
            }));
            setFetch(fetchSpy);
            const a = await searchRxNorm('naloxone');
            const b = await searchRxNorm('naloxone');
            expect(fetchSpy).toHaveBeenCalledOnce();
            expect(b).toEqual(a);
        });

        it('throws on upstream HTTP error', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse({}, { status: 500 }));
            setFetch(fetchSpy);
            await expect(searchRxNorm('fail')).rejects.toThrow(/HTTP 500/);
        });

        it('lookupRxCui parses /rxcui/:id/properties response', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse({
                properties: { rxcui: '7242', name: 'naloxone', synonym: 'Narcan', tty: 'IN' },
            }));
            setFetch(fetchSpy);
            const out = await lookupRxCui('7242');
            expect(out).toEqual({ rxcui: '7242', name: 'naloxone', synonym: 'Narcan', tty: 'IN' });
        });

        it('lookupRxCui returns null on 404', async () => {
            setFetch(vi.fn().mockResolvedValue(mockResponse({}, { status: 404 })));
            expect(await lookupRxCui('00000')).toBeNull();
        });
    });

    describe('openfdaProxy.searchOpenFda', () => {
        it('returns empty array for blank query without hitting fetch', async () => {
            const fetchSpy = vi.fn();
            setFetch(fetchSpy);
            const out = await searchOpenFda('');
            expect(out).toEqual([]);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('normalizes openFDA drug-label response', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse({
                results: [{
                    set_id: 'abc-123',
                    indications_and_usage: ['Aspirin is indicated for pain relief.'],
                    contraindications: ['Hypersensitivity'],
                    adverse_reactions: ['GI upset'],
                    boxed_warning: ['Bleeding risk'],
                    openfda: {
                        spl_set_id: ['xyz-set'],
                        rxcui: ['1191'],
                        brand_name: ['BAYER ASPIRIN'],
                        generic_name: ['ASPIRIN'],
                        manufacturer_name: ['Bayer'],
                        product_ndc: ['12345-678'],
                    },
                }],
            }));
            setFetch(fetchSpy);
            const hits = await searchOpenFda('aspirin');
            expect(hits).toHaveLength(1);
            expect(hits[0]).toMatchObject({
                external_source: 'openfda',
                external_id: 'xyz-set',
                rxcui: '1191',
                display_name: 'BAYER ASPIRIN',
                ndc_primary: '12345-678',
                indications: 'Aspirin is indicated for pain relief.',
                boxed_warning: 'Bleeding risk',
            });
        });

        it('treats upstream 404 as empty (openFDA convention)', async () => {
            setFetch(vi.fn().mockResolvedValue(mockResponse({}, { status: 404 })));
            const out = await searchOpenFda('madeup');
            expect(out).toEqual([]);
        });
    });

    describe('loincProxy.searchLoinc', () => {
        it('returns empty for blank query', async () => {
            const fetchSpy = vi.fn();
            setFetch(fetchSpy);
            expect(await searchLoinc('')).toEqual([]);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('parses Clinical Tables tuple response', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse([
                3,
                ['718-7', '4544-3', '789-8'],
                null,
                [
                    ['718-7', 'Hemoglobin', 'Hemoglobin [Mass/volume] in Blood', 'g/dL'],
                    ['4544-3', 'Hematocrit', 'Hematocrit [Volume Fraction] of Blood', '%'],
                    ['789-8', 'Erythrocytes', 'Erythrocytes [#/volume] in Blood', '10*6/uL'],
                ],
                null,
            ]));
            setFetch(fetchSpy);
            const hits = await searchLoinc('hemog');
            expect(hits).toHaveLength(3);
            expect(hits[0]).toMatchObject({
                external_source: 'loinc',
                external_id: '718-7',
                loinc_code: '718-7',
                ucum_unit: 'g/dL',
            });
        });

        it('caches and reuses across calls', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse([
                1, ['2951-2'], null,
                [['2951-2', 'Sodium', 'Sodium [Moles/volume] in Serum or Plasma', 'mmol/L']],
                null,
            ]));
            setFetch(fetchSpy);
            const a = await searchLoinc('sodium');
            const b = await searchLoinc('sodium');
            expect(fetchSpy).toHaveBeenCalledOnce();
            expect(a).toEqual(b);
        });
    });
});
