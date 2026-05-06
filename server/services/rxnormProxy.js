// RxNorm (NLM RxNav) search proxy.
//
// Upstream: https://rxnav.nlm.nih.gov/REST/
// License: Public domain (NLM). Free, no auth needed, generous limits.
//
// Endpoints used:
//   /approximateTerm.json?term=<q>&maxEntries=<n>   — fuzzy name search
//   /rxcui/<rxcui>/properties.json                  — canonical name + synonym
//
// Why approximateTerm over /drugs.json:
//   /drugs.json is exact-match on a single name. approximateTerm returns
//   ranked suggestions for typeahead-style search ("aspir" → Aspirin),
//   which is what the catalogue Search tab wants. /drugs.json fits
//   "I have a confirmed name, give me the variants" — useful later for
//   normalization, not for search.
//
// The proxy does NOT mutate the DB. A search hit is a transient suggestion;
// only when the user clicks "Add to my catalogue" does the route layer
// INSERT a medications row. That's intentional — we don't want every
// keystroke to inflate medications with throwaway rows.

import { cacheGet, cacheSet, getFetch } from './proxyCache.js';

const NAMESPACE = 'rxnorm';
const RXNAV_BASE = 'https://rxnav.nlm.nih.gov/REST';

function normHit(candidate) {
    return {
        external_source: 'rxnorm',
        external_id: candidate.rxcui || null,
        rxcui: candidate.rxcui || null,
        display_name: candidate.name || candidate.candidate || '',
        score: typeof candidate.score === 'string' ? Number(candidate.score) : (candidate.score ?? null),
        synonym: candidate.synonym || null,
    };
}

export async function searchRxNorm(query, { limit = 20, signal } = {}) {
    const q = (query || '').trim();
    if (!q) return [];
    const cacheKey = `q:${q.toLowerCase()}:${limit}`;
    const cached = cacheGet(NAMESPACE, cacheKey);
    if (cached) return cached;

    const fetchFn = getFetch();
    if (!fetchFn) throw new Error('rxnormProxy: global fetch unavailable');

    const url = `${RXNAV_BASE}/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=${limit}`;
    const res = await fetchFn(url, { signal });
    if (!res.ok) {
        throw new Error(`RxNav approximateTerm failed: HTTP ${res.status}`);
    }
    const body = await res.json();
    const candidates = body?.approximateGroup?.candidate || [];
    // De-dup on rxcui — RxNav frequently returns the same drug under
    // multiple synonyms. Keep the highest score per rxcui.
    const byRxcui = new Map();
    for (const c of candidates) {
        const key = c.rxcui || `name:${c.name}`;
        const existing = byRxcui.get(key);
        if (!existing || Number(c.score) > Number(existing.score)) {
            byRxcui.set(key, c);
        }
    }
    const hits = Array.from(byRxcui.values()).map(normHit);
    cacheSet(NAMESPACE, cacheKey, hits);
    return hits;
}

export async function lookupRxCui(rxcui, { signal } = {}) {
    if (!rxcui) return null;
    const cacheKey = `rxcui:${rxcui}`;
    const cached = cacheGet(NAMESPACE, cacheKey);
    if (cached) return cached;
    const fetchFn = getFetch();
    if (!fetchFn) throw new Error('rxnormProxy: global fetch unavailable');
    const url = `${RXNAV_BASE}/rxcui/${encodeURIComponent(rxcui)}/properties.json`;
    const res = await fetchFn(url, { signal });
    if (!res.ok) return null;
    const body = await res.json();
    const props = body?.properties || null;
    if (!props) return null;
    const out = {
        rxcui: props.rxcui,
        name: props.name,
        synonym: props.synonym || null,
        tty: props.tty || null,
    };
    cacheSet(NAMESPACE, cacheKey, out);
    return out;
}
