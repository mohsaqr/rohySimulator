// Pure-Node WAV decode + autocorrelation helpers for Phase 6 audio-fidelity
// tests. Kept dependency-free on purpose — these tests run inside the server
// project (node env) and we don't want to bring in a wav/dsp lib for a single
// test suite.
//
// Public API:
//   parseWav(buf)            -> { sampleRate, numChannels, bitsPerSample, pcm: Float32Array (mono, [-1,1]) }
//   estimateFundamental(opts)-> { lag, frequency } using time-domain autocorrelation
//
// The autocorrelation uses a coarse-to-fine search across the human voice F0
// range. We deliberately do NOT use FFT — voice fundamentals are well-resolved
// by simple lag-domain ACF for the synthesized speech we're checking, and a
// hand-rolled FFT would dwarf the actual test logic.

import { Buffer } from 'node:buffer';

// --- WAV parsing -----------------------------------------------------------
//
// We only support the canonical RIFF/WAVE/PCM-int16 layout that
// server/services/googleTts.js produces via wrapPcmAsWav(). Anything else
// throws a descriptive error so a future format change is easy to spot.
export function parseWav(buf) {
    if (!Buffer.isBuffer(buf)) {
        throw new Error('parseWav: expected a Buffer');
    }
    if (buf.length < 44) {
        throw new Error(`parseWav: buffer too small (${buf.length} bytes)`);
    }
    if (buf.slice(0, 4).toString('ascii') !== 'RIFF') {
        throw new Error('parseWav: missing RIFF magic');
    }
    if (buf.slice(8, 12).toString('ascii') !== 'WAVE') {
        throw new Error('parseWav: missing WAVE magic');
    }

    // Walk chunks starting at offset 12 ("WAVE" header end). Google's output
    // and our wrapPcmAsWav() both put `fmt ` immediately followed by `data`,
    // but we walk generically so a future LIST/INFO chunk wouldn't break us.
    let offset = 12;
    let sampleRate = 0;
    let numChannels = 0;
    let bitsPerSample = 0;
    let dataStart = -1;
    let dataLen = 0;

    while (offset + 8 <= buf.length) {
        const id = buf.slice(offset, offset + 4).toString('ascii');
        const size = buf.readUInt32LE(offset + 4);
        const body = offset + 8;

        if (id === 'fmt ') {
            // 16 = PCM, 18/40 = extended. We only need the first 16 bytes.
            const audioFormat = buf.readUInt16LE(body + 0);
            numChannels = buf.readUInt16LE(body + 2);
            sampleRate = buf.readUInt32LE(body + 4);
            bitsPerSample = buf.readUInt16LE(body + 14);
            if (audioFormat !== 1) {
                throw new Error(`parseWav: unsupported audioFormat ${audioFormat} (expected 1=PCM)`);
            }
            if (bitsPerSample !== 16) {
                throw new Error(`parseWav: unsupported bitsPerSample ${bitsPerSample} (expected 16)`);
            }
        } else if (id === 'data') {
            dataStart = body;
            dataLen = size;
            break;
        }
        // Chunks are padded to even sizes per the RIFF spec.
        offset = body + size + (size % 2);
    }

    if (dataStart < 0) throw new Error('parseWav: no data chunk found');
    if (!sampleRate)   throw new Error('parseWav: no fmt chunk before data');

    // De-interleave to mono float32 in [-1, 1]. For multi-channel input we
    // average channels — Google TTS is mono, but this keeps the helper honest
    // if anyone reuses it.
    const bytesPerSample = bitsPerSample / 8;
    const frameSize = bytesPerSample * numChannels;
    const numFrames = Math.floor(dataLen / frameSize);
    const pcm = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
        let acc = 0;
        for (let c = 0; c < numChannels; c++) {
            const sampleOffset = dataStart + i * frameSize + c * bytesPerSample;
            acc += buf.readInt16LE(sampleOffset);
        }
        pcm[i] = (acc / numChannels) / 32768;
    }

    return { sampleRate, numChannels, bitsPerSample, pcm };
}

// --- Autocorrelation pitch estimation --------------------------------------
//
// Classic time-domain ACF: for each candidate lag L in the search range,
// compute sum(x[n] * x[n+L]) over a window. The lag with the highest
// correlation (after a small bias subtraction) is the period; F0 = sr / lag.
//
// Search range is in Hz, defaulting to the adult-voice fundamental band.
// Google's en-US voices speak in the 80–300 Hz range; once shifted by ±5
// semitones the band stretches to ~60–450 Hz, so we widen the default
// accordingly.
export function estimateFundamental({
    pcm,
    sampleRate,
    minHz = 60,
    maxHz = 500,
    // Skip the leading silence / breath that some Google voices have; sample
    // a stable mid-utterance window so we're measuring sustained voicing.
    windowSec = 0.4,
    startSec = 0.2,
}) {
    if (!(pcm instanceof Float32Array)) {
        throw new Error('estimateFundamental: pcm must be Float32Array');
    }
    const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
    const maxLag = Math.min(pcm.length - 1, Math.ceil(sampleRate / minHz));
    if (maxLag <= minLag) {
        throw new Error(`estimateFundamental: pcm too short (${pcm.length}) for lag range [${minLag}, ${maxLag}]`);
    }

    const windowSize = Math.min(
        Math.floor(windowSec * sampleRate),
        pcm.length - maxLag - 1,
    );
    const startIdx = Math.min(
        Math.floor(startSec * sampleRate),
        Math.max(0, pcm.length - windowSize - maxLag - 1),
    );
    if (windowSize < maxLag * 2) {
        throw new Error(`estimateFundamental: window (${windowSize}) too short for maxLag (${maxLag})`);
    }

    // Remove DC offset over the analysis window so silence regions don't
    // produce a spurious peak at minLag.
    let mean = 0;
    for (let i = 0; i < windowSize; i++) mean += pcm[startIdx + i];
    mean /= windowSize;

    let bestLag = minLag;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let acf = 0;
        for (let i = 0; i < windowSize; i++) {
            const a = pcm[startIdx + i] - mean;
            const b = pcm[startIdx + i + lag] - mean;
            acf += a * b;
        }
        if (acf > bestScore) {
            bestScore = acf;
            bestLag = lag;
        }
    }

    return { lag: bestLag, frequency: sampleRate / bestLag, score: bestScore };
}
