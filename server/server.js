import express from 'express';
import cors from 'cors';
import apiRoutes from './routes.js';
import path from 'path';
import fs from "fs";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = parseInt(process.env.PORT, 10) || 4000;

// Middleware
app.use(cors());
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
app.use(express.static(path.join(__dirname, "..", "frontend")));

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

// Start the server
startServer(PORT);

// Keep process alive and handle errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
