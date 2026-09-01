// The 3D room's ECG sampler.
//
// The waveform physiology is NOT duplicated here: `cardiacIntervals` and
// `GenerateECGRaw` come from src/services/ecgWaveform.js, the module the
// bedside monitor draws from, so the mirrored trace cannot drift from the
// monitor's. What this file owns is the sampling — turning a live vitals
// feed into 250 Hz samples with rhythm handling. ecgWaveform.test.js pins
// both halves.
export { cardiacIntervals, GenerateECGRaw } from '../../services/ecgWaveform';
import { GenerateECGRaw } from '../../services/ecgWaveform';

export const SAMPLE_RATE_HZ = 250;
export const SAMPLE_INTERVAL_MS = 1000 / SAMPLE_RATE_HZ; // 4 ms


/**
 * Create a rhythm-aware sample producer for mirroring surfaces.
 *
 * A slimmed-down version of PatientMonitor's stepSample cardiac-phase logic
 * (NSR / AFib RR jitter / VTach / VFib / Asystole; monitor-local extras like
 * PVC scheduling and ST/noise conditions are not mirrored). `getFeed` returns
 * the latest `{ hr, rhythm }` — e.g. from EventLogger.currentVitals — and is
 * read on every sample so the mirror follows live changes.
 */
export function createEcgSampler(getFeed) {
   let phase = 0;
   let nextBeatDuration = 750;

   return {
      /** Advance the cardiac phase by dt milliseconds and return one sample (mV). */
      step(dt) {
         const feed = getFeed() || {};
         const rhythm = feed.rhythm || 'NSR';
         const hr = Number(feed.hr);
         const safeHr = Number.isFinite(hr) && hr > 0 ? hr : 0;

         if (rhythm === 'Asystole' || (safeHr === 0 && rhythm !== 'VFib')) {
            phase = 0;
            return GenerateECGRaw(0, { isAsystole: true });
         }
         if (rhythm === 'VFib') {
            phase += dt / 200;
            if (phase >= 1.0) phase -= 1.0;
            return GenerateECGRaw(phase, { isVfib: true });
         }

         let targetDuration = 60000 / safeHr;
         if (rhythm === 'AFib') {
            // ±400ms RR jitter — clearly irregular at any base HR.
            targetDuration += Math.random() * 800 - 400;
         }
         phase += dt / nextBeatDuration;
         if (phase >= 1.0) {
            phase -= 1.0;
            nextBeatDuration = Math.max(250, targetDuration);
         }

         return GenerateECGRaw(phase, {
            hr: safeHr,
            hideP: rhythm === 'AFib' || rhythm === 'VTach',
            afibNoise: rhythm === 'AFib',
            isVtach: rhythm === 'VTach',
         });
      },
   };
}
