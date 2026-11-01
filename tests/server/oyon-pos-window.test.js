// Regression lock: PRV-75 — Oyon's POS rPPG projected the whole 12 s heart-rate
// buffer as ONE window. Wang, den Brinker, Stuijk & de Haan (2017, IEEE TBME,
// "Algorithmic principles of remote PPG", Algorithm 1) project in short
// windows of l ≈ 1.6 s (32 frames at 20 fps), normalise each window by its own
// temporal mean, re-fit alpha = σ(S1)/σ(S2) per window and overlap-add the
// mean-centred h. The 12 s buffer is only the spectral window the BPM is read
// from. These tests pin the projection window at 1.6 s × fps, check accuracy on
// a synthetic 72 bpm pulse, and check that the bundle rohy actually loads
// (OyonR/standalone/app/dist-element/oyon-app.element.js) runs the same code.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    HeartRateEstimator,
    posSignal,
    posSignalWindowed,
    posWindowLength,
} from '../../OyonR/src/analytics/HeartRateEstimator.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUNDLE = path.join(repoRoot, 'OyonR', 'standalone', 'app', 'dist-element', 'oyon-app.element.js');

// mulberry32 — seeded, so every run sees the same noise.
function rng(seed) {
    let a = seed | 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function gaussian(u) {
    return () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
}

/**
 * Synthetic face-ROI RGB: a 1.2 Hz (72 bpm) pulse along the skin pulsatility
 * direction, multiplied by a slow illumination drift (0.05 Hz swing + linear
 * ramp + slow colour shift), plus in-band "specular" distortion and sensor
 * noise, sampled with ±3 ms timestamp jitter. With `flip`, the distortion's
 * colour direction changes half-way, so its POS tuning (S1/S2 ratio) differs
 * between the two halves — what a single 12 s alpha cannot follow.
 */
function synth({ fps = 20, seconds = 12, seed = 1, noise = 0.2, amp = 0.008, specular = 0, flip = false, hz = 1.2 } = {}) {
    const u = rng(seed);
    const g = gaussian(u);
    const base = { r: 150, g: 110, b: 90 };
    const pulseDir = { r: 0.33, g: 0.77, b: 0.53 };
    const comps = Array.from({ length: 6 }, () => ({ f: 0.8 + 1.7 * u(), ph: 2 * Math.PI * u() }));
    const n = Math.round(fps * seconds);
    return Array.from({ length: n }, (_, i) => {
        const t = i / fps;
        const late = t > seconds / 2;
        const illum = 1 + 0.08 * Math.sin(2 * Math.PI * 0.05 * t) + 0.01 * t;
        const chroma = { r: 1 + 0.03 * t / seconds, g: 1, b: 1 - 0.03 * t / seconds };
        const d = specular * comps.reduce((s, c) => s + Math.sin(2 * Math.PI * c.f * t + c.ph), 0) / 3;
        const dir = flip && late ? { r: 0.33, g: 0, b: 1 } : { r: -0.6, g: 0.2, b: 1 };
        const pulse = Math.sin(2 * Math.PI * hz * t);
        const ch = (k) => base[k] * illum * chroma[k] * (1 + d * dir[k]) * (1 + amp * pulseDir[k] * pulse) + noise * g();
        return { rgb: { r: ch('r'), g: ch('g'), b: ch('b') }, ts: 1000 * t + (u() - 0.5) * 6 };
    });
}

function estimateFrom(frames, options = {}) {
    const est = new HeartRateEstimator({ method: 'pos', bufferSeconds: 12, ...options });
    frames.forEach(({ rgb, ts }) => est.addSample(rgb, ts));
    return est.estimate();
}

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);

describe('PRV-75: POS projection window (Wang et al. 2017)', () => {
    it('defaults the projection window to 1.6 s, separate from the 12 s spectral buffer', () => {
        const est = new HeartRateEstimator();
        expect(est.options.posWindowSeconds).toBe(1.6);
        expect(est.options.bufferSeconds).toBe(12);
    });

    it.each([[20, 32], [30, 48], [16, 26]])('uses l = round(1.6 s × fps): %i fps → %i samples', (fps, samples) => {
        expect(posWindowLength(fps)).toBe(samples);
        const out = estimateFrom(synth({ fps, seed: 1 }));
        expect(out).not.toBeNull();
        expect(Math.round(out.fs)).toBe(fps);
        expect(out.pos_window_samples).toBe(posWindowLength(out.fs, 1.6));
        expect(out.pos_window_samples).toBe(samples);
    });

    it('reports no POS window for the green method', () => {
        expect(estimateFrom(synth({ seed: 1 }), { method: 'green' }).pos_window_samples).toBeNull();
    });

    it('projects in windows of exactly l samples: a one-sample change only reaches its l-sample neighbourhood', () => {
        // Property of a sliding window + overlap-add of step 1: perturbing input
        // k changes output only in [k − l + 1, k + l − 1]. A whole-buffer
        // projection changes every output sample.
        const frames = synth({ fps: 20, seed: 3 });
        const r = frames.map((f) => f.rgb.r);
        const g = frames.map((f) => f.rgb.g);
        const b = frames.map((f) => f.rgb.b);
        const l = posWindowLength(20);
        const k = 120;
        const bumped = r.map((v, i) => (i === k ? v + 5 : v));
        const before = posSignalWindowed(r, g, b, 20);
        const after = posSignalWindowed(bumped, g, b, 20);
        const changed = before.map((v, i) => v !== after[i]);
        const changedIdx = changed.flatMap((c, i) => (c ? [i] : []));
        expect(changedIdx[0]).toBe(k - l + 1);
        expect(changedIdx.at(-1)).toBe(k + l - 1);
        expect(changedIdx.length).toBe(2 * l - 1);

        const wholeBefore = posSignal(r, g, b);
        const wholeAfter = posSignal(bumped, g, b);
        expect(wholeBefore.every((v, i) => v !== wholeAfter[i])).toBe(true);
    });

    it('each window is normalised by its own mean: a channel gain change in one window leaves distant windows untouched', () => {
        const frames = synth({ fps: 20, seed: 4 });
        const r = frames.map((f) => f.rgb.r);
        const g = frames.map((f) => f.rgb.g);
        const b = frames.map((f) => f.rgb.b);
        // Scale the first 40 samples of every channel by 1.5 (an exposure step):
        // per-window normalisation makes every window fully inside that span
        // project identically, and windows past it are not affected at all.
        const scale = (a) => a.map((v, i) => (i < 40 ? v * 1.5 : v));
        const base = posSignalWindowed(r, g, b, 20);
        const stepped = posSignalWindowed(scale(r), scale(g), scale(b), 20);
        const l = posWindowLength(20);
        const tail = base.slice(40 + l, 200);
        tail.forEach((v, i) => expect(stepped[40 + l + i]).toBe(v));
        base.slice(0, 40 - l).forEach((v, i) => expect(stepped[i]).toBeCloseTo(v, 9));
    });

    it.each(SEEDS)('recovers a 72 bpm pulse under slow illumination drift and noise within ±3 bpm (seed %i)', (seed) => {
        const out = estimateFrom(synth({ fps: 20, seed }));
        expect(out).not.toBeNull();
        expect(Math.abs(out.bpm - 72)).toBeLessThanOrEqual(3);
    });

    const FLIP_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
    const flipErrors = (posWindowSeconds) => FLIP_SEEDS.map((seed) => {
        const out = estimateFrom(synth({ fps: 20, seed, specular: 0.015, flip: true }), { posWindowSeconds });
        return out ? Math.abs(out.bpm - 72) : Infinity;
    });

    it('follows a distortion whose colour direction changes mid-buffer, within ±3 bpm on every seed', () => {
        expect(flipErrors(1.6).filter((e) => e > 3)).toEqual([]);
    });

    it('documents the defect: one 12 s projection window (the pre-fix behaviour) misses most of the same seeds', () => {
        // posWindowSeconds = bufferSeconds makes l = n: a single window, one
        // alpha for the whole buffer — exactly what shipped before PRV-75.
        const misses = flipErrors(12).filter((e) => e > 3).length;
        expect(misses).toBeGreaterThanOrEqual(10);
    });

    it('rejects nothing finite: zero channels and a flat signal give a finite output', () => {
        const zeros = new Array(64).fill(0);
        const flat = new Array(64).fill(100);
        expect(posSignalWindowed(zeros, zeros, zeros, 20).every(Number.isFinite)).toBe(true);
        expect(posSignalWindowed(flat, flat, flat, 20).every((v) => v === 0)).toBe(true);
        // Shorter than one window → the whole-buffer projection.
        const short = synth({ fps: 20, seed: 5 }).slice(0, 20);
        const [r, g, b] = ['r', 'g', 'b'].map((k) => short.map((f) => f.rgb[k]));
        expect(posSignalWindowed(r, g, b, 20)).toEqual(posSignal(r, g, b));
    });
});

describe('PRV-75: the element bundle rohy loads runs the windowed POS', () => {
    const bundle = fs.readFileSync(BUNDLE, 'utf8');
    const begin = bundle.indexOf('/*oyon:pos-windowed:begin');
    const end = bundle.indexOf('/*oyon:pos-windowed:end*/');

    it('carries the windowed projection and calls it from the estimator', () => {
        expect(begin).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(begin);
        expect(bundle).toContain('posWindowSeconds:1.6');
        expect(bundle).toContain('=__oyonPosWindowed(');
        expect(bundle).toContain('pos_window_samples:');
    });

    it('is numerically identical to the source implementation', () => {
        const code = bundle.slice(begin, end);
        // The bundle's fallback calls its minified whole-buffer projection
        // (BY); inject the source one under that name.
        const factory = new Function('BY', `${code}; return { __oyonPosWindowed, __oyonPosWindowLength };`);
        const shipped = factory(posSignal);
        [16, 20, 30].forEach((fps) => {
            const frames = synth({ fps, seed: 7, specular: 0.01, flip: true });
            const [r, g, b] = ['r', 'g', 'b'].map((k) => frames.map((f) => f.rgb[k]));
            expect(shipped.__oyonPosWindowLength(fps, 1.6)).toBe(posWindowLength(fps, 1.6));
            expect(shipped.__oyonPosWindowed(r, g, b, fps, 1.6)).toEqual(posSignalWindowed(r, g, b, fps, 1.6));
        });
    });
});
