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
import { configureSlowQueryThresholdFromDb, instrumentSqliteDb } from './observability.js';
import requestIdMiddleware from './middleware/requestId.js';
import requestLoggerMiddleware from './middleware/requestLogger.js';
import errorHandler from './middleware/errorHandler.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const bootLog = logger('server');
const httpsLog = logger('https');
const migrationLog = logger('migration');
const kokoroLog = logger('kokoro');
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

// One-shot migration: rename legacy voice keys to per-provider shape.
// Before this commit, voices were stored as `piper_voice_<gender>` (despite
// being used for any provider) and `default_voice_<gender>` (provider-flat).
// Both schemes broke on provider switch — voice IDs are provider-specific.
// We now store voices under `voice_<provider>_<gender>` and
// `default_voice_<provider>_<gender>`.
//
// On boot, copy each legacy key into its per-provider equivalent under the
// 'piper' slot (the safest assumption — pre-multi-provider deployments
// were Piper-only). Idempotent: only copies when destination is empty.
const LEGACY_VOICE_MIGRATIONS = [
    ['piper_voice_male',     'voice_piper_male'],
    ['piper_voice_female',   'voice_piper_female'],
    ['piper_voice_child',    'voice_piper_child'],
    ['default_voice_male',   'default_voice_piper_male'],
    ['default_voice_female', 'default_voice_piper_female'],
    ['default_voice_child',  'default_voice_piper_child']
];

function getSetting(key) {
    return new Promise((resolve, reject) => {
        dbAdapter.get(
            'SELECT setting_value FROM platform_settings WHERE setting_key = ?',
            [key],
            (err, row) => err ? reject(err) : resolve(row?.setting_value || null)
        );
    });
}

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

async function runVoiceKeyMigration() {
    let copied = 0;
    for (const [oldKey, newKey] of LEGACY_VOICE_MIGRATIONS) {
        try {
            const [oldVal, newVal] = await Promise.all([getSetting(oldKey), getSetting(newKey)]);
            if (oldVal && !newVal) {
                await setSettingIfEmpty(newKey, oldVal);
                copied++;
            }
        } catch (e) {
            migrationLog.warn('voice key copy failed', { old_key: oldKey, new_key: newKey, error: e.message });
        }
    }
    if (copied > 0) {
        migrationLog.info('legacy voice keys copied', { copied });
    }
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

    // Migrate legacy voice keys before anything reads them. Cheap; logs
    // only when work was actually done.
    try {
        await runVoiceKeyMigration();
    } catch (e) {
        migrationLog.warn('voice key migration failed', { error: e.message });
    }

    // Start the server, then trigger TTS warmup async.
    startServer(PORT);
    startHttpsServer(HTTPS_PORT);
    maybeWarmupKokoro();
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
