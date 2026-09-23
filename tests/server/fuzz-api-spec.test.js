// The document the API fuzzer reads (scripts/fuzz-api-spec.mjs) and the
// reference it is built from (docs/reference/api/openapi.json).
//
// A path parameter the reference does not declare makes schemathesis skip or
// refuse the operation, and a reference whose server is '/api' while its paths
// already start with /api sends every request to /api/api/… — both were true
// before 2026-09-23 and both would turn the fuzzer into a run that tests
// nothing while reporting green.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fuzzDocument } from '../../scripts/fuzz-api-spec.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const reference = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/reference/api/openapi.json'), 'utf8'));
const operations = (doc) => Object.entries(doc.paths).flatMap(([p, item]) =>
    Object.entries(item).map(([method, op]) => ({ path: p, method, op })));

describe('the generated OpenAPI reference', () => {
    it('declares every templated path parameter, as OpenAPI requires', () => {
        const undeclared = operations(reference).flatMap(({ path: p, method, op }) => {
            const templated = [...p.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(([, name]) => name);
            const declared = new Set((op.parameters ?? []).filter((x) => x.in === 'path').map((x) => x.name));
            return templated.filter((name) => !declared.has(name)).map((name) => `${method} ${p} {${name}}`);
        });
        expect(undeclared).toEqual([]);
    });

    it('does not prefix /api twice: the paths carry it, so the server is the root', () => {
        expect(Object.keys(reference.paths).every((p) => p.startsWith('/api/'))).toBe(true);
        expect(reference.servers).toEqual([{ url: '/' }]);
    });

    it('names the auth cookie the server actually reads', () => {
        expect(reference.components.securitySchemes.cookieAuth.name).toBe('rohy_auth');
    });
});

describe('fuzzDocument', () => {
    const doc = fuzzDocument(reference);

    it('gives every mutating operation an optional JSON-object body', () => {
        const mutating = operations(doc).filter(({ method }) => ['post', 'put', 'patch'].includes(method));
        expect(mutating.length).toBeGreaterThan(50);
        mutating.forEach(({ op }) => {
            expect(op.requestBody.required).toBe(false);
            expect(op.requestBody.content['application/json'].schema).toEqual({ type: 'object' });
        });
    });

    it('leaves reads alone and does not modify the reference', () => {
        operations(doc).filter(({ method }) => method === 'get')
            .forEach(({ op }) => expect(op.requestBody).toBeUndefined());
        operations(reference).forEach(({ op }) => expect(op.requestBody).toBeUndefined());
    });

    it('keeps a body an operation already declares', () => {
        const declared = { content: { 'multipart/form-data': { schema: { type: 'object' } } } };
        const out = fuzzDocument({ paths: { '/api/x': { post: { requestBody: declared } } } });
        expect(out.paths['/api/x'].post.requestBody).toEqual(declared);
    });
});
