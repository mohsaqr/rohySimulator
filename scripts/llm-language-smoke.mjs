#!/usr/bin/env node
// Per-language LLM smoke test (I18N_PLAN.md §4.4, Phase A).
//
// For every non-English language in the registry, sends probes through the
// real /api/proxy/llm route (auth, budget, prompt assembly — the full path
// a student hits) and asserts the reply is in the target language via a
// stopword heuristic. Two probes per language:
//   1. First turn  — an ENGLISH question; the directive alone must flip the
//      reply language (the case prompt is English, as authored cases are).
//   2. Drift turn  — a follow-up after an English assistant turn, the
//      documented drift risk (I18N_PLAN.md §10).
//
// Usage:
//   node scripts/llm-language-smoke.mjs
// Env:
//   ROHY_BASE_URL   default http://localhost:3000
//   ROHY_USERNAME / ROHY_PASSWORD   login used to obtain a token, OR
//   ROHY_TOKEN      a ready bearer token (skips login)
//   ROHY_LANGS      comma-separated registry codes to test (default: all non-en)
//
// Requires a running server with an LLM provider configured. Exits 1 on any
// failed probe so it can gate a release checklist.

import { LANGUAGES, DEFAULT_LANGUAGE } from '../server/shared/languages.js';

const BASE_URL = process.env.ROHY_BASE_URL || 'http://localhost:3000';

// Cheap language-detection heuristic: high-frequency function words that are
// near-unambiguous per language. ≥ MIN_HITS distinct hits = that language.
// Deliberately no dependency — franc-style detection is overkill for a
// pass/fail gate on 3 known languages.
const STOPWORDS = {
    it: ['sono', 'che', 'non', 'per', 'una', 'con', 'come', 'anche', 'molto', 'dolore', 'bene', 'grazie'],
    fi: ['olen', 'minulla', 'mutta', 'kanssa', 'koska', 'kipu', 'hyvin', 'kiitos', 'joka', 'tämä', 'kun'],
    sv: ['jag', 'är', 'och', 'att', 'det', 'har', 'inte', 'som', 'med', 'ont', 'tack', 'mycket'],
    es: ['estoy', 'tengo', 'siento', 'muy', 'también', 'porque', 'usted', 'está', 'gracias', 'pecho', 'dolor', 'bien']
};
const MIN_HITS = 2;

function detectLanguage(text, code) {
    const words = new Set(String(text).toLowerCase().match(/\p{L}+/gu) || []);
    const hits = (STOPWORDS[code] || []).filter(w => words.has(w));
    return { pass: hits.length >= MIN_HITS, hits };
}

async function getToken() {
    if (process.env.ROHY_TOKEN) return process.env.ROHY_TOKEN;
    const username = process.env.ROHY_USERNAME;
    const password = process.env.ROHY_PASSWORD;
    if (!username || !password) {
        console.error('Set ROHY_TOKEN, or ROHY_USERNAME + ROHY_PASSWORD, to authenticate.');
        process.exit(2);
    }
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
        console.error(`Login failed: ${res.status} ${await res.text()}`);
        process.exit(2);
    }
    return (await res.json()).token;
}

async function askLlm(token, { messages, caseLanguage }) {
    const res = await fetch(`${BASE_URL}/api/proxy/llm`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            messages,
            system_prompt: 'You are Anna Virtanen, a 58-year-old patient admitted with chest pain. Answer the student in character, briefly.',
            case_language: caseLanguage
        })
    });
    if (!res.ok) throw new Error(`/proxy/llm ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '';
}

async function probeLanguage(token, code) {
    const results = [];

    // Probe 1 — first turn, English question, English case prompt.
    const first = await askLlm(token, {
        caseLanguage: code,
        messages: [{ role: 'user', content: 'Hello, can you tell me what brought you to the hospital today?' }]
    });
    results.push({ probe: 'first-turn', reply: first, ...detectLanguage(first, code) });

    // Probe 2 — drift check: an English assistant turn already in history.
    const drift = await askLlm(token, {
        caseLanguage: code,
        messages: [
            { role: 'user', content: 'Hello, how are you feeling?' },
            { role: 'assistant', content: 'I have had this crushing chest pain since this morning, doctor.' },
            { role: 'user', content: 'Can you describe the pain and where it radiates?' }
        ]
    });
    results.push({ probe: 'drift-turn', reply: drift, ...detectLanguage(drift, code) });

    return results;
}

const requested = (process.env.ROHY_LANGS || '').split(',').map(s => s.trim()).filter(Boolean);
const codes = (requested.length ? requested : Object.keys(LANGUAGES))
    .filter(code => code !== DEFAULT_LANGUAGE && LANGUAGES[code]);

const token = await getToken();
let failures = 0;

for (const code of codes) {
    const { name } = LANGUAGES[code];
    console.log(`\n=== ${name} (${code}) ===`);
    try {
        const results = await probeLanguage(token, code);
        for (const r of results) {
            const status = r.pass ? 'PASS' : 'FAIL';
            if (!r.pass) failures += 1;
            console.log(`  [${status}] ${r.probe} — stopword hits: ${r.hits.join(', ') || '(none)'}`);
            console.log(`         reply: ${r.reply.slice(0, 160).replace(/\s+/g, ' ')}…`);
        }
    } catch (err) {
        failures += 1;
        console.log(`  [FAIL] ${err.message}`);
    }
}

console.log(failures === 0
    ? '\nAll language probes passed.'
    : `\n${failures} probe(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
