# Server TTS And Proxy Services Audit

Files reviewed:
- `server/services/googleTts.js`
- `server/services/kokoroTts.js`
- `server/services/openaiTts.js`
- `server/services/voiceFallbacks.js`
- `server/services/wav.js`
- `server/services/proxyCache.js`
- `server/services/loincProxy.js`
- `server/services/openfdaProxy.js`
- `server/services/rxnormProxy.js`

Enterprise assessment:
- Provider-specific TTS tests exist for Google, Kokoro, OpenAI, parity, pitch independence, and smoke coverage.
- Proxy service tests exist for catalogue proxies.
- Startup includes optional Kokoro warmup based on platform settings.

Findings:
- Medium: provider external calls need stable timeout, retry, and circuit-breaker behavior documented and covered across all providers. This is especially important for clinical simulation where voice failure should degrade predictably.
- Medium: TTS and LLM endpoints are exempt from the general limiter by design, relying on their own accounting. Enterprise deployments should test per-user and platform budget enforcement under concurrency.
- Low: benchmark files exist, but benchmark thresholds are not enforced in CI.

Recommended next tests:
- Add provider timeout tests for all TTS/proxy providers.
- Add concurrency tests for per-user LLM/TTS quota enforcement.
- Add fallback behavior tests where primary TTS provider fails mid-stream.

Status:
- No code change made in this module during this pass.
