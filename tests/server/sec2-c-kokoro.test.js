// Regression lock: security audit 2026-10-26, L6-14 — the Kokoro model was
// downloaded from the Hugging Face Hub at `main` with no revision or checksum
// pin, so a changed or tampered upstream file was loaded into the native
// runtime unchecked. The cached files are now checked against pinned SHA-256s
// (before loading when cached, after a first download otherwise); a mismatch
// is a classed, fatal load error. Unit level, temp directories, no network.

import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    KOKORO_FILE_SHA256,
    KOKORO_MODEL_REVISION,
    KokoroIntegrityError,
    verifyKokoroModelFiles,
} from '../../server/services/kokoroTts.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-sec2c-kokoro-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

function cacheWith(files) {
    const dir = fs.mkdtempSync(path.join(tmp, 'cache-'));
    Object.entries(files).forEach(([rel, text]) => {
        const file = path.join(dir, 'm/x', rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    });
    return dir;
}

describe('Kokoro model integrity pin (L6-14)', () => {
    it('pins every file the q4 load reads, plus the Hub revision they were taken from', () => {
        expect(Object.keys(KOKORO_FILE_SHA256).sort()).toEqual(['config.json', 'onnx/model_q4.onnx', 'tokenizer.json', 'tokenizer_config.json']);
        Object.values(KOKORO_FILE_SHA256).forEach((h) => expect(h).toMatch(/^[0-9a-f]{64}$/));
        // The Hub's own LFS oid for onnx/model_q4.onnx.
        expect(KOKORO_FILE_SHA256['onnx/model_q4.onnx']).toBe('04cf570cf9c4153694f76347ed4b9a48c1b59ff1de0999e6605d123966b197c7');
        expect(KOKORO_MODEL_REVISION).toMatch(/^[0-9a-f]{40}$/);
    });

    it('accepts cached files that match', async () => {
        const dir = cacheWith({ 'onnx/model_q4.onnx': 'model', 'config.json': '{}' });
        const out = await verifyKokoroModelFiles({ cacheDir: dir, modelId: 'm/x', expected: { 'onnx/model_q4.onnx': sha('model'), 'config.json': sha('{}') } });
        expect(out).toEqual({ verified: ['onnx/model_q4.onnx', 'config.json'], missing: [] });
    });

    // Regression lock: a tampered cached model was loaded unchecked (L6-14)
    it('refuses a tampered file with a classed error', async () => {
        const dir = cacheWith({ 'onnx/model_q4.onnx': 'tampered' });
        const err = await verifyKokoroModelFiles({ cacheDir: dir, modelId: 'm/x', expected: { 'onnx/model_q4.onnx': sha('model') } }).catch((e) => e);
        expect(err).toBeInstanceOf(KokoroIntegrityError);
        expect(err.code).toBe('KOKORO_INTEGRITY');
        expect(err.file).toBe('onnx/model_q4.onnx');
    });

    it('reports files not yet downloaded as missing rather than verified', async () => {
        const dir = cacheWith({});
        const out = await verifyKokoroModelFiles({ cacheDir: dir, modelId: 'm/x', expected: { 'tokenizer.json': sha('t') } });
        expect(out).toEqual({ verified: [], missing: ['tokenizer.json'] });
    });

    it('re-hashes a file whose contents changed after it was verified', async () => {
        const dir = cacheWith({ 'config.json': 'a' });
        const expected = { 'config.json': sha('a') };
        await verifyKokoroModelFiles({ cacheDir: dir, modelId: 'm/x', expected });
        const file = path.join(dir, 'm/x', 'config.json');
        fs.writeFileSync(file, 'bb');
        await expect(verifyKokoroModelFiles({ cacheDir: dir, modelId: 'm/x', expected })).rejects.toBeInstanceOf(KokoroIntegrityError);
    });
});
