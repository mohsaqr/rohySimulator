// PCM frame alignment helpers.
//
// Streaming s16le audio (the on-the-wire format both OpenAI and our
// `application/x-rohy-pcm-stream` framing use) requires every emitted
// chunk to contain a whole number of int16 samples — i.e. an even byte
// count. A single odd-length chunk silently shifts every subsequent
// sample by one byte at the receiver, producing the "chec-chec-sshhh"
// noise that bit us mid-session.
//
// Two callsites need this: the OpenAI iterator (server/services/openaiTts.js)
// which also coalesces tiny network chunks to a minimum size, and the
// generic `pipePcmStream` helper (server/routes.js) which wraps Google
// and Kokoro. Pull the alignment math into one place so future provider
// changes can't reintroduce the divergence.
//
// `EvenByteAligner` is a tiny per-stream state machine: feed it raw bytes
// via `push()`, get back the even-length portion ready to emit. Any odd
// trailing byte is held internally and stitched onto the front of the next
// push. `flush()` returns whatever odd byte (if any) is still held when
// the upstream stream ends — callers typically drop it (a half-sample is
// inaudible noise; better than misaligning the next stream).

import { Buffer } from 'node:buffer';

export class EvenByteAligner {
    constructor() {
        this.carry = null;
    }

    /**
     * Add `buf` to the aligned stream. Returns the next emittable chunk
     * (even-length) or `null` when the carry doesn't yet form a full
     * sample on its own.
     */
    push(buf) {
        if (!buf || buf.length === 0) return null;
        const combined = this.carry
            ? Buffer.concat([this.carry, buf], this.carry.length + buf.length)
            : buf;
        const evenLen = combined.length - (combined.length & 1);
        this.carry = evenLen < combined.length ? combined.subarray(evenLen) : null;
        return evenLen > 0 ? combined.subarray(0, evenLen) : null;
    }

    /**
     * Return any held odd byte at end-of-stream and reset the aligner.
     * Callers usually drop the returned byte — half a sample can't be
     * decoded and emitting it would shift the next stream.
     */
    flush() {
        const tail = this.carry;
        this.carry = null;
        return tail;
    }
}
