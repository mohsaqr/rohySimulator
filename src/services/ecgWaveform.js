// Physiologic ECG waveform generation, extracted verbatim from
// PatientMonitor.jsx so other surfaces (the 3D patient room overlay) can
// mirror the monitor's real signal instead of drawing a decorative wave.
// PatientMonitor remains the reference consumer.

export const SAMPLE_RATE_HZ = 250;
export const SAMPLE_INTERVAL_MS = 1000 / SAMPLE_RATE_HZ; // 4 ms

// Gaussian helper (t, a, c=center, s=sigma). All in ms.
const gaussMs = (t, a, c, s) => a * Math.exp(-((t - c) * (t - c)) / (2 * s * s));

// Physiologic intervals (ms) as functions of HR.
export const cardiacIntervals = (hr) => {
   const safeHr = Math.max(20, Math.min(220, hr || 60));
   const RR = 60000 / safeHr;
   // Atterhög 1977 regression, clamped to physiologic bounds
   let PR = 176.7 - 0.351 * safeHr;
   PR = Math.max(110, Math.min(220, PR));
   PR = Math.min(PR, RR * 0.4); // never let PR dominate the cycle
   const QRS = 90;
   // Fridericia (RR in seconds)
   let QT = 400 * Math.cbrt(RR / 1000);
   // Always leave ≥15% of cycle for diastolic baseline
   QT = Math.min(QT, RR * 0.85 - PR);
   QT = Math.max(QT, QRS + 80);
   return { RR, PR, QRS, QT };
};

export const GenerateECGRaw = (phase, options = {}) => {
   const {
      stElev = 0,
      tInv = 0,
      wideQRS = 0,
      noise = 0,
      hr = 80,
      hideP = false,
      afibNoise = false,
      isPVC = false,
      isVfib = false,
      isAsystole = false,
      isVtach = false
   } = options;

   if (isAsystole) {
      return (Math.random() - 0.5) * 0.02;
   }
   if (isVfib) {
      // Coarse 5-7 Hz fibrillation with random amplitude modulation. Phase
      // wraps every 200ms in the producer, so phase * 2π gives 5 Hz primary.
      return Math.sin(phase * 2 * Math.PI) * (0.4 + 0.2 * Math.sin(phase * 9.7))
           + Math.sin(phase * 2 * Math.PI * 1.4) * 0.2
           + (Math.random() - 0.5) * 0.18;
   }

   const { RR, PR, QRS, QT } = cardiacIntervals(hr);
   const t = phase * RR; // ms from beat onset (P-wave onset ≈ t=0)

   if (isVtach) {
      // Monomorphic VT: wide bizarre QRS, no P, large discordant T. Built
      // from the same gaussian template as a PVC but applied every beat.
      let y = 0;
      y += gaussMs(t, 1.30, PR + 30, 22);    // tall broad R
      y -= gaussMs(t, 0.65, PR + 85, 32);    // deep S
      y += gaussMs(t, -0.45, PR + 280, 75);  // discordant inverted T
      if (noise > 0) y += (Math.random() - 0.5) * noise * 0.05;
      return y;
   }

   // Wave widths (sigma, ms) — absolute, so QRS doesn't smear at high HR
   const wQ = wideQRS ? 2.4 : 1.0;
   const sP = 18;
   const sQ = 8 * wQ;
   const sR = 9 * wQ;
   const sS = 10 * wQ;
   const sT = 55;

   // Wave-peak centers (ms from beat onset). Anchor T so its tail lands
   // exactly at PR+QT — guarantees a clean isoelectric TP segment.
   const cP = Math.max(20, PR - 110);
   const cQ = PR + 10;
   const cR = PR + 30;
   const cS = PR + 60;
   const cT = PR + QT - 2 * sT;

   if (isPVC) {
      // Wide bizarre QRS, no P, opposite-polarity T
      let y = 0;
      y += gaussMs(t, 0.95, PR + 25, 28);
      y -= gaussMs(t, 0.55, PR + 70, 36);
      y += gaussMs(t, -0.35, PR + 260, 75);
      if (noise > 0) y += (Math.random() - 0.5) * noise * 0.05;
      return y;
   }

   let y = 0;

   // P wave (or AFib f-waves in its place). Lead-II amplitude is small —
   // ~1/4 of T — so it doesn't compete with T visually.
   if (!hideP) {
      y += gaussMs(t, 0.10, cP, sP);
   } else if (afibNoise) {
      // ~6–10 Hz fibrillatory waves on the baseline. Pumped up so they're
      // visible against the QRS scale.
      y += Math.sin(t * 0.040) * 0.060
         + Math.sin(t * 0.053) * 0.040
         + (Math.random() - 0.5) * 0.08;
   }

   // QRS
   y += gaussMs(t, -0.12, cQ, sQ);
   y += gaussMs(t,  1.00, cR, sR);
   y += gaussMs(t, -0.25, cS, sS);

   // ST segment offset (1 mm ≈ 0.1 mV). Modeled as a smooth gaussian
   // plateau between QRS-end and T-onset. A step/if-bound here would
   // create a discontinuity at the J-point and a notch on the T upstroke.
   if (Math.abs(stElev) > 0.05) {
      const stStart = PR + QRS;
      const stEnd = cT - sT;
      const stCenter = (stStart + stEnd) / 2;
      const stSigma = Math.max(20, (stEnd - stStart) / 2);
      y += gaussMs(t, stElev * 0.08, stCenter, stSigma);
   }

   // T wave — taller than P so the post-QRS "second hump" people expect
   // is unambiguously the T, not the next beat's P creeping in.
   // Lead-II T:R ratio is typically ~1:3.
   const tAmp = (tInv ? -0.30 : 0.30) + stElev * 0.04;
   y += gaussMs(t, tAmp, cT, sT);

   if (noise > 0) y += (Math.random() - 0.5) * noise * 0.05;

   return y;
};

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
