#!/usr/bin/env node
// Synthesise the auscultation clips the seeded cases need and the repo had no
// recording of: an S4 gallop (the default STEMI case, 92 bpm).
//
// Synthetic on purpose. A recording would need a licence and provenance; this
// is reproducible from the script, byte for byte (a seeded PRNG drives the
// noise floor and the beat jitter), and it says what it is. Each heart sound
// is a short burst of damped low-frequency sinusoids under a Gaussian
// envelope — S1 (mitral then tricuspid closure), S2 (aortic then pulmonary),
// and for the gallop a softer, lower S4 in late diastole just before S1.
//
// Usage: node scripts/generate-auscultation-audio.mjs [outDir]   (default public/sounds)

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const SAMPLE_RATE = 11025;

/** Mulberry32: a tiny deterministic PRNG, so the output never changes run to run. */
function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Add one heart-sound component centred at `at` seconds into `out`. */
function addSound(out, { at, width, freqs, amp }) {
    const centre = Math.round(at * SAMPLE_RATE);
    const half = Math.round(width * 2 * SAMPLE_RATE);
    const sigma = width * SAMPLE_RATE / 2;
    const start = Math.max(0, centre - half);
    const end = Math.min(out.length, centre + half);
    // A sample loop: each sample depends on its own offset only, and the
    // component spans a few hundred samples.
    for (let i = start; i < end; i += 1) {
        const offset = i - centre;
        const envelope = Math.exp(-(offset * offset) / (2 * sigma * sigma));
        const t = offset / SAMPLE_RATE;
        const tone = freqs.reduce((sum, f, k) => sum + Math.sin(2 * Math.PI * f * t + k) / (k + 1), 0);
        out[i] += amp * envelope * tone;
    }
}

/**
 * A phonocardiogram-like clip.
 *
 * @param {object} options
 * @param {number} options.bpm         heart rate
 * @param {number} options.seconds     duration
 * @param {boolean} options.s4         add an S4 before each S1
 * @param {number} options.seed
 * @returns {Float64Array}
 */
export function synthesiseHeart({ bpm, seconds, s4, seed }) {
    const random = prng(seed);
    const out = new Float64Array(Math.round(seconds * SAMPLE_RATE));
    const cycle = 60 / bpm;
    const systole = 0.30;          // S1 → S2 at ~90 bpm
    const beats = Math.floor(seconds / cycle);
    Array.from({ length: beats }, (_, n) => n).forEach((n) => {
        const jitter = (random() - 0.5) * 0.012;
        const s1 = 0.12 + n * cycle + jitter;
        if (s4) addSound(out, { at: s1 - 0.09, width: 0.022, freqs: [32, 44], amp: 0.42 });
        addSound(out, { at: s1, width: 0.020, freqs: [58, 92, 140], amp: 1.0 });          // M1
        addSound(out, { at: s1 + 0.022, width: 0.018, freqs: [64, 110], amp: 0.55 });     // T1
        addSound(out, { at: s1 + systole, width: 0.015, freqs: [80, 130, 190], amp: 0.78 }); // A2
        addSound(out, { at: s1 + systole + 0.028, width: 0.013, freqs: [90, 150], amp: 0.38 }); // P2
    });
    // A faint broadband floor (chest wall, stethoscope), low-passed by a
    // one-pole filter so it sounds like a room, not like hiss.
    let floor = 0;
    for (let i = 0; i < out.length; i += 1) { // one-pole IIR: each sample needs the previous
        floor = 0.94 * floor + 0.06 * (random() * 2 - 1);
        out[i] += 0.05 * floor;
    }
    return out;
}

/** 16-bit PCM mono WAV bytes, peak-normalised to -1 dBFS. */
export function toWav(samples) {
    const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
    const gain = (10 ** (-1 / 20)) / peak;
    const data = Buffer.alloc(samples.length * 2);
    samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * gain * 32767))), i * 2));
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);              // PCM
    header.writeUInt16LE(1, 22);              // mono
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

export const CLIPS = Object.freeze([
    { file: 's4-gallop.wav', options: { bpm: 92, seconds: 12, s4: true, seed: 4021 } },
]);

if (import.meta.url === `file://${process.argv[1]}`) {
    const outDir = process.argv[2] ?? path.join('public', 'sounds');
    mkdirSync(outDir, { recursive: true });
    CLIPS.forEach(({ file, options }) => {
        const bytes = toWav(synthesiseHeart(options));
        writeFileSync(path.join(outDir, file), bytes);
        process.stdout.write(`${path.join(outDir, file)}  ${bytes.length} bytes\n`);
    });
}
