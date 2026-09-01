import { SAMPLE_INTERVAL_MS, createEcgSampler } from './ecgWaveform.js';

const BUFFER_LEN = 1250; // 5 seconds visible at 250 Hz

/**
 * Drive a canvas with the monitor's real ECG signal.
 *
 * Mirrors PatientMonitor's rendering pipeline: a fixed-timestep 250 Hz
 * sampler (decoupled from rAF so the QRS never aliases) filling a ring
 * buffer, painted the same way as the monitor's drawCanvas (green trace,
 * mid-baseline, 0.4·h per mV). `getFeed` returns the live `{ hr, rhythm }`.
 *
 * Returns a stop() function; call it on unmount.
 */
export function startEcgMirror(canvas, getFeed) {
    if (!canvas || typeof canvas.getContext !== 'function') {
        throw new Error('startEcgMirror requires a canvas element.');
    }
    if (typeof getFeed !== 'function') {
        throw new Error('startEcgMirror requires a getFeed() function.');
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return () => {};
    }

    const sampler = createEcgSampler(getFeed);
    const buffer = new Array(BUFFER_LEN).fill(0);
    let animationId = 0;
    let lastTime = performance.now();
    let sampleAccum = 0;

    const draw = () => {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = '#2ae0bd';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const step = w / buffer.length;
        const baseline = h / 2;
        const scale = -(h * 0.4); // negative flips Y: up is positive voltage
        buffer.forEach((value, index) => {
            const x = index * step;
            const y = baseline + value * scale;
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    };

    const loop = (time) => {
        sampleAccum += time - lastTime;
        lastTime = time;
        if (sampleAccum > 200) sampleAccum = 200; // cap catch-up after a stalled tab
        while (sampleAccum >= SAMPLE_INTERVAL_MS) {
            sampleAccum -= SAMPLE_INTERVAL_MS;
            buffer.shift();
            buffer.push(sampler.step(SAMPLE_INTERVAL_MS));
        }
        draw();
        animationId = requestAnimationFrame(loop);
    };
    animationId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animationId);
}
