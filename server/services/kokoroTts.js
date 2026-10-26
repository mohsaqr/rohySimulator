// Kokoro-82M TTS via kokoro-js. Singleton: the model is ~330 MB on disk
// and ~400 MB resident (Linux, native onnxruntime-node), so we lazy-load it
// on first use and reuse the instance across /api/tts calls.
//
// Residency policy: the model is UNLOADED after ROHY_KOKORO_IDLE_UNLOAD_MIN
// minutes without a synthesis (default 10; 0 = keep resident for the life
// of the process, the pre-2.9.51 behaviour). Measured on the production box
// (3.7 GiB, glibc): dispose() returns ~380 MB of the ~600 MB the loaded
// process holds; the remaining ~200 MB is the ORT runtime + thread pool and
// only goes away with the process. On macOS the allocator keeps the freed
// pages, so RSS does not drop there — judge this on the deploy OS. The
// price of unloading is one warm reload (~1.7 s with a persistent
// TRANSFORMERS_CACHE, ~15 s if the cache lives inside node_modules and a
// deploy wiped it) on the first synthesis after a quiet spell. An in-flight
// synthesis or stream always pins the model; the timer only fires between
// requests.
//
// First call to load() will download model+tokenizer+voicepacks from the
// Hugging Face Hub into the user's transformers.js cache (~330 MB). After
// that, startup is ~2 s and inference is ~0.7× realtime on M-series CPU.
//
// Remote mode (a URL in Settings → Voice, or ROHY_KOKORO_URL in the server env):
// synthesis goes to an OpenAI-compatible
// Kokoro host (`POST <url>/audio/speech`, response_format pcm = int16 LE mono
// 24 kHz, the exact format of a local chunk), one request per sentence. The
// local model is then only a fallback: it is never loaded at boot, and is
// loaded lazily the first time a remote request fails. Measured 2026-10-24
// on the same model: ~0.2 s per sentence remotely vs ~1.3 s on a 4-thread
// CPU, and no reload after an idle unload. A short circuit breaker stops a
// dead remote host from adding a timeout to every reply. Nothing outside
// this module knows which side spoke.

import { Buffer } from 'node:buffer';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env as TRANSFORMERS_ENV } from '@huggingface/transformers';
import { buildWavHeader, float32ToInt16Buffer } from './wav.js';
import { fetchWithTimeout, FetchTimeoutError } from './fetchWithTimeout.js';
import { kokoroCatalogue } from './kokoroVoices.js';
import { logger } from '../logger.js';

const kokoroLog = logger('kokoro');

// onnxruntime-web (which @huggingface/transformers uses on Node) defaults to
// single-threaded WASM. Benchmarked at ~20% faster at 4 threads vs 1; past
// 4 it actually gets slower (thread overhead beats parallelism for an 82M
// model). Must be set before any ORT session is created.
const _wasmThreads = Math.min(4, Math.max(1, os.cpus().length));
try {
    TRANSFORMERS_ENV.backends.onnx.wasm.numThreads = _wasmThreads;
} catch (err) {
    kokoroLog.warn('failed to configure wasm threads', { error: err.message });
}

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// q4 (4-bit quantized) is ~40% faster than q8 with imperceptible quality loss
// for speech. Synthesis runs at ~0.38× realtime on M-series CPU vs q8's 0.66×.
const DTYPE = 'q4';

// Supply-chain pin (security audit 2026-10-26, L6-14). The model is fetched
// from the Hugging Face Hub at its `main` revision and was never checked, so a
// changed or tampered upstream file would be loaded into the native runtime.
//
// - REVISION is recorded, not passed: kokoro-js's KokoroTTS.from_pretrained
//   forwards only { dtype, device, progress_callback } to transformers.js (no
//   `revision` hook), and transformers.js keys its file cache by revision —
//   passing one would re-download the 305 MB model on every existing install.
//   It is the Hub commit `main` pointed at when the hashes below were taken
//   (lastModified 2025-02-08).
// - The SHA-256 of every file the load reads is checked: before loading when
//   the files are already in the cache, after the first download otherwise. A
//   mismatch disables local Kokoro for the process (honest error, as for a
//   corrupt model). model_q4.onnx's hash is the Hub's own LFS oid (verified
//   2026-10-26 against the API, and equal to a local cached copy); the three
//   JSON files are hashed from that same revision's cached copies.
// - ROHY_KOKORO_MODEL_SHA256=<hex> replaces the model hash for an operator who
//   deliberately moves to another build (the JSON hashes then still apply).
export const KOKORO_MODEL_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
export const KOKORO_FILE_SHA256 = Object.freeze({
    'onnx/model_q4.onnx': '04cf570cf9c4153694f76347ed4b9a48c1b59ff1de0999e6605d123966b197c7',
    'config.json': 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
    'tokenizer.json': '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34',
    'tokenizer_config.json': 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20',
});

export class KokoroIntegrityError extends Error {
    constructor(file, expected, actual) {
        super(`Kokoro model file ${file} does not match its pinned SHA-256 (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
        this.name = 'KokoroIntegrityError';
        this.code = 'KOKORO_INTEGRITY';
        this.file = file;
    }
}

function expectedKokoroHashes() {
    const override = (process.env.ROHY_KOKORO_MODEL_SHA256 || '').trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(override)
        ? { ...KOKORO_FILE_SHA256, 'onnx/model_q4.onnx': override }
        : KOKORO_FILE_SHA256;
}

// A verified file is not re-hashed on every reload (an idle unload reloads the
// model): the result is remembered by path, size and mtime.
const _verified = new Map();

function sha256File(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        fs.createReadStream(file).on('error', reject).on('data', (c) => hash.update(c)).on('end', () => resolve(hash.digest('hex')));
    });
}

/**
 * Check the cached Kokoro files against their pinned hashes.
 * Throws KokoroIntegrityError on the first mismatch. Files not present in
 * `cacheDir` are reported in `missing` (not yet downloaded, or served from a
 * local model path) — the caller decides what that means.
 *
 * @param {{ cacheDir?: string, modelId?: string, expected?: Record<string,string> }} [opts]
 * @returns {Promise<{ verified: string[], missing: string[] }>}
 */
export async function verifyKokoroModelFiles({ cacheDir = TRANSFORMERS_ENV.cacheDir, modelId = MODEL_ID, expected = expectedKokoroHashes() } = {}) {
    const verified = [];
    const missing = [];
    for (const [rel, want] of Object.entries(expected)) {
        const file = path.join(String(cacheDir || ''), modelId, rel);
        let stat;
        try { stat = fs.statSync(file); } catch { missing.push(rel); continue; }
        const memoKey = `${file}:${stat.size}:${stat.mtimeMs}:${want}`;
        if (!_verified.has(memoKey)) {
            const got = await sha256File(file);
            if (got !== want) throw new KokoroIntegrityError(rel, want, got);
            _verified.set(memoKey, true);
        }
        verified.push(rel);
    }
    return { verified, missing };
}

let _instance = null;
let _loading = null;
// "Permanently disabled until restart" flag. Set when load fails AND the
// failure is the unrecoverable kind (truncated/corrupt ONNX, missing
// model files). Once set, every subsequent loadKokoro() call rejects
// fast — the route layer can then catch and switch to Piper instead of
// each request triggering another 80MB re-download attempt.
//
// Per AGENT-NOTE-DEPLOY-2026-05-07.md §4: an ORT-WASM crash on a
// truncated .onnx file used to take the entire Node process with it.
// Now we contain the failure inside this module, log loudly, and let
// callers recover. The deploy-side fix (TRANSFORMERS_CACHE outside
// node_modules) is still recommended to prevent the bad-cache state
// in the first place — this guard is defense-in-depth.
let _disabled = null;

// Idle-unload configuration. Read once at import; minutes, non-negative
// integer-ish. Anything unparsable falls back to the default so a typo in
// the env file degrades to "unload after 10 min", never to "never unload".
const DEFAULT_IDLE_UNLOAD_MIN = 10;
function parseIdleUnloadMinutes(raw) {
    if (raw === undefined || raw === null || raw === '') return DEFAULT_IDLE_UNLOAD_MIN;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_IDLE_UNLOAD_MIN;
}
const IDLE_UNLOAD_MS = parseIdleUnloadMinutes(process.env.ROHY_KOKORO_IDLE_UNLOAD_MIN ?? 10) * 60_000;

let _lastUsedAt = 0;   // ms epoch of the last synthesis start (or load)
let _inFlight = 0;     // synthesis calls / open streams currently using _instance
let _idleTimer = null;
let _unloading = null; // in-progress unload promise, so loadKokoro() can wait for it
let _loadedAt = 0;

/** Milliseconds of inactivity after which the model is unloaded; 0 = never. */
export function kokoroIdleUnloadMs() {
    return IDLE_UNLOAD_MS;
}

function touchKokoro() {
    _lastUsedAt = Date.now();
    armIdleTimer();
}

// (Re)arm the single idle timer. unref() so a resident model never keeps
// the process alive on its own (tests, CLI tools that import this module).
function armIdleTimer() {
    if (IDLE_UNLOAD_MS <= 0 || !_instance) return;
    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(onIdleTimer, IDLE_UNLOAD_MS);
    if (typeof _idleTimer.unref === 'function') _idleTimer.unref();
}

function onIdleTimer() {
    _idleTimer = null;
    if (!_instance) return;
    const idleFor = Date.now() - _lastUsedAt;
    // A request slipped in, or a stream is still open: try again later.
    if (_inFlight > 0 || idleFor < IDLE_UNLOAD_MS) {
        armIdleTimer();
        return;
    }
    unloadKokoro('idle').catch((e) => {
        kokoroLog.warn('idle unload failed', { error: e?.message || String(e) });
    });
}

/**
 * Release the resident model (ONNX sessions + tokenizer) so its native
 * memory returns to the OS. Safe to call when nothing is loaded. Never
 * unloads while a synthesis is in flight — returns false in that case.
 * The next loadKokoro() reloads from the transformers cache.
 */
export async function unloadKokoro(reason = 'manual') {
    if (_unloading) return _unloading;
    if (!_instance) return false;
    if (_inFlight > 0) return false;
    const inst = _instance;
    _instance = null;
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    _unloading = (async () => {
        const t0 = Date.now();
        try {
            // KokoroTTS holds { model: PreTrainedModel, tokenizer }; the
            // model owns the ORT sessions and exposes dispose() → release().
            if (inst?.model && typeof inst.model.dispose === 'function') {
                await inst.model.dispose();
            }
            kokoroLog.info('model unloaded', {
                reason,
                resident_ms: _loadedAt ? t0 - _loadedAt : null,
                idle_ms: _lastUsedAt ? t0 - _lastUsedAt : null,
                dispose_ms: Date.now() - t0,
            });
            return true;
        } finally {
            _unloading = null;
        }
    })();
    return _unloading;
}

const KOKORO_FATAL_PATTERNS = [
    /protobuf parsing/i,         // truncated .onnx file — most common
    /failed to allocate/i,       // OOM / WASM heap exhaustion
    /onnxruntime/i,              // ORT-internal failures
    /onnx model/i,               // generic ORT model errors
    /no such file/i,             // missing model files post-cache-wipe
    /cannot find module/i,
];

function classifyLoadError(err) {
    if (err instanceof KokoroIntegrityError) return 'fatal';
    const msg = (err?.message || String(err)).slice(0, 500);
    return KOKORO_FATAL_PATTERNS.some(rx => rx.test(msg)) ? 'fatal' : 'transient';
}

// kokoro-js, loaded on first use rather than at boot.
//
// Its dependency phonemizer is Emscripten output that, AS IT IS IMPORTED,
// registers process-wide handlers that rethrow every uncaught exception and
// unhandled rejection. With them installed, any stray rejection anywhere in
// the server (a fire-and-forget write that hit SQLITE_BUSY) killed the
// process, whatever server.js's own log-and-continue handlers said — under
// load the server crashed within seconds (stability run, rc.47). Loading the
// library lazily keeps a server that never speaks free of them, and the two
// handlers the import adds are removed straight after it, so a server that
// does speak keeps its own error handling too. Measured: the import adds
// exactly one of each, and a later phonemize() adds none.
const PROCESS_EVENTS = ['uncaughtException', 'unhandledRejection'];
let _kokoroLib = null;
function kokoroLib() {
    if (!_kokoroLib) {
        _kokoroLib = (async () => {
            const before = new Map(PROCESS_EVENTS.map((e) => [e, new Set(process.listeners(e))]));
            const lib = await import('kokoro-js');
            for (const event of PROCESS_EVENTS) {
                for (const listener of process.listeners(event)) {
                    if (!before.get(event).has(listener)) process.removeListener(event, listener);
                }
            }
            return lib;
        })().catch((err) => { _kokoroLib = null; throw err; });
    }
    return _kokoroLib;
}

/** Test seam: load the library without loading the model. */
export const _kokoroLibForTest = () => kokoroLib();

export async function loadKokoro() {
    if (_disabled) {
        const err = new Error(`Kokoro disabled until restart: ${_disabled}`);
        err.code = 'KOKORO_DISABLED';
        throw err;
    }
    if (_instance) return _instance;
    if (_loading) return _loading;

    _loading = (async () => {
        // A request arriving mid-dispose must not race the session teardown.
        if (_unloading) await _unloading.catch(() => {});
        const t0 = Date.now();
        try {
            // Cached files are checked BEFORE the native runtime parses them;
            // a first download is checked straight after (L6-14).
            const before = await verifyKokoroModelFiles();
            const { KokoroTTS } = await kokoroLib();
            const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE });
            if (before.missing.length > 0) {
                let after;
                try {
                    after = await verifyKokoroModelFiles();
                } catch (integrityErr) {
                    try { await tts?.model?.dispose?.(); } catch { /* the failure below is what matters */ }
                    throw integrityErr;
                }
                if (after.missing.length > 0) {
                    kokoroLog.warn('kokoro model files not verified: not in the cache directory', {
                        missing: after.missing, cache_dir: TRANSFORMERS_ENV.cacheDir, revision: KOKORO_MODEL_REVISION,
                    });
                }
            }
            kokoroLog.info('model loaded', {
                duration_ms: Date.now() - t0,
                wasm_threads: _wasmThreads,
                voice_count: Object.keys(tts.voices).length,
                idle_unload_min: IDLE_UNLOAD_MS / 60_000
            });
            _instance = tts;
            _loadedAt = Date.now();
            _loading = null;
            touchKokoro();
            return tts;
        } catch (err) {
            _loading = null;
            const kind = classifyLoadError(err);
            kokoroLog.error('model load failed', {
                duration_ms: Date.now() - t0,
                kind,
                error: err.message,
                stack: err.stack || null,
            });
            if (kind === 'fatal') {
                // Don't re-attempt on every request — that just re-runs the
                // 80MB download/load that already failed. Mark disabled
                // until process restart so the route layer can fall back
                // cleanly. systemd-restart-on-deploy will clear it.
                _disabled = err.message;
                const fatal = new Error(`Kokoro permanently failed this process: ${err.message}`);
                fatal.code = 'KOKORO_DISABLED';
                throw fatal;
            }
            // Transient — re-throw so the caller sees the original error.
            // Subsequent calls will retry (no _disabled set).
            throw err;
        }
    })();

    return _loading;
}

// Test/diagnostic hook: lets a route or healthcheck see whether Kokoro
// has been permanently disabled this process and surface that to admins.
export function kokoroDisabledReason() {
    return _disabled;
}

// Test-only — clears the disabled flag and instance so each test can
// exercise its own load scenario. Not exported from the package barrel.
export function _resetForTest() {
    _instance = null;
    _loading = null;
    _disabled = null;
    _unloading = null;
    _inFlight = 0;
    _lastUsedAt = 0;
    _loadedAt = 0;
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
}

export function isKokoroLoaded() {
    return !!_instance;
}

// Test-only fake (mirrors ROHY_TEST_FAKE_GOOGLE_TTS): synthesize without
// the ~330 MB model so route tests can exercise kokoro-played fallbacks in
// CI. Voice validity is still enforced upstream by the derivation layer's
// static package catalogue.
function fakeKokoroActive() {
    return process.env.NODE_ENV === 'test' && process.env.ROHY_TEST_FAKE_KOKORO_TTS === '1';
}

export async function synthesizeKokoro({ text, voice, speed }) {
    if (fakeKokoroActive()) {
        const pcm = Buffer.alloc(2400 * 2); // 0.1s of silence @24kHz int16
        return Buffer.concat([buildWavHeader(pcm.length, 24000), pcm]);
    }
    const remote = remoteConfig();
    if (!remote) return localSynthesize({ text, voice, speed });
    await assertKnownVoice(voice);
    if (remoteAvailable(remote)) {
        try {
            const pcm = await remoteSpeech(remote, { text, voice, speed });
            remoteSucceeded();
            return Buffer.concat([buildWavHeader(pcm.length, REMOTE_SAMPLE_RATE), pcm]);
        } catch (err) {
            if (!isRemoteFailure(err)) throw err;
            remoteFailed(err);
        }
    }
    return localSynthesize({ text, voice, speed });
}

async function localSynthesize({ text, voice, speed }) {
    const tts = await loadKokoro();
    if (!tts.voices[voice]) {
        const err = new Error(`unknown Kokoro voice "${voice}"`);
        err.code = 'UNKNOWN_VOICE';
        throw err;
    }
    _inFlight += 1;
    touchKokoro();
    try {
        const out = await tts.generate(text, {
            voice,
            speed: typeof speed === 'number' ? speed : 1
        });
        const pcm = float32ToInt16Buffer(out.audio);
        return Buffer.concat([buildWavHeader(pcm.length, out.sampling_rate), pcm]);
    } finally {
        _inFlight -= 1;
        touchKokoro();
    }
}

// Streaming synthesis: yields per-sentence chunks so the client can start
// playing the first sentence while the rest are still being synthesized.
// Format per chunk handed to the caller:
//   { sampleRate: number, pcm: Buffer (int16 LE) }
//
// We build the TextSplitterStream ourselves and explicitly close() it.
// kokoro-js's overload that accepts a plain string never closes its internal
// splitter, so the last sentence stays buffered and the async iterator
// awaits forever. Using the splitter directly fixes both the dropped
// last sentence and the hung "fails to end" symptoms.
export async function* synthesizeKokoroStream({ text, voice, speed }) {
    if (fakeKokoroActive()) {
        yield { sampleRate: 24000, pcm: Buffer.alloc(2400 * 2) };
        return;
    }
    const remote = remoteConfig();
    if (!remote) {
        yield* localStream({ text, voice, speed });
        return;
    }
    // Validated before any request, so an unknown voice is the same honest
    // UNKNOWN_VOICE in both modes and never a remote 400 or a fallback.
    await assertKnownVoice(voice);
    if (!remoteAvailable(remote)) {
        yield* localStream({ text, voice, speed });
        return;
    }
    yield* remoteStream(remote, { text, voice, speed });
}

async function* localStream({ text, voice, speed }) {
    const tts = await loadKokoro();
    if (!tts.voices[voice]) {
        const err = new Error(`unknown Kokoro voice "${voice}"`);
        err.code = 'UNKNOWN_VOICE';
        throw err;
    }
    const { TextSplitterStream } = await kokoroLib();
    const splitter = new TextSplitterStream();
    splitter.push(text);
    splitter.close();

    // Pinned until the consumer finishes (or abandons) the generator — the
    // finally runs on return/throw/break alike, so an early-closed HTTP
    // response cannot leave the model pinned forever.
    _inFlight += 1;
    touchKokoro();
    try {
        const stream = tts.stream(splitter, {
            voice,
            speed: typeof speed === 'number' ? speed : 1
        });
        for await (const out of stream) {
            yield {
                sampleRate: out.audio.sampling_rate,
                pcm: float32ToInt16Buffer(out.audio.audio)
            };
        }
    } finally {
        _inFlight -= 1;
        touchKokoro();
    }
}

export function listKokoroVoices() {
    if (!_instance) return remoteConfig() ? catalogueVoices() : [];
    // kokoro-js ships its frozen voice map with Title-Case genders ("Female",
    // "Male"). Every other provider in this codebase emits lowercase, and
    // server/routes/proxy-routes.js#voiceGenderMatchesSlot compares against
    // lowercase slot names. Normalise here so kokoro doesn't silently fall
    // through the gender check and re-route every voice to the hardcoded
    // af_bella / am_michael pair.
    return Object.entries(_instance.voices).map(([id, meta]) => ({
        filename: id,
        displayName: meta.name || id,
        language: meta.language || 'en',
        gender: (meta.gender || '').toLowerCase(),
        traits: meta.traits || '',
        sampleRate: 24000
    }));
}

// Async because the model has to be loaded before we know the voice list.
// First call may take ~3s (download + load); subsequent calls are O(1).
export async function isKokoroVoice(name) {
    if (typeof name !== 'string' || !name) return false;
    // Remote mode answers from the bundled catalogue, so asking about a
    // voice never loads the model the remote host is there to replace.
    const catalogue = remoteConfig() && !_instance ? kokoroCatalogue() : null;
    if (catalogue) return catalogue.has(name);
    const tts = await loadKokoro();
    return !!tts.voices[name];
}

// The listing shape of listKokoroVoices(), built from the bundled catalogue
// (the same 28 voices the loaded model exposes, with the same metadata).
function catalogueVoices() {
    const catalogue = kokoroCatalogue();
    if (!catalogue) return [];
    return [...catalogue].map(([id, meta]) => ({
        filename: id,
        displayName: meta.name || id,
        language: meta.language || 'en',
        gender: (meta.gender || '').toLowerCase(),
        traits: meta.traits || '',
        sampleRate: 24000
    }));
}

async function assertKnownVoice(voice) {
    if (await isKokoroVoice(voice)) return;
    const err = new Error(`unknown Kokoro voice "${voice}"`);
    err.code = 'UNKNOWN_VOICE';
    throw err;
}

// ─── Remote synthesis ────────────────────────────────────────────────────

const REMOTE_SAMPLE_RATE = 24000;
const DEFAULT_REMOTE_TIMEOUT_MS = 8000;
// Breaker: after this many consecutive remote failures, skip the remote host
// for BREAKER_OPEN_MS and speak locally straight away. When the window ends,
// ONE request is let through as a trial while everyone else keeps speaking
// locally — a classroom arriving together must not all wait out a timeout
// against a host that is still down. Success closes the breaker; failure
// reopens it. A trial always settles within one timeout; its claim lapses
// then anyway, as a backstop, so no path can keep the remote host shut.
const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_OPEN_MS = 60_000;

/** Parse ROHY_KOKORO_TIMEOUT_MS; anything but a positive integer → default. */
export function parseRemoteTimeoutMs(raw) {
    if (raw === undefined || raw === null || raw === '') return DEFAULT_REMOTE_TIMEOUT_MS;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_REMOTE_TIMEOUT_MS;
}

const REMOTE_URL_MAX_LENGTH = 512;

/**
 * The one validator for a remote Kokoro base URL (the settings route uses it
 * too, so what can be saved and what is used cannot disagree). Accepts an
 * http(s) URL with no credentials, query or fragment, at most 512 chars;
 * returns it without trailing slashes, or null when it is not acceptable.
 */
export function normalizeRemoteUrl(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim().replace(/\/+$/, '');
    if (!trimmed || trimmed.length > REMOTE_URL_MAX_LENGTH) return null;
    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return trimmed;
}

// What an admin saved in Settings → Voice (platform settings
// kokoro_remote_url / kokoro_remote_api_key). Held here so the hot path and
// the synchronous status readers never touch the database; reloaded at boot
// and after every save by refreshKokoroRemoteSettings().
let _settings = { url: '', apiKey: '' };

/**
 * Reload the admin-set remote values through `getSetting(key)`. A stored URL
 * that fails normalizeRemoteUrl (only possible by editing the database
 * directly) is ignored with a warning. Any change resets the breaker, so a
 * corrected key or host is tried on the very next reply instead of after
 * the pause the old one earned.
 */
export async function refreshKokoroRemoteSettings(getSetting) {
    const [rawUrl, rawKey] = await Promise.all([
        getSetting('kokoro_remote_url'),
        getSetting('kokoro_remote_api_key'),
    ]);
    const url = rawUrl ? normalizeRemoteUrl(rawUrl) : '';
    if (url === null) {
        kokoroLog.warn('stored kokoro_remote_url is not an acceptable http(s) URL; ignored');
    }
    const next = { url: url || '', apiKey: typeof rawKey === 'string' ? rawKey.trim() : '' };
    const changed = next.url !== _settings.url || next.apiKey !== _settings.apiKey;
    _settings = next;
    if (changed) resetBreaker();
    return kokoroRemoteState();
}

// Which URL and key a remote request uses. Read per call (never cached at
// import), so a save or a test's env change applies at once.
//
// Settings override the env file, as for every other TTS key on the Voice
// tab. One rule on top: the env file's key travels ONLY with the env file's
// URL. An admin who saves a URL of their own gets no env key with it —
// otherwise pointing the URL at a host they control would hand them the
// operator's secret. A key saved in Settings is sent to whichever URL is in
// use; the admin sees that host on the same card.
function remoteConfig() {
    const envUrl = (process.env.ROHY_KOKORO_URL || '').trim().replace(/\/+$/, '');
    const envKey = (process.env.ROHY_KOKORO_API_KEY || '').trim();
    const timeoutMs = parseRemoteTimeoutMs(process.env.ROHY_KOKORO_TIMEOUT_MS);
    if (_settings.url) {
        return { url: _settings.url, apiKey: _settings.apiKey, source: 'settings', keySource: _settings.apiKey ? 'settings' : null, timeoutMs };
    }
    if (envUrl) {
        const apiKey = _settings.apiKey || envKey;
        return { url: envUrl, apiKey, source: 'env', keySource: _settings.apiKey ? 'settings' : (envKey ? 'env' : null), timeoutMs };
    }
    return null;
}

/** True when a remote host is configured, i.e. the local model is only a fallback. */
export function kokoroRemoteEnabled() {
    return remoteConfig() !== null;
}

const _breaker = { failures: 0, openUntil: 0, trialUntil: 0, lastError: null, lastOkAt: null };

function resetBreaker() {
    _breaker.failures = 0;
    _breaker.openUntil = 0;
    _breaker.trialUntil = 0;
    _breaker.lastError = null;
    _breaker.lastOkAt = null;
}

function remoteAvailable(cfg) {
    const now = Date.now();
    if (now < _breaker.openUntil) return false;
    if (_breaker.failures < BREAKER_FAILURE_THRESHOLD) return true;
    // Half-open: the first caller claims the trial, the rest stay local.
    if (now < _breaker.trialUntil) return false;
    _breaker.trialUntil = now + cfg.timeoutMs;
    return true;
}

function remoteSucceeded() {
    _breaker.failures = 0;
    _breaker.openUntil = 0;
    _breaker.trialUntil = 0;
    // A success clears the remembered failure, so the card says "last request
    // OK" again instead of showing a stale refusal next to a working host.
    _breaker.lastError = null;
    _breaker.lastOkAt = new Date().toISOString();
}

function remoteFailed(err) {
    _breaker.failures += 1;
    const opens = _breaker.failures >= BREAKER_FAILURE_THRESHOLD;
    if (opens) {
        _breaker.openUntil = Date.now() + BREAKER_OPEN_MS;
        _breaker.trialUntil = 0;
    }
    _breaker.lastError = { kind: err.kind, status: err.status ?? null, at: new Date().toISOString() };
    // One line per failed request; the key never appears (only the
    // failure kind, the HTTP status and the host's own short message).
    kokoroLog.warn('remote synthesis failed; speaking locally', {
        kind: err.kind,
        status: err.status ?? null,
        error: err.message,
        consecutive_failures: _breaker.failures,
        remote_paused_ms: opens ? BREAKER_OPEN_MS : 0,
    });
}

function hostOf(url) {
    if (!url) return null;
    try { return new URL(String(url).trim()).host || null; } catch { return null; }
}

/**
 * Where remote synthesis stands, for the admin's Voice card and for tests.
 * Never carries the key — only whether one is set and where it came from.
 * `url`/`host` name an operator's host, so callers show this to admins only.
 */
export function kokoroRemoteState() {
    const now = Date.now();
    const cfg = remoteConfig();
    return {
        enabled: cfg !== null,
        source: cfg?.source ?? null,
        url: cfg?.url ?? null,
        host: hostOf(cfg?.url),
        // The env file's host even while a saved URL overrides it, so the
        // card can say what clearing the URL would fall back to.
        envHost: hostOf(process.env.ROHY_KOKORO_URL),
        keySet: !!cfg?.apiKey,
        keySource: cfg?.keySource ?? null,
        failures: _breaker.failures,
        open: now < _breaker.openUntil,
        msUntilRetry: Math.max(0, _breaker.openUntil - now),
        lastError: _breaker.lastError,
        lastOkAt: _breaker.lastOkAt,
    };
}

/**
 * One synthesis against the configured remote host, with NO local fallback:
 * the admin's "Test" button must hear about a refused key, not a local voice
 * covering for it. Success closes the breaker (the host is proven back);
 * failure leaves the breaker alone. Returns
 * { ok: true, latencyMs, audioSeconds, host } or
 * { ok: false, kind, status, latencyMs, host } — never the host's response
 * body, so the test cannot be used to read pages from inside the network.
 */
export async function testKokoroRemote() {
    const cfg = remoteConfig();
    if (!cfg) return { ok: false, kind: 'not_configured', status: null, latencyMs: 0, host: null };
    const host = kokoroRemoteState().host;
    const voice = kokoroCatalogue()?.keys().next().value || 'af_heart';
    const t0 = Date.now();
    try {
        const pcm = await remoteSpeech(cfg, { text: 'This is the remote Kokoro voice.', voice, speed: 1 });
        remoteSucceeded();
        const result = { ok: true, latencyMs: Date.now() - t0, audioSeconds: Number((pcm.length / (REMOTE_SAMPLE_RATE * 2)).toFixed(2)), host };
        kokoroLog.info('remote test passed', { host, latency_ms: result.latencyMs, audio_seconds: result.audioSeconds });
        return result;
    } catch (err) {
        if (!isRemoteFailure(err)) throw err;
        // The failure is remembered on the card (last_error) but NOT counted
        // toward the breaker: a test must never pause production synthesis.
        // Logged too — a probe that leaves no trace cannot be reasoned about
        // afterwards (2026-10-25: "the test passed" could not be checked).
        _breaker.lastError = { kind: err.kind, status: err.status ?? null, at: new Date().toISOString() };
        kokoroLog.warn('remote test failed', { host, kind: err.kind, status: err.status ?? null, error: err.message, latency_ms: Date.now() - t0 });
        return { ok: false, kind: err.kind, status: err.status ?? null, latencyMs: Date.now() - t0, host };
    }
}

class KokoroRemoteError extends Error {
    constructor(kind, message, status = null) {
        super(message);
        this.name = 'KokoroRemoteError';
        this.code = 'KOKORO_REMOTE_FAILED';
        this.kind = kind;
        this.status = status;
    }
}

function isRemoteFailure(err) {
    return err instanceof KokoroRemoteError;
}

// One sentence → its PCM. Every way the remote host can fail (network,
// timeout, any non-2xx, a malformed body) becomes a KokoroRemoteError, which
// the callers answer by speaking locally. Any HTTP error counts, not only
// 5xx: a revoked key (401) or a renamed model (404) would otherwise silence
// every reply until an operator noticed, while the local model can still
// speak. A caller's own abort is rethrown untouched: it is not a failure.
async function remoteSpeech(cfg, { text, voice, speed }, signal) {
    // The deadline covers the whole exchange, body included: fetchWithTimeout
    // only times the wait for headers, and the host sends the clip in one go.
    const deadline = AbortSignal.timeout(cfg.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
        const res = await fetchWithTimeout(`${cfg.url}/audio/speech`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify({
                model: 'kokoro',
                voice,
                input: text,
                response_format: 'pcm',
                speed: typeof speed === 'number' ? speed : 1,
            }),
            signal: combined,
        }, { timeoutMs: cfg.timeoutMs });
        if (!res.ok) {
            const detail = (await res.text()).slice(0, 200);
            throw new KokoroRemoteError('http', `remote Kokoro HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
        }
        const pcm = Buffer.from(await res.arrayBuffer());
        if (pcm.length === 0 || pcm.length % 2 !== 0) {
            throw new KokoroRemoteError('bad_audio', `remote Kokoro returned ${pcm.length} bytes, not int16 PCM`);
        }
        return pcm;
    } catch (err) {
        if (err instanceof KokoroRemoteError) throw err;
        if (signal?.aborted) throw err;
        const timedOut = deadline.aborted || err instanceof FetchTimeoutError;
        throw new KokoroRemoteError(timedOut ? 'timeout' : 'network', err?.message || String(err));
    }
}

// One request per sentence (the host returns whole clips, never a stream), so
// first audio waits for one sentence, not the reply. The next sentence is
// requested while the current one is handed on, so a multi-sentence text has
// no synthesis gap between sentences. If a sentence fails, it and everything
// after it are spoken locally; sentences already yielded stay as they are.
async function* remoteStream(cfg, { text, voice, speed }) {
    const sentences = splitSentences(text);
    const controller = new AbortController();
    const request = (sentence) => {
        const pending = remoteSpeech(cfg, { text: sentence, voice, speed }, controller.signal);
        // A prefetch can settle before anyone awaits it (or never be awaited,
        // when the consumer stops early). Mark it handled so it can never
        // surface as an unhandled rejection; the await below still sees it.
        pending.catch(() => {});
        return pending;
    };
    try {
        let next = sentences.length > 0 ? request(sentences[0]) : null;
        for (let i = 0; i < sentences.length; i++) {
            const current = next;
            next = i + 1 < sentences.length ? request(sentences[i + 1]) : null;
            let pcm;
            try {
                pcm = await current;
                remoteSucceeded();
            } catch (err) {
                if (!isRemoteFailure(err)) throw err;
                remoteFailed(err);
                controller.abort();
                yield* localStream({ text: sentences.slice(i).join(' '), voice, speed });
                return;
            }
            yield { sampleRate: REMOTE_SAMPLE_RATE, pcm };
        }
    } finally {
        controller.abort();
    }
}

// Sentence split for remote requests: after . ! ? (or …), optionally closed
// by a quote or bracket, followed by whitespace. A piece ending in a common
// title or single initial ("Dr.", "F.") is joined to the next, so a name is
// never cut. Deliberately simple: the client already sends one sentence per
// request in a streamed reply, so this mostly sees one sentence.
const SENTENCE_END_RX = /(?<=[.!?…]["'”’)\]]?)\s+/;
const NO_BREAK_AFTER_RX = /(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|no)|\b[a-z]|\be\.g|\bi\.e)\.$/i;

export function splitSentences(text) {
    const pieces = String(text ?? '').trim().split(SENTENCE_END_RX).filter(Boolean);
    return pieces.reduce((out, piece) => {
        const last = out.length - 1;
        if (last >= 0 && NO_BREAK_AFTER_RX.test(out[last])) out[last] = `${out[last]} ${piece}`;
        else out.push(piece);
        return out;
    }, []);
}

/** Test-only: forget breaker state between tests. */
export function _resetRemoteForTest() {
    resetBreaker();
    _settings = { url: '', apiKey: '' };
}
