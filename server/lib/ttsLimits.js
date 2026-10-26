// Bounds on speech synthesis (POST /api/tts, /api/tts/preview).
//
// Security audit 2026-10-26 (F-07 / L8-03 / L6-09): /tts had no rate limit, no
// concurrency bound and no overall timeout, and Kokoro and Piper synthesise
// on this server's CPU — up to 2000 characters per request. One account could
// queue enough work to stall voice for everyone. Now:
//   - a per-user request rate (ROHY_TTS_RATE_PER_MIN, default 120/min — voice
//     mode posts one request per sentence);
//   - a synthesis queue: ROHY_TTS_MAX_ACTIVE (default 4) running at once in
//     all, ROHY_TTS_PER_USER_ACTIVE (default 2) per user, and a bounded wait
//     line (ROHY_TTS_MAX_QUEUED default 32 in all, ROHY_TTS_PER_USER_QUEUED
//     default 6 per user). The browser keeps at most three sentence fetches
//     open per session (src/services/voiceService.js), so the per-user line
//     holds two tabs' worth; anything beyond is answered 429 at once;
//   - an overall deadline per request (ROHY_TTS_TIMEOUT_MS, default 120 s),
//     applied in proxy-routes.js.

import { createGate, envInt } from './concurrencyGate.js';
import { perUserRateLimit } from '../middleware/perUserRateLimit.js';

export const TTS_TIMEOUT_MS = envInt('ROHY_TTS_TIMEOUT_MS', 120_000);

export const ttsRateLimiter = perUserRateLimit({
    max: envInt('ROHY_TTS_RATE_PER_MIN', 120),
    windowMs: 60 * 1000,
    message: 'Too many speech requests in a short time. Please wait a moment.',
    skip: () => process.env.ROHY_DISABLE_GENERAL_RATE_LIMIT === '1',
});

export const ttsGate = createGate({
    name: 'tts',
    maxActive: envInt('ROHY_TTS_MAX_ACTIVE', 4),
    maxQueued: envInt('ROHY_TTS_MAX_QUEUED', 32),
    perKeyActive: envInt('ROHY_TTS_PER_USER_ACTIVE', 2),
    perKeyQueued: envInt('ROHY_TTS_PER_USER_QUEUED', 6),
});
