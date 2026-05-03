// Shared WAV helpers — used by the Piper subprocess path (raw PCM + header)
// and the Kokoro streaming path (float32 from the model).

import { Buffer } from 'node:buffer';

// Build the 44-byte RIFF/WAVE header for 16-bit mono PCM.
export function buildWavHeader(pcmByteLength, sampleRate) {
    const numChannels = 1, bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const buf = Buffer.alloc(44);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + pcmByteLength, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);          // PCM
    buf.writeUInt16LE(numChannels, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(byteRate, 28);
    buf.writeUInt16LE(blockAlign, 32);
    buf.writeUInt16LE(bitsPerSample, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(pcmByteLength, 40);
    return buf;
}

// Pack Float32 -1..1 PCM samples into a Buffer of int16 LE bytes, with clipping.
export function float32ToInt16Buffer(float32) {
    const buf = Buffer.alloc(float32.length * 2);
    for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        buf.writeInt16LE((s < 0 ? s * 0x8000 : s * 0x7fff) | 0, i * 2);
    }
    return buf;
}
