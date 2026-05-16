// F-018: load server/.env BEFORE any module that reads process.env at
// import time (db.js → ROHY_DB; middleware/auth.js → JWT_SECRET). ESM
// imports evaluate in source order, so making this the first import
// guarantees env is materialized before anything else loads. Without
// this, the working order relies on the accident that routes.js (which
// transitively imports auth.js's dotenv.config) currently appears before
// db.js — reorder these imports and the wrong DB opens.
import './bootstrap-env.js';
import express from 'express';
import cors from 'cors';
import https from 'https';
import apiRoutes from './routes.js';
import path from 'path';
import fs from "fs";
import { fileURLToPath } from 'url';
import db, { dbReady } from './db.js';
import dbAdapter from './dbAdapter.js';
import { runSeeders, needsSeeding } from './seeders/index.js';
import { loadKokoro } from './services/kokoroTts.js';
import { auditPersonaAndCaseVoices } from './healthChecks/voiceCatalogueAudit.js';
import { configureSlowQueryThresholdFromDb, instrumentSqliteDb } from './observability.js';
import requestIdMiddleware from './middleware/requestId.js';
import requestLoggerMiddleware from './middleware/requestLogger.js';
import errorHandler from './middleware/errorHandler.js';
import { logger } from './logger.js';
import { validateEnvOrExit } from './config/validateEnv.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const bootLog = logger('server');
const httpsLog = logger('https');
const migrationLog = logger('migration');
const kokoroLog = logger('kokoro');
const voiceAuditLog = logger('voice-audit');

// Boot-time env validation. Surfaces every configuration problem at once
// rather than letting them dribble out as silent CORS 500s or DB-in-repo
// surprises.
validateEnvOrExit();

const PORT = parseInt(process.env.PORT, 10) || 3000;
// Optional HTTPS listener — needed in any deployment that isn't
// localhost/127.0.0.1, because Chrome blocks getUserMedia and
// SpeechRecognition on insecure origins (private LAN IPs included).
// Set TLS_CERT_PATH + TLS_KEY_PATH to enable; HTTPS_PORT defaults to
// PORT+1000 (so 3000→4000, 4001→5001) to avoid clashing with the HTTP
// listener. The HTTP listener stays up so existing bookmarks keep
// working — but mic-using paths require HTTPS.
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || (PORT + 1000);
const TLS_CERT_PATH = process.env.TLS_CERT_PATH || '';
const TLS_KEY_PATH = process.env.TLS_KEY_PATH || '';

// Trust the loopback proxy (nginx terminates TLS at :4001 → forwards to
// :4000). Without this, Express ignores X-Forwarded-For and every request
// looks like 127.0.0.1 — rate-limiters then collapse all users into one
// bucket. Restricted to loopback so we don't trust spoofed XFFs from the
// public internet. Override via env if the proxy chain ever changes.
app.set('trust proxy', process.env.ROHY_TRUST_PROXY || 'loopback');

instrumentSqliteDb(db);

// CORS Configuration - restrict to allowed origins
import { buildCorsOptions } from './cors-config.js';
import { securityHeaders } from './security-headers.js';

app.use(requestIdMiddleware);
app.use(securityHeaders({ nodeEnv: process.env.NODE_ENV }));
app.use(cors(buildCorsOptions({
    nodeEnv: process.env.NODE_ENV,
    frontendUrl: process.env.FRONTEND_URL,
})));
app.use(requestLoggerMiddleware());
// Body-size limits: most JSON endpoints carry small payloads. The 10mb
// global limit was a DoS surface — request a 10mb JSON body N times in
// parallel and the server is sad. We keep 10mb only for the upload
// routes (mounted after this point under /api) by setting a much smaller
// global limit and overriding per-route where genuinely needed. The
// upload routes use multer (multipart), not express.json, so they are
// unaffected by this cap.
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ limit: '256kb', extended: true }));

// Routes
app.use('/api', apiRoutes);

// Full OyonR app. This intentionally serves the copied Oyon tree as-is so
// Rohy does not recreate Oyon capture, settings, logs, or analytics UI.
const oyonRoot = path.join(__dirname, "..", "OyonR");
if (fs.existsSync(oyonRoot)) {
    const allowOyonFrame = (req, res, next) => {
        res.removeHeader('X-Frame-Options');
        const frameAncestors = process.env.NODE_ENV === 'production'
            ? "'self'"
            : "'self' http://127.0.0.1:5173 http://localhost:5173";
        res.setHeader(
            'Content-Security-Policy',
            [
                "default-src 'self'",
                "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob:",
                "media-src 'self' blob:",
                "font-src 'self' data:",
                "connect-src 'self' blob: data:",
                "worker-src 'self' blob:",
                `frame-ancestors ${frameAncestors}`,
                "form-action 'self'",
                "base-uri 'self'",
                "object-src 'none'",
            ].join('; ')
        );
        next();
    };
    app.use('/oyon', allowOyonFrame);
    app.use('/standalone', allowOyonFrame);
    app.use('/oyon', express.static(oyonRoot));
    // Oyon standalone currently uses absolute /standalone asset URLs.
    app.use('/standalone', express.static(path.join(oyonRoot, 'standalone')));
}

// Health Check
app.get('/', (req, res) => {
    //res.send('Virtual Patient Platform Backend is Running');
    const frontendPath = path.join(__dirname, "..", "frontend");

    if (fs.existsSync(frontendPath)) {
       res.sendFile(path.join(__dirname, "../frontend/index.html"));
    } else {
        req.log?.error('frontend folder missing', { frontend_path: frontendPath });
        res.status(404).json({ error: 'Frontend not found' });
    }
});

app.use('/uploads', express.static(path.join(__dirname, "..", "public","uploads")));

// VitePress documentation site (Stage 4 — Help & Support links here).
// The build emits cleanUrls (trainee/getting-started.html served at
// /trainee/getting-started), so `extensions: ['html']` is required for the
// in-app Help article links to resolve. Mounted at /rohy/docs to match
// DOCS_BASE in src/help/helpContent.js, and BEFORE the SPA static so docs
// URLs don't fall through to the React app's index.html.
const docsDist = path.join(__dirname, "..", "docs", ".vitepress", "dist");
if (fs.existsSync(docsDist)) {
    app.use('/rohy/docs', express.static(docsDist, { extensions: ['html'] }));
} else {
    bootLog.warn('docs site not built — Help article links will 404', { docs_dist: docsDist });
}

app.use('/', express.static(path.join(__dirname, "..", "frontend")));
app.use(errorHandler);

// Start server with port fallback — bind to :: with ipv6Only:false for dual-stack (IPv4 + IPv6)
function startServer(port, maxRetries = 10) {
        const server = app.listen(port, '0.0.0.0', () => {
        bootLog.info('http server listening', { host: '0.0.0.0', port });
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && maxRetries > 0) {
            bootLog.warn('http port in use, retrying', { port, next_port: port + 1 });
            server.close();
            startServer(port + 1, maxRetries - 1);
        } else {
            bootLog.error('http server error', { error: err.message, code: err.code || null });
            process.exit(1);
        }
    });

    return server;
}

// Optional HTTPS listener. Only starts when TLS_CERT_PATH + TLS_KEY_PATH
// point at readable PEM files. Failures here are non-fatal — the HTTP
// listener stays up so the rest of the app remains usable; the warning
// makes it obvious why the mic would still be blocked.
function startHttpsServer(port) {
    if (!TLS_CERT_PATH || !TLS_KEY_PATH) {
        httpsLog.info('https disabled', { reason: 'missing TLS_CERT_PATH or TLS_KEY_PATH' });
        return null;
    }
    let cert, key;
    try {
        cert = fs.readFileSync(TLS_CERT_PATH);
        key = fs.readFileSync(TLS_KEY_PATH);
    } catch (err) {
        httpsLog.warn('tls files unreadable', { error: err.message });
        return null;
    }
    try {
        const server = https.createServer({ cert, key }, app).listen(port, '0.0.0.0', () => {
            httpsLog.info('https server listening', { host: '0.0.0.0', port });
        });
        server.on('error', (err) => {
            httpsLog.warn('https listener error', { error: err.message, code: err.code || null });
        });
        return server;
    } catch (err) {
        httpsLog.warn('https listener start failed', { error: err.message });
        return null;
    }
}

// Fire-and-forget Kokoro warmup. The model is ~330 MB and the first /tts
// call after boot otherwise pays the full load cost (~2 s on M-series CPU,
// longer cold). Triggering loadKokoro() at boot — only when the platform's
// tts_provider is set to 'kokoro' — eliminates that delay for the first
// real request without blocking startup.
function maybeWarmupKokoro() {
    dbAdapter.get(
        "SELECT setting_value FROM platform_settings WHERE setting_key = 'tts_provider'",
        (err, row) => {
            if (err || !row || row.setting_value !== 'kokoro') return;
            loadKokoro().catch((e) => {
                kokoroLog.warn('warmup failed', { error: e?.message || String(e) });
            });
        }
    );
}

// The legacy `piper_voice_*` / `default_voice_*` → `voice_*` boot loop
// used to live here. It was retired alongside the per-provider slot
// fallback (commit `a33779d`); the rows it created are now deleted by
// migration 0022. Nothing reads `voice_<provider>_<gender>` keys
// anymore — voices live on persona + case rows only.

function setSettingIfEmpty(key, value) {
    return new Promise((resolve, reject) => {
        dbAdapter.run(
            `INSERT INTO platform_settings (setting_key, setting_value, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(setting_key) DO NOTHING`,
            [key, value],
            (err) => err ? reject(err) : resolve()
        );
    });
}


// Run seeders if database is empty, then start server
async function initializeAndStart() {
    try {
        await dbReady;
        configureSlowQueryThresholdFromDb(db);
    } catch (err) {
        bootLog.error('database migration failed', { error: err.message });
        process.exit(1);
    }

    try {
        // Check if seeding is needed and run seeders
        const isEmpty = await needsSeeding(db);
        if (isEmpty) {
            await runSeeders(db);
        }
    } catch (err) {
        bootLog.error('seeder failed', { error: err.message, fatal: false });
    }

    // Default platform tts_provider to kokoro on a fresh install — Kokoro
    // is the offline default and the shipped persona case_voice values
    // (am_michael, af_bella, etc. in server/db.js DEFAULT_AGENTS) are
    // Kokoro voice ids. Without this, a fresh boot has no tts_provider
    // set and the runtime refuses to play. setSettingIfEmpty is idempotent
    // and ON CONFLICT DO NOTHING — admins who picked another provider
    // through the UI are not overwritten.
    try {
        await setSettingIfEmpty('tts_provider', 'kokoro');
    } catch (e) {
        migrationLog.warn('default tts_provider seed failed', { error: e.message });
    }

    // Start the server, then trigger TTS warmup async.
    const httpServer = startServer(PORT);
    const httpsServer = startHttpsServer(HTTPS_PORT);
    installGracefulShutdown([httpServer, httpsServer].filter(Boolean));
    maybeWarmupKokoro();

    // Fire-and-forget audit of stored case_voice values vs the active
    // provider's catalogue. Non-fatal; just logs. See
    // server/healthChecks/voiceCatalogueAudit.js for the full rationale.
    // Delay so kokoro's warmup has a chance to populate its catalogue
    // first (Kokoro's voice list loads alongside the model).
    setTimeout(() => {
        auditPersonaAndCaseVoices(dbAdapter, voiceAuditLog)
            .catch((err) => voiceAuditLog.warn('audit failed', { error: err?.message || String(err) }));
    }, 5000);
}

// Graceful shutdown.
// systemd sends SIGTERM on `systemctl restart rohy` (and again on stop).
// Without draining: in-flight requests get TCP RST, in-flight DB writes
// abort, the client sees nginx 502 (the very symptom that started this
// hardening pass). With draining: the listener stops accepting new
// connections, in-flight requests finish, the DB closes cleanly, then
// process.exit. Capped at SHUTDOWN_GRACE_MS so a runaway request can't
// block forever — systemd's TimeoutStopSec defaults to 90s, well above
// our 15s grace window.
const SHUTDOWN_GRACE_MS = parseInt(process.env.ROHY_SHUTDOWN_GRACE_MS, 10) || 15_000;
let shuttingDown = false;
function installGracefulShutdown(servers) {
    const handleSignal = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        bootLog.info('graceful shutdown initiated', { signal, grace_ms: SHUTDOWN_GRACE_MS });

        // Hard deadline — if anything wedges, exit anyway.
        const hardKill = setTimeout(() => {
            bootLog.warn('graceful shutdown timed out, forcing exit', { grace_ms: SHUTDOWN_GRACE_MS });
            process.exit(1);
        }, SHUTDOWN_GRACE_MS).unref();

        // Stop accepting new HTTP/HTTPS connections; in-flight requests
        // continue. server.close fires its callback only after the last
        // active socket finishes.
        Promise.all(servers.map(s => new Promise(resolve => s.close(resolve)))).then(() => {
            bootLog.info('http listeners closed');
            // Now close the database. Any pending callbacks finish first.
            db.close((err) => {
                clearTimeout(hardKill);
                if (err) bootLog.warn('db close error during shutdown', { error: err.message });
                else bootLog.info('database closed cleanly');
                process.exit(0);
            });
        }).catch((err) => {
            bootLog.warn('listener close error', { error: err?.message || String(err) });
        });
    };

    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('SIGINT', () => handleSignal('SIGINT'));
}

initializeAndStart();

// Keep process alive and handle errors
process.on('uncaughtException', (err) => {
    bootLog.error('uncaught exception', { error: err.message, stack: err.stack || null });
});

process.on('unhandledRejection', (reason, promise) => {
    bootLog.error('unhandled rejection', {
        error: reason?.message || String(reason),
        stack: reason?.stack || null,
        promise: String(promise)
    });
});
