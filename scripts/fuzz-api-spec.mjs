#!/usr/bin/env node
// The OpenAPI document the API fuzzer reads (scripts/fuzz-api.sh).
//
//   node scripts/fuzz-api-spec.mjs <out.json>
//
// docs/reference/api/openapi.json is generated from the route files and knows
// paths, methods, path parameters and auth — but no request bodies, because a
// route's body shape is not in its registration line. A fuzzer given that
// document sends every POST/PUT/PATCH with no body at all, which exercises the
// "missing body" branch of every handler and nothing else.
//
// So this adds, FOR THE FUZZER ONLY, an optional JSON-object body to every
// mutating operation: "some JSON object, any keys". It is not written back to
// the reference, because it is not true of every route (uploads take
// multipart) and the reference must not claim it is.
//
// Deterministic: the same openapi.json always yields the same fuzz document.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(REPO_ROOT, 'docs', 'reference', 'api', 'openapi.json');
const MUTATING = new Set(['post', 'put', 'patch']);

/**
 * The fuzz document for a reference document: every mutating operation that
 * declares no requestBody gets an optional `application/json` object body.
 *
 * @param {object} reference the parsed openapi.json
 * @returns {object} a new document; the input is not modified
 */
export function fuzzDocument(reference) {
    const doc = structuredClone(reference);
    Object.values(doc.paths ?? {}).forEach((item) => {
        Object.entries(item).forEach(([method, op]) => {
            if (!MUTATING.has(method) || op.requestBody) return;
            op.requestBody = {
                required: false,
                content: { 'application/json': { schema: { type: 'object' } } },
            };
        });
    });
    return doc;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const out = process.argv[2];
    if (!out) {
        console.error('usage: node scripts/fuzz-api-spec.mjs <out.json>');
        process.exit(2);
    }
    const doc = fuzzDocument(JSON.parse(fs.readFileSync(SOURCE, 'utf8')));
    fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`[fuzz-api-spec] ${Object.keys(doc.paths).length} paths → ${out}`);
}
