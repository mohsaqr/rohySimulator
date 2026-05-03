import express from 'express';
import cors from 'cors';
import apiRoutes from './routes.js';
import path from 'path';
import fs from "fs";
import { fileURLToPath } from 'url';
import db from './db.js';
import { runSeeders, needsSeeding } from './seeders/index.js';
import { loadKokoro } from './services/kokoroTts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// CORS Configuration - restrict to allowed origins
const allowedOrigins = [
    'http://localhost:5173',      // Vite dev server
    'http://localhost:3000',      // Local production
    'http://localhost:4000',      // Alternative port
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
    'http://[::1]:5173',          // IPv6 loopback - Vite dev server
    'http://[::1]:3000',          // IPv6 loopback - local production
    process.env.FRONTEND_URL      // Production URL from env
].filter(Boolean);

const isDev = process.env.NODE_ENV !== 'production';

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (isDev) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Blocked request from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Routes
app.use('/api', apiRoutes);

// Health Check
app.get('/', (req, res) => {
    //res.send('Virtual Patient Platform Backend is Running');
    const frontendPath = path.join(__dirname, "..", "frontend");

    if (fs.existsSync(frontendPath)) {
       res.sendFile(path.join(__dirname, "../frontend/index.html"));
    } else {
    console.error("Frontend folder does NOT exist but server is running", frontendPath);
    }
});

app.use('/uploads', express.static(path.join(__dirname, "..", "public","uploads")));
app.use('/', express.static(path.join(__dirname, "..", "frontend")));

// Start server with port fallback — bind to :: with ipv6Only:false for dual-stack (IPv4 + IPv6)
function startServer(port, maxRetries = 10) {
        const server = app.listen(port, '0.0.0.0', () => {
        console.log(`Server is running on http://0.0.0.0:${port}`);
        console.log(`Access from local network using your IP address`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && maxRetries > 0) {
            console.log(`Port ${port} is in use, trying ${port + 1}...`);
            server.close();
            startServer(port + 1, maxRetries - 1);
        } else {
            console.error('Server error:', err);
            process.exit(1);
        }
    });

    return server;
}

// Fire-and-forget Kokoro warmup. The model is ~330 MB and the first /tts
// call after boot otherwise pays the full load cost (~2 s on M-series CPU,
// longer cold). Triggering loadKokoro() at boot — only when the platform's
// tts_provider is set to 'kokoro' — eliminates that delay for the first
// real request without blocking startup.
function maybeWarmupKokoro() {
    db.get(
        "SELECT setting_value FROM platform_settings WHERE setting_key = 'tts_provider'",
        (err, row) => {
            if (err || !row || row.setting_value !== 'kokoro') return;
            loadKokoro().catch((e) => {
                console.warn('[kokoro] warmup failed:', e?.message || e);
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
        db.get(
            'SELECT setting_value FROM platform_settings WHERE setting_key = ?',
            [key],
            (err, row) => err ? reject(err) : resolve(row?.setting_value || null)
        );
    });
}

function setSettingIfEmpty(key, value) {
    return new Promise((resolve, reject) => {
        db.run(
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
            console.warn(`[migration] failed copying ${oldKey} → ${newKey}:`, e.message);
        }
    }
    if (copied > 0) {
        console.log(`[migration] copied ${copied} legacy voice key${copied === 1 ? '' : 's'} to per-provider keys`);
    }
}

// Run seeders if database is empty, then start server
async function initializeAndStart() {
    try {
        // Wait a moment for database to initialize
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check if seeding is needed and run seeders
        const isEmpty = await needsSeeding(db);
        if (isEmpty) {
            await runSeeders(db);
        }
    } catch (err) {
        console.error('[Startup] Seeder error (non-fatal):', err.message);
    }

    // Migrate legacy voice keys before anything reads them. Cheap; logs
    // only when work was actually done.
    try {
        await runVoiceKeyMigration();
    } catch (e) {
        console.warn('[migration] voice key migration failed:', e.message);
    }

    // Start the server, then trigger TTS warmup async.
    startServer(PORT);
    maybeWarmupKokoro();
}

initializeAndStart();

// Keep process alive and handle errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
