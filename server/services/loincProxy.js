// LOINC search proxy via NLM Clinical Tables API.
//
// Upstream: https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search
// License: Free with attribution (Regenstrief Institute).
//
// Why Clinical Tables and not the LOINC release zip?
//   The release zip is 80+ MB and would have to be parsed, indexed, and
//   refreshed manually. Clinical Tables exposes a public typeahead REST
//   surface that already does fuzzy matching on COMPONENT and
//   LONG_COMMON_NAME — exactly what the catalogue Search tab needs.
//
// Response shape (from upstream, idiosyncratic):
//   [
//     0: total count,
//     1: array of LOINC codes matched,
//     2: array of code-system extra info (unused),
//     3: array of [LOINC_NUM, COMPONENT, LONG_COMMON_NAME, EXAMPLE_UCUM_UNITS] tuples,
//     4: array of additional info (unused),
//   ]
//
// We normalize to the same {external_source, external_id, display_name, ...}
// shape the route layer uses for medication search hits, plus a
// `loinc_long_name` and `ucum_unit` so the client can preview before
// "Add to my catalogue".

import { cacheGet, cacheSet, getFetch } from './proxyCache.js';

const NAMESPACE = 'loinc';
const CT_BASE = 'https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search';
const FIELDS = 'LOINC_NUM,COMPONENT,LONG_COMMON_NAME,EXAMPLE_UCUM_UNITS';

export async function searchLoinc(query, { limit = 20, signal } = {}) {
    const q = (query || '').trim();
    if (!q) return [];
    const cacheKey = `q:${q.toLowerCase()}:${limit}`;
    const cached = cacheGet(NAMESPACE, cacheKey);
    if (cached) return cached;

    const fetchFn = getFetch();
    if (!fetchFn) throw new Error('loincProxy: global fetch unavailable');

    const url = `${CT_BASE}?terms=${encodeURIComponent(q)}&maxList=${limit}&df=${encodeURIComponent(FIELDS)}`;
    const res = await fetchFn(url, { signal });
    if (!res.ok) throw new Error(`Clinical Tables LOINC search failed: HTTP ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body)) return [];
    const tuples = Array.isArray(body[3]) ? body[3] : [];
    const hits = tuples.map((tuple) => {
        const [loincNum, component, longCommonName, exampleUcum] = tuple;
        return {
            external_source: 'loinc',
            external_id: loincNum,
            loinc_code: loincNum,
            display_name: longCommonName || component || loincNum,
            component: component || null,
            loinc_long_name: longCommonName || null,
            ucum_unit: exampleUcum || null,
        };
    });
    cacheSet(NAMESPACE, cacheKey, hits);
    return hits;
}
