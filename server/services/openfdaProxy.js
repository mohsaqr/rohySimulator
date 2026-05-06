// openFDA Drug Labels search proxy.
//
// Upstream: https://api.fda.gov/drug/label.json
// License: CC0 1.0 (FDA). Free, no API key for low volumes
// (240 req/min unauthenticated; ~120k/day with FDA_API_KEY).
//
// Used for: indications, contraindications, side effects, boxed warnings,
// NDC + setid, sometimes RxCUI. Layered on top of RxNorm: a search hit
// from RxNorm provides the canonical name, this proxy provides label
// content for the "Add to catalogue" preview.
//
// Search strategy: openFDA expects Lucene-style queries. We OR over
// brand_name and generic_name in openfda subfields for permissive
// matching. The top-N hits are returned — the user picks one.
//
// Caching: same 24h window as RxNorm. Cache key includes the limit so
// "give me top 5" and "give me top 25" don't collide.

import { cacheGet, cacheSet, getFetch } from './proxyCache.js';

const NAMESPACE = 'openfda';
const OPENFDA_BASE = 'https://api.fda.gov/drug/label.json';

function pickFirst(arr) {
    if (!Array.isArray(arr)) return null;
    return arr[0] || null;
}

function normalizeLabel(item) {
    const openfda = item.openfda || {};
    return {
        external_source: 'openfda',
        external_id: pickFirst(openfda.spl_set_id) || item.set_id || null,
        rxcui: pickFirst(openfda.rxcui) || null,
        display_name: pickFirst(openfda.brand_name) || pickFirst(openfda.generic_name) || pickFirst(openfda.substance_name) || '(unnamed)',
        generic_name: pickFirst(openfda.generic_name) || null,
        brand_name: pickFirst(openfda.brand_name) || null,
        manufacturer: pickFirst(openfda.manufacturer_name) || null,
        ndc_primary: pickFirst(openfda.product_ndc) || null,
        atc: pickFirst(openfda.pharm_class_epc) || pickFirst(openfda.pharm_class_pe) || null,
        indications: Array.isArray(item.indications_and_usage) ? item.indications_and_usage[0] : null,
        contraindications: Array.isArray(item.contraindications) ? item.contraindications[0] : null,
        side_effects: Array.isArray(item.adverse_reactions) ? item.adverse_reactions[0] : null,
        boxed_warning: Array.isArray(item.boxed_warning) ? item.boxed_warning[0] : null,
        warnings: Array.isArray(item.warnings) ? item.warnings[0] : null,
    };
}

export async function searchOpenFda(query, { limit = 10, signal } = {}) {
    const q = (query || '').trim();
    if (!q) return [];
    const cacheKey = `q:${q.toLowerCase()}:${limit}`;
    const cached = cacheGet(NAMESPACE, cacheKey);
    if (cached) return cached;

    const fetchFn = getFetch();
    if (!fetchFn) throw new Error('openfdaProxy: global fetch unavailable');

    // Quote-escape the term for Lucene; openFDA chokes on bare punctuation.
    const term = q.replace(/"/g, '\\"');
    const search = encodeURIComponent(
        `(openfda.brand_name:"${term}" OR openfda.generic_name:"${term}")`
    );
    const url = `${OPENFDA_BASE}?search=${search}&limit=${limit}`;
    const res = await fetchFn(url, { signal });
    if (!res.ok) {
        // openFDA returns 404 for "no matches" — surface as empty rather than throw.
        if (res.status === 404) {
            cacheSet(NAMESPACE, cacheKey, []);
            return [];
        }
        throw new Error(`openFDA search failed: HTTP ${res.status}`);
    }
    const body = await res.json();
    const results = Array.isArray(body?.results) ? body.results : [];
    const hits = results.map(normalizeLabel);
    cacheSet(NAMESPACE, cacheKey, hits);
    return hits;
}
