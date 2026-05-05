import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';

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
        db.get(
            `SELECT tenant_id, role, status, deleted_at FROM users WHERE id = ?`,
            [user.id],
            (lookupErr, row) => {
                if (lookupErr) {
                    return res.status(500).json({ error: 'Failed to resolve authenticated user' });
                }
                if (!row || row.deleted_at || row.status !== 'active') {
                    return res.status(403).json({ error: 'Invalid or inactive user' });
                }
                req.user = {
                    ...user,
                    role: row.role || user.role,
                    tenant_id: row.tenant_id || user.tenant_id || 1
                };
                next();
            }
        );
    });
};

export function resolveTenant(req) {
    return req.user?.tenant_id || 1;
}

export const requireSameTenant = (resourceTenantIdGetter) => async (req, res, next) => {
    try {
        const resourceTenantId = await resourceTenantIdGetter(req);
        if (resourceTenantId == null) {
            return res.status(404).json({ error: 'Resource not found' });
        }
        if (Number(resourceTenantId) !== Number(resolveTenant(req))) {
            return res.status(403).json({ error: 'Access denied: tenant mismatch' });
        }
        next();
    } catch (err) {
        res.status(500).json({ error: err.message || 'Tenant scope check failed' });
    }
};

export const ROLE_RANKS = Object.freeze({
    guest: 0,
    student: 1,
    user: 1,
    reviewer: 2,
    educator: 3,
    admin: 4
});

export const VALID_ROLES = Object.freeze(['guest', 'student', 'reviewer', 'educator', 'admin']);

export function normalizeRole(role) {
    return role === 'user' ? 'student' : role;
}

export function getRoleRank(roleOrUser) {
    const role = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser?.role;
    return ROLE_RANKS[normalizeRole(role)] ?? ROLE_RANKS.guest;
}

export function hasRoleAtLeast(user, minRank) {
    return getRoleRank(user) >= minRank;
}

export const requireRole = (minRank) => (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!hasRoleAtLeast(req.user, minRank)) {
        return res.status(403).json({ error: 'Insufficient role' });
    }
    next();
};

// Middleware to require specific minimum roles
export const requireAdmin = requireRole(ROLE_RANKS.admin);
export const requireEducator = requireRole(ROLE_RANKS.educator);
export const requireReviewer = requireRole(ROLE_RANKS.reviewer);
export const requireStudent = requireRole(ROLE_RANKS.student);

// Middleware to require authenticated user (admin or regular user)
export const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

// Helper function to generate JWT token.
//
// Default TTL is 4h. Tokens are not server-revocable today (the
// `active_sessions` table tracks them but `authenticateToken` doesn't
// consult it), so a long TTL means a demoted/disabled user keeps their
// access until the token expires. 4h limits that blast radius without
// being so short that users are constantly re-logging in.
//
// Override via JWT_EXPIRY env var (e.g. '7d' for a kiosk deployment).
export const generateToken = (user) => {
    const payload = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id || 1
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRY || '4h' });
};
