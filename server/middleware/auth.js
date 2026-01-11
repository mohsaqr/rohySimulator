import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from server/.env
dotenv.config({ path: path.join(__dirname, '../.env') });

// JWT_SECRET is required - fail fast if not configured
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set!');
    console.error('Please set JWT_SECRET in server/.env file');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
    process.exit(1);
}

// Middleware to authenticate JWT token
export const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user; // Attach user info to request
        next();
    });
};

// Middleware to require admin role
export const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Middleware to require authenticated user (admin or regular user)
export const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

// Helper function to generate JWT token
export const generateToken = (user) => {
    const payload = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRY || '24h' });
};
