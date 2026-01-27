import express from 'express';
import cors from 'cors';
import apiRoutes from './routes.js';
import path from 'path';
import fs from "fs";
import { fileURLToPath } from 'url';
import db from './db.js';
import { runSeeders, needsSeeding } from './seeders/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = parseInt(process.env.PORT, 10) || 4000;

// CORS Configuration - restrict to allowed origins
const allowedOrigins = [
    'http://localhost:5173',      // Vite dev server
    'http://localhost:3000',      // Local production
    'http://localhost:4000',      // Alternative port
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
    process.env.FRONTEND_URL      // Production URL from env
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        console.log(origin, callback)
        // Allow requests with no origin (mobile apps, curl, etc.) in development
        if (!origin && process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }
        if (!origin || allowedOrigins.includes(origin)) {
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

// Start server with port fallback
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

    // Start the server
    startServer(PORT);
}

initializeAndStart();

// Keep process alive and handle errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
