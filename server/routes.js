import express from 'express';
import db from './db.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { authenticateToken, requireAdmin, requireAuth, generateToken } from './middleware/auth.js';
import * as labDb from './services/labDatabase.js';

// Rate limiters for security
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per window
    message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 registrations per hour per IP
    message: { error: 'Too many registration attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load radiology database
let radiologyDatabase = [];
try {
    const radiologyPath = path.join(__dirname, 'data', 'radiology_database.json');
    if (fs.existsSync(radiologyPath)) {
        const data = JSON.parse(fs.readFileSync(radiologyPath, 'utf8'));
        radiologyDatabase = data.studies || [];
        console.log(`Loaded ${radiologyDatabase.length} radiology studies from database`);
    }
} catch (err) {
    console.error('Failed to load radiology database:', err.message);
}

const router = express.Router();

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validatePassword(password) {
    const errors = [];

    if (!password || password.length < 8) {
        errors.push('Password must be at least 8 characters long');
    }
    if (password.length > 128) {
        errors.push('Password must not exceed 128 characters');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Log an action to the system audit log
 * @param {Object} params - Audit log parameters
 */
function logAudit(params) {
    const {
        userId = null,
        username = null,
        action,
        resourceType = null,
        resourceId = null,
        resourceName = null,
        oldValue = null,
        newValue = null,
        ipAddress = null,
        userAgent = null,
        sessionId = null,
        status = 'success',
        errorMessage = null,
        metadata = null
    } = params;

    db.run(
        `INSERT INTO system_audit_log
         (user_id, username, action, resource_type, resource_id, resource_name,
          old_value, new_value, ip_address, user_agent, session_id, status, error_message, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId, username, action, resourceType, resourceId, resourceName,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null,
            ipAddress, userAgent, sessionId, status, errorMessage,
            metadata ? JSON.stringify(metadata) : null
        ],
        (err) => {
            if (err) {
                console.error('[Audit Log] Failed to write audit log:', err.message);
            }
        }
    );
}

/**
 * Create a case version snapshot
 * @param {number} caseId - Case ID
 * @param {number} userId - User who made the change
 * @param {string} changeType - Type of change (created, updated, restored, published, unpublished)
 * @param {string} description - Description of changes
 * @param {Object} configSnapshot - Full config snapshot
 */
function createCaseVersion(caseId, userId, changeType, description, configSnapshot) {
    // Get current version number
    db.get(
        `SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM case_versions WHERE case_id = ?`,
        [caseId],
        (err, row) => {
            if (err) {
                console.error('[Case Version] Error getting version number:', err.message);
                return;
            }
            const versionNumber = row?.next_version || 1;
            db.run(
                `INSERT INTO case_versions (case_id, version_number, changed_by, change_type, changes_description, config_snapshot)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [caseId, versionNumber, userId, changeType, description, JSON.stringify(configSnapshot)],
                (err) => {
                    if (err) {
                        console.error('[Case Version] Failed to create version:', err.message);
                    }
                }
            );
        }
    );
}

// Configure Multer for local uploads with security validation
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../public/uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Sanitize filename - remove path traversal attempts
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + sanitizedName);
    }
});

// File type validation
const fileFilter = (req, file, cb) => {
    // Allowed MIME types for images
    const allowedMimes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml'
    ];

    // Allowed extensions
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid file type. Allowed: ${allowedExts.join(', ')}`), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max
    }
});

// --- AUTHENTICATION ---

// POST /api/auth/register - Register a new user
router.post('/auth/register', registerLimiter, async (req, res) => {
    const { username, name, email, password, role = 'user' } = req.body;

    // Validation
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
        return res.status(400).json({ error: passwordValidation.errors.join('. ') });
    }

    // Only allow admin creation if the request is from an existing admin
    let finalRole = 'user';
    if (role === 'admin') {
        // Check if there are any existing users
        const userCount = await new Promise((resolve, reject) => {
            db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        // If no users exist, first user becomes admin
        if (userCount === 0) {
            finalRole = 'admin';
        } else {
            // Otherwise, only admin can create admin
            finalRole = 'user';
        }
    }

    try {
        // Hash password
        const password_hash = await bcrypt.hash(password, 10);

        // Insert user
        const sql = `INSERT INTO users (username, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`;
        db.run(sql, [username, name || null, email, password_hash, finalRole], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ error: 'Username or email already exists' });
                }
                return res.status(500).json({ error: err.message });
            }

            const user = { id: this.lastID, username, name, email, role: finalRole };
            const token = generateToken(user);

            res.status(201).json({
                message: 'User registered successfully',
                user: { id: user.id, username, name, email, role: finalRole },
                token
            });
        });
    } catch (err) {
        res.status(500).json({ error: 'Error registering user', details: err.message });
    }
});

// POST /api/users/create - Create user (Admin only, no auto-login)
router.post('/users/create', authenticateToken, requireAdmin, async (req, res) => {
    const { username, name, email, password, role = 'user' } = req.body;

    // Validation
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
        return res.status(400).json({ error: passwordValidation.errors.join('. ') });
    }

    try {
        // Hash password
        const password_hash = await bcrypt.hash(password, 10);

        // Insert user
        const sql = `INSERT INTO users (username, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`;
        db.run(sql, [username, name || null, email, password_hash, role], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ error: 'Username or email already exists' });
                }
                return res.status(500).json({ error: 'Failed to create user' });
            }

            res.status(201).json({
                message: 'User created successfully',
                user: { id: this.lastID, username, name, email, role }
            });
        });
    } catch (err) {
        console.error('[User Create] Error:', err.message);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// POST /api/users/batch - Batch create users from CSV (Admin only)
router.post('/users/batch', authenticateToken, requireAdmin, async (req, res) => {
    const { users } = req.body;

    if (!users || !Array.isArray(users) || users.length === 0) {
        return res.status(400).json({ error: 'Users array is required' });
    }

    const results = {
        success: [],
        failed: []
    };

    for (const userData of users) {
        const { username, name, email, password, role = 'user' } = userData;

        // Validation
        if (!username || !email || !password) {
            results.failed.push({ 
                username, 
                name,
                email, 
                error: 'Missing required fields' 
            });
            continue;
        }

        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
            results.failed.push({
                username,
                name,
                email,
                error: passwordValidation.errors.join('. ')
            });
            continue;
        }

        try {
            // Hash password
            const password_hash = await bcrypt.hash(password, 10);

            // Insert user
            await new Promise((resolve, reject) => {
                const sql = `INSERT INTO users (username, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`;
                db.run(sql, [username, name || null, email, password_hash, role], function (err) {
                    if (err) {
                        if (err.message.includes('UNIQUE')) {
                            reject({ error: 'Username or email already exists' });
                        } else {
                            reject({ error: err.message });
                        }
                    } else {
                        resolve({ id: this.lastID, username, name, email, role });
                    }
                });
            });

            results.success.push({ username, name, email, role });
        } catch (err) {
            results.failed.push({ 
                username,
                name, 
                email, 
                error: err.error || 'Unknown error' 
            });
        }
    }

    res.json({
        message: `Batch upload complete: ${results.success.length} succeeded, ${results.failed.length} failed`,
        results
    });
});

// POST /api/auth/login - Login user
router.post('/auth/login', authLimiter, (req, res) => {
    const { username, password } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    const sql = `SELECT * FROM users WHERE username = ?`;
    db.get(sql, [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!user) {
            // Log failed login attempt
            db.run(
                `INSERT INTO login_logs (user_id, username, action, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`,
                [null, username, 'failed_login', ipAddress, userAgent]
            );
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        try {
            const match = await bcrypt.compare(password, user.password_hash);
            if (!match) {
                // Log failed login attempt
                db.run(
                    `INSERT INTO login_logs (user_id, username, action, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`,
                    [user.id, username, 'failed_login', ipAddress, userAgent]
                );
                return res.status(401).json({ error: 'Invalid username or password' });
            }

            // Log successful login
            db.run(
                `INSERT INTO login_logs (user_id, username, action, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`,
                [user.id, username, 'login', ipAddress, userAgent]
            );

            // Update last_login timestamp and reset failed attempts
            db.run(
                `UPDATE users SET last_login = CURRENT_TIMESTAMP, failed_login_attempts = 0 WHERE id = ?`,
                [user.id]
            );

            const token = generateToken(user);

            // Track active session
            const crypto = await import('crypto');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            db.run(
                `INSERT INTO active_sessions (user_id, token_hash, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+24 hours'))`,
                [user.id, tokenHash, ipAddress, userAgent]
            );

            res.json({
                message: 'Login successful',
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role
                },
                token
            });
        } catch (err) {
            res.status(500).json({ error: 'Error during login', details: err.message });
        }
    });
});

// GET /api/auth/verify - Verify token validity
router.get('/auth/verify', authenticateToken, (req, res) => {
    res.json({
        valid: true,
        user: {
            id: req.user.id,
            username: req.user.username,
            email: req.user.email,
            role: req.user.role
        }
    });
});

// GET /api/auth/profile - Get current user profile
router.get('/auth/profile', authenticateToken, (req, res) => {
    const sql = `SELECT id, username, email, role, created_at FROM users WHERE id = ?`;
    db.get(sql, [req.user.id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
    });
});

// POST /api/auth/logout - Log logout event
router.post('/auth/logout', authenticateToken, (req, res) => {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    db.run(
        `INSERT INTO login_logs (user_id, username, action, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`,
        [req.user.id, req.user.username, 'logout', ipAddress, userAgent],
        (err) => {
            if (err) console.error('Failed to log logout:', err);
            res.json({ message: 'Logout logged successfully' });
        }
    );
});

// --- UPLOAD ---
router.post('/upload', upload.single('photo'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const imageUrl = (process.env.NODE_ENV == 'production' ? '/rohy':"") + `/uploads/${req.file.filename}`;
    res.json({ imageUrl });
});

// --- BODY IMAGE UPLOAD (Admin Only) ---
router.post('/upload-body-image', authenticateToken, upload.single('image'), (req, res) => {
    // Check if user is admin
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const validTypes = ['man-front', 'man-back', 'woman-front', 'woman-back'];
    const imageType = req.body.type;

    if (!validTypes.includes(imageType)) {
        // Delete the uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid image type. Must be one of: ' + validTypes.join(', ') });
    }

    // Get file extension
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.png', '.svg'].includes(ext)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Only PNG and SVG files are allowed' });
    }

    // Target path in public folder
    const targetPath = path.join(__dirname, '../public', `${imageType}${ext}`);

    try {
        // Move file from uploads to public folder with correct name
        fs.renameSync(req.file.path, targetPath);
        res.json({
            success: true,
            message: `Body image ${imageType} updated successfully`,
            path: `/${imageType}${ext}`
        });
    } catch (err) {
        console.error('Failed to save body image:', err);
        res.status(500).json({ error: 'Failed to save image: ' + err.message });
    }
});

// --- BODY MAP REGIONS ---
const BODYMAP_REGIONS_FILE = path.join(__dirname, '../public/bodymap-regions.json');

// GET body map regions
router.get('/bodymap-regions', (req, res) => {
    try {
        if (fs.existsSync(BODYMAP_REGIONS_FILE)) {
            const data = fs.readFileSync(BODYMAP_REGIONS_FILE, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json({ regions: null });
        }
    } catch (err) {
        console.error('Failed to read bodymap regions:', err);
        res.status(500).json({ error: 'Failed to read regions' });
    }
});

// POST save body map regions (admin only)
router.post('/bodymap-regions', authenticateToken, (req, res) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { regions } = req.body;
    if (!regions) {
        return res.status(400).json({ error: 'No regions data provided' });
    }

    try {
        fs.writeFileSync(BODYMAP_REGIONS_FILE, JSON.stringify({ regions }, null, 2));
        res.json({ success: true, message: 'Body map regions saved' });
    } catch (err) {
        console.error('Failed to save bodymap regions:', err);
        res.status(500).json({ error: 'Failed to save regions: ' + err.message });
    }
});

// --- CASES ---

// GET /api/cases - Authenticated users can view cases (students only see available cases)
router.get('/cases', authenticateToken, (req, res) => {
    const isAdmin = req.user?.role === 'admin';

    // Students only see available cases, admins see all
    const sql = isAdmin
        ? "SELECT * FROM cases ORDER BY is_default DESC, created_at DESC"
        : "SELECT * FROM cases WHERE is_available = 1 ORDER BY is_default DESC, created_at DESC";

    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Parse JSON fields
        const cases = rows.map(row => ({
            ...row,
            config: row.config ? JSON.parse(row.config) : {},
            scenario: row.scenario ? JSON.parse(row.scenario) : null,
            is_available: Boolean(row.is_available),
            is_default: Boolean(row.is_default)
        }));

        res.json({ cases });
    });
});

// PUT /api/cases/:id/availability - Toggle case availability (Admin only)
router.put('/cases/:id/availability', authenticateToken, requireAdmin, (req, res) => {
    const { is_available } = req.body;
    db.run(
        "UPDATE cases SET is_available = ? WHERE id = ?",
        [is_available ? 1 : 0, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Case not found' });
            res.json({ success: true, is_available: Boolean(is_available) });
        }
    );
});

// PUT /api/cases/:id/default - Set case as default (Admin only)
router.put('/cases/:id/default', authenticateToken, requireAdmin, (req, res) => {
    const { is_default } = req.body;

    // If setting as default, first clear any existing defaults
    if (is_default) {
        db.run("UPDATE cases SET is_default = 0", [], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            db.run(
                "UPDATE cases SET is_default = 1, is_available = 1 WHERE id = ?",
                [req.params.id],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    if (this.changes === 0) return res.status(404).json({ error: 'Case not found' });
                    res.json({ success: true, is_default: true });
                }
            );
        });
    } else {
        db.run(
            "UPDATE cases SET is_default = 0 WHERE id = ?",
            [req.params.id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, is_default: false });
            }
        );
    }
});

// POST /api/cases - Admin only
router.post('/cases', authenticateToken, requireAdmin, (req, res) => {
    const { name, description, system_prompt, config, image_url, scenario } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Extract patient info from config for denormalized storage
    const patientGender = config?.demographics?.gender || null;
    const patientAge = config?.demographics?.age || null;
    const patientName = config?.demographics?.name || null;
    const chiefComplaint = config?.chiefComplaint || null;
    const difficultyLevel = config?.difficulty_level || null;

    const sql = `INSERT INTO cases (name, description, system_prompt, config, image_url, scenario,
                 patient_name, patient_gender, patient_age, chief_complaint, difficulty_level,
                 created_by, last_modified_by, version)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`;
    const params = [
        name,
        description,
        system_prompt,
        JSON.stringify(config || {}),
        image_url || null,
        scenario ? JSON.stringify(scenario) : null,
        patientName,
        patientGender,
        patientAge,
        chiefComplaint,
        difficultyLevel,
        req.user.id,
        req.user.id
    ];

    db.run(sql, params, function (err) {
        if (err) {
            console.error('Error saving case:', err);
            logAudit({
                userId: req.user.id,
                username: req.user.username,
                action: 'CREATE_CASE',
                resourceType: 'case',
                status: 'failure',
                errorMessage: err.message,
                ipAddress,
                userAgent
            });
            return res.status(500).json({ error: err.message });
        }

        const caseId = this.lastID;

        // Log audit trail
        logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'CREATE_CASE',
            resourceType: 'case',
            resourceId: String(caseId),
            resourceName: name,
            newValue: { name, description, config },
            ipAddress,
            userAgent,
            status: 'success'
        });

        // Create initial version snapshot
        createCaseVersion(caseId, req.user.id, 'created', 'Initial case creation', {
            name, description, system_prompt, config, scenario
        });

        res.json({ id: caseId, ...req.body });
    });
});

// PUT /api/cases/:id - Admin only
router.put('/cases/:id', authenticateToken, requireAdmin, (req, res) => {
    const { name, description, system_prompt, config, image_url, scenario } = req.body;
    const caseId = req.params.id;
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Extract patient info from config for denormalized storage
    const patientGender = config?.demographics?.gender || null;
    const patientAge = config?.demographics?.age || null;
    const patientName = config?.demographics?.name || null;
    const chiefComplaint = config?.chiefComplaint || null;
    const difficultyLevel = config?.difficulty_level || null;

    // First, get the old case data for audit trail
    db.get(`SELECT * FROM cases WHERE id = ?`, [caseId], (err, oldCase) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        const sql = `UPDATE cases SET
                     name = ?, description = ?, system_prompt = ?, config = ?, image_url = ?, scenario = ?,
                     patient_name = ?, patient_gender = ?, patient_age = ?, chief_complaint = ?, difficulty_level = ?,
                     last_modified_by = ?, updated_at = CURRENT_TIMESTAMP, version = COALESCE(version, 0) + 1
                     WHERE id = ?`;
        const params = [
            name,
            description,
            system_prompt,
            JSON.stringify(config || {}),
            image_url || null,
            scenario ? JSON.stringify(scenario) : null,
            patientName,
            patientGender,
            patientAge,
            chiefComplaint,
            difficultyLevel,
            req.user.id,
            caseId
        ];

        db.run(sql, params, function (err) {
            if (err) {
                console.error('Error updating case:', err);
                logAudit({
                    userId: req.user.id,
                    username: req.user.username,
                    action: 'UPDATE_CASE',
                    resourceType: 'case',
                    resourceId: caseId,
                    status: 'failure',
                    errorMessage: err.message,
                    ipAddress,
                    userAgent
                });
                return res.status(500).json({ error: err.message });
            }

            // Log audit trail
            logAudit({
                userId: req.user.id,
                username: req.user.username,
                action: 'UPDATE_CASE',
                resourceType: 'case',
                resourceId: caseId,
                resourceName: name,
                oldValue: oldCase ? { name: oldCase.name, description: oldCase.description } : null,
                newValue: { name, description },
                ipAddress,
                userAgent,
                status: 'success'
            });

            // Create version snapshot
            createCaseVersion(caseId, req.user.id, 'updated', 'Case configuration updated', {
                name, description, system_prompt, config, scenario
            });

            res.json({ id: caseId, ...req.body });
        });
    });
});

// DELETE /api/cases/:id - Admin only (soft delete)
router.delete('/cases/:id', authenticateToken, requireAdmin, (req, res) => {
    const caseId = req.params.id;
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Get case name for audit before deleting
    db.get(`SELECT name FROM cases WHERE id = ?`, [caseId], (err, caseData) => {
        if (err) return res.status(500).json({ error: err.message });

        // Soft delete - set deleted_at timestamp
        const sql = `UPDATE cases SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`;
        db.run(sql, [caseId], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Case not found or already deleted' });
            }

            // Log audit trail
            logAudit({
                userId: req.user.id,
                username: req.user.username,
                action: 'DELETE_CASE',
                resourceType: 'case',
                resourceId: caseId,
                resourceName: caseData?.name,
                ipAddress,
                userAgent,
                status: 'success'
            });

            res.json({ message: 'Case deleted successfully', id: caseId });
        });
    });
});

// --- SESSIONS ---

// POST /api/sessions - Authenticated users only
router.post('/sessions', authenticateToken, async (req, res) => {
    const { case_id, student_name, llm_settings, monitor_settings } = req.body;
    const user_id = req.user.id;

    // If no llm_settings provided, check user preferences for default settings
    let effectiveLlmSettings = llm_settings || {};
    if (!llm_settings || Object.keys(llm_settings).length === 0) {
        try {
            const userPrefs = await new Promise((resolve, reject) => {
                db.get('SELECT default_llm_settings FROM user_preferences WHERE user_id = ?', [user_id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            if (userPrefs?.default_llm_settings) {
                try {
                    effectiveLlmSettings = JSON.parse(userPrefs.default_llm_settings);
                    console.log(`[Session] Using user ${user_id}'s default LLM settings`);
                } catch {
                    console.warn('[Session] Failed to parse user default LLM settings');
                }
            }
        } catch (err) {
            console.warn('[Session] Failed to fetch user preferences:', err.message);
        }
    }

    const sql = `INSERT INTO sessions (case_id, user_id, student_name, llm_settings, monitor_settings) VALUES (?, ?, ?, ?, ?)`;

    db.run(sql, [
        case_id,
        user_id,
        student_name || req.user.username,
        JSON.stringify(effectiveLlmSettings),
        JSON.stringify(monitor_settings || {})
    ], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        
        const sessionId = this.lastID;

        // Create session settings snapshot
        const settingsSnapshotSql = `
            INSERT INTO session_settings (
                session_id, case_id, user_id, 
                llm_provider, llm_model, llm_base_url,
                monitor_hr, monitor_rhythm, monitor_spo2,
                monitor_bp_sys, monitor_bp_dia, monitor_rr, monitor_temp,
                settings_snapshot
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.run(settingsSnapshotSql, [
            sessionId, case_id, user_id,
            effectiveLlmSettings?.provider, effectiveLlmSettings?.model, effectiveLlmSettings?.baseUrl,
            monitor_settings?.hr, monitor_settings?.rhythm, monitor_settings?.spo2,
            monitor_settings?.bp_sys, monitor_settings?.bp_dia, monitor_settings?.rr, monitor_settings?.temp,
            JSON.stringify({ llm: effectiveLlmSettings, monitor: monitor_settings })
        ]);

        // Log case load event
        db.run(
            `INSERT INTO settings_logs (user_id, session_id, case_id, setting_type, settings_json) VALUES (?, ?, ?, ?, ?)`,
            [user_id, sessionId, case_id, 'case_load', JSON.stringify({ case_id, timestamp: new Date().toISOString() })]
        );

        res.json({ 
            id: sessionId, 
            case_id, 
            user_id, 
            student_name: student_name || req.user.username 
        });
    });
});

// GET /api/sessions/:id - Get session details for validation
router.get('/sessions/:id', authenticateToken, (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user.id;

    const sql = `
        SELECT s.*, c.name as case_name
        FROM sessions s
        LEFT JOIN cases c ON s.case_id = c.id
        WHERE s.id = ?
    `;

    db.get(sql, [sessionId], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Check ownership (users can only access their own sessions, admins can access all)
        if (session.user_id !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({ session });
    });
});

// PUT /api/sessions/:id/end - Mark session as ended
router.put('/sessions/:id/end', authenticateToken, (req, res) => {
    const sessionId = req.params.id;
    
    // Get session start time
    db.get('SELECT start_time, user_id FROM sessions WHERE id = ?', [sessionId], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        
        // Check if user owns this session or is admin
        if (session.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied' });
        }

        const endTime = new Date();
        const startTime = new Date(session.start_time);
        const duration = Math.floor((endTime - startTime) / 1000); // Duration in seconds

        const sql = `UPDATE sessions SET end_time = ?, duration = ? WHERE id = ?`;
        db.run(sql, [endTime.toISOString(), duration, sessionId], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Session ended', duration });
        });
    });
});

// --- INTERACTIONS ---

// POST /api/interactions - Authenticated users only
router.post('/interactions', authenticateToken, (req, res) => {
    const { session_id, role, content } = req.body;
    
    // Verify user owns the session
    db.get('SELECT user_id FROM sessions WHERE id = ?', [session_id], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        
        if (session.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied' });
        }

        const sql = `INSERT INTO interactions (session_id, role, content) VALUES (?, ?, ?)`;
        db.run(sql, [session_id, role, content], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, session_id, role, content });
        });
    });
});

// GET /api/interactions/:session_id - Authenticated users can view their own
router.get('/interactions/:session_id', authenticateToken, (req, res) => {
    // Verify user owns the session or is admin
    db.get('SELECT user_id FROM sessions WHERE id = ?', [req.params.session_id], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        
        if (session.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied' });
        }

        const sql = "SELECT * FROM interactions WHERE session_id = ? ORDER BY timestamp ASC";
        db.all(sql, [req.params.session_id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ interactions: rows });
        });
    });
});

// --- USER MANAGEMENT (Admin Only) ---

// GET /api/users - List all users (Admin only)
router.get('/users', authenticateToken, requireAdmin, (req, res) => {
    const sql = `SELECT id, username, name, email, role, created_at FROM users ORDER BY created_at DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ users: rows });
    });
});

// GET /api/users/:id - Get user details (Admin only)
router.get('/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const sql = `SELECT id, username, name, email, role, created_at FROM users WHERE id = ?`;
    db.get(sql, [req.params.id], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user });
    });
});

// PUT /api/users/:id - Update user (Admin only)
router.put('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { username, name, email, role, password } = req.body;

    try {
        // If password is provided, validate and hash it
        if (password) {
            const passwordValidation = validatePassword(password);
            if (!passwordValidation.valid) {
                return res.status(400).json({ error: passwordValidation.errors.join('. ') });
            }
            const password_hash = await bcrypt.hash(password, 10);
            const sql = `UPDATE users SET username = ?, name = ?, email = ?, role = ?, password_hash = ? WHERE id = ?`;
            db.run(sql, [username, name || null, email, role, password_hash, req.params.id], function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(409).json({ error: 'Username or email already exists' });
                    }
                    return res.status(500).json({ error: 'Failed to update user' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'User not found' });
                }
                res.json({ message: 'User updated successfully', id: req.params.id });
            });
        } else {
            // Update without changing password
            const sql = `UPDATE users SET username = ?, name = ?, email = ?, role = ? WHERE id = ?`;
            db.run(sql, [username, name || null, email, role, req.params.id], function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(409).json({ error: 'Username or email already exists' });
                    }
                    return res.status(500).json({ error: 'Failed to update user' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'User not found' });
                }
                res.json({ message: 'User updated successfully', id: req.params.id });
            });
        }
    } catch (err) {
        console.error('[User Update] Error:', err.message);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// DELETE /api/users/:id - Delete user (Admin only)
router.delete('/users/:id', authenticateToken, requireAdmin, (req, res) => {
    // Prevent deleting yourself
    if (parseInt(req.params.id) === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const sql = `DELETE FROM users WHERE id = ?`;
    db.run(sql, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: 'User deleted successfully', id: req.params.id });
    });
});

// --- ANALYTICS ---

// GET /api/analytics/sessions - Get sessions (Admin: all, User: their own)
router.get('/analytics/sessions', authenticateToken, (req, res) => {
    let sql;
    let params;

    if (req.user.role === 'admin') {
        // Admin sees all sessions
        sql = `
            SELECT s.*, c.name as case_name, u.username
            FROM sessions s
            LEFT JOIN cases c ON s.case_id = c.id
            LEFT JOIN users u ON s.user_id = u.id
            ORDER BY s.start_time DESC
        `;
        params = [];
    } else {
        // Users see only their own sessions
        sql = `
            SELECT s.*, c.name as case_name
            FROM sessions s
            LEFT JOIN cases c ON s.case_id = c.id
            WHERE s.user_id = ?
            ORDER BY s.start_time DESC
        `;
        params = [req.user.id];
    }

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ sessions: rows });
    });
});

// GET /api/analytics/sessions/:id - Get session details with chat log
router.get('/analytics/sessions/:id', authenticateToken, (req, res) => {
    // First get session details
    const sessionSql = `
        SELECT s.*, c.name as case_name, c.description, u.username
        FROM sessions s
        LEFT JOIN cases c ON s.case_id = c.id
        LEFT JOIN users u ON s.user_id = u.id
        WHERE s.id = ?
    `;

    db.get(sessionSql, [req.params.id], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Check permissions
        if (session.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get interactions
        const interactionsSql = `SELECT * FROM interactions WHERE session_id = ? ORDER BY timestamp ASC`;
        db.all(interactionsSql, [req.params.id], (err, interactions) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ session, interactions });
        });
    });
});

// GET /api/analytics/user-stats/:userId - Get user statistics
router.get('/analytics/user-stats/:userId', authenticateToken, (req, res) => {
    const userId = parseInt(req.params.userId);

    // Users can only view their own stats, admins can view anyone's
    if (req.user.id !== userId && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }

    const sql = `
        SELECT 
            COUNT(*) as total_sessions,
            SUM(CASE WHEN duration IS NOT NULL THEN 1 ELSE 0 END) as completed_sessions,
            SUM(duration) as total_duration,
            AVG(duration) as avg_duration,
            COUNT(DISTINCT case_id) as unique_cases
        FROM sessions
        WHERE user_id = ?
    `;

    db.get(sql, [userId], (err, stats) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Get interaction count
        const interactionSql = `
            SELECT COUNT(*) as total_interactions
            FROM interactions i
            JOIN sessions s ON i.session_id = s.id
            WHERE s.user_id = ?
        `;

        db.get(interactionSql, [userId], (err, interactionStats) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ 
                ...stats, 
                total_interactions: interactionStats.total_interactions 
            });
        });
    });
});

// --- SETTINGS LOGGING ---

// POST /api/settings/log - Log settings changes
router.post('/settings/log', authenticateToken, (req, res) => {
    const { session_id, case_id, setting_type, setting_name, old_value, new_value, settings_json } = req.body;
    
    const sql = `INSERT INTO settings_logs (
        user_id, session_id, case_id, setting_type, setting_name, 
        old_value, new_value, settings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(sql, [
        req.user.id, session_id, case_id, setting_type, setting_name,
        old_value, new_value, JSON.stringify(settings_json)
    ], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, message: 'Setting logged' });
    });
});

// GET /api/analytics/login-logs - Get login logs as JSON (Admin only)
router.get('/analytics/login-logs', authenticateToken, requireAdmin, (req, res) => {
    const { limit = 100 } = req.query;
    
    const sql = `
        SELECT ll.*, u.email, u.role
        FROM login_logs ll
        LEFT JOIN users u ON ll.user_id = u.id
        ORDER BY ll.timestamp DESC
        LIMIT ?
    `;
    
    db.all(sql, [limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ logs: rows });
    });
});

// GET /api/analytics/settings-logs - Get settings logs as JSON (Admin only)
router.get('/analytics/settings-logs', authenticateToken, requireAdmin, (req, res) => {
    const { limit = 100 } = req.query;
    
    const sql = `
        SELECT sl.*, u.username, c.name as case_name
        FROM settings_logs sl
        LEFT JOIN users u ON sl.user_id = u.id
        LEFT JOIN cases c ON sl.case_id = c.id
        ORDER BY sl.timestamp DESC
        LIMIT ?
    `;
    
    db.all(sql, [limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ logs: rows });
    });
});

// --- COMPREHENSIVE EXPORT ENDPOINTS ---

// GET /api/export/login-logs - Export login logs as CSV
router.get('/export/login-logs', authenticateToken, requireAdmin, (req, res) => {
    const { start_date, end_date } = req.query;
    let sql = `
        SELECT 
            ll.id, ll.user_id, ll.username, ll.action, 
            ll.ip_address, ll.user_agent, ll.timestamp,
            u.email, u.role
        FROM login_logs ll
        LEFT JOIN users u ON ll.user_id = u.id
    `;
    
    const params = [];
    if (start_date || end_date) {
        sql += ' WHERE 1=1';
        if (start_date) {
            sql += ' AND ll.timestamp >= ?';
            params.push(start_date);
        }
        if (end_date) {
            sql += ' AND ll.timestamp <= ?';
            params.push(end_date);
        }
    }
    sql += ' ORDER BY ll.timestamp DESC';

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Convert to CSV
        const csv = convertToCSV(rows);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=login_logs.csv');
        res.send(csv);
    });
});

// GET /api/export/chat-logs - Export chat logs as CSV
router.get('/export/chat-logs', authenticateToken, (req, res) => {
    const { session_id, case_id, start_date, end_date } = req.query;
    
    let sql = `
        SELECT 
            i.id, i.session_id, i.role, i.content, i.timestamp,
            s.case_id, s.user_id, s.student_name, s.start_time, s.duration,
            c.name as case_name, u.username, u.email
        FROM interactions i
        JOIN sessions s ON i.session_id = s.id
        JOIN cases c ON s.case_id = c.id
        JOIN users u ON s.user_id = u.id
        WHERE 1=1
    `;
    
    const params = [];
    
    // Users can only see their own, admins see all
    if (req.user.role !== 'admin') {
        sql += ' AND s.user_id = ?';
        params.push(req.user.id);
    }
    
    if (session_id) {
        sql += ' AND i.session_id = ?';
        params.push(session_id);
    }
    if (case_id) {
        sql += ' AND s.case_id = ?';
        params.push(case_id);
    }
    if (start_date) {
        sql += ' AND i.timestamp >= ?';
        params.push(start_date);
    }
    if (end_date) {
        sql += ' AND i.timestamp <= ?';
        params.push(end_date);
    }
    
    sql += ' ORDER BY i.timestamp ASC';

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const csv = convertToCSV(rows);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=chat_logs.csv');
        res.send(csv);
    });
});

// GET /api/export/settings-logs - Export settings logs as CSV
router.get('/export/settings-logs', authenticateToken, requireAdmin, (req, res) => {
    const { start_date, end_date, setting_type } = req.query;
    
    let sql = `
        SELECT 
            sl.id, sl.user_id, sl.session_id, sl.case_id,
            sl.setting_type, sl.setting_name, sl.old_value, sl.new_value,
            sl.settings_json, sl.timestamp,
            u.username, u.email, c.name as case_name
        FROM settings_logs sl
        LEFT JOIN users u ON sl.user_id = u.id
        LEFT JOIN cases c ON sl.case_id = c.id
        WHERE 1=1
    `;
    
    const params = [];
    if (setting_type) {
        sql += ' AND sl.setting_type = ?';
        params.push(setting_type);
    }
    if (start_date) {
        sql += ' AND sl.timestamp >= ?';
        params.push(start_date);
    }
    if (end_date) {
        sql += ' AND sl.timestamp <= ?';
        params.push(end_date);
    }
    
    sql += ' ORDER BY sl.timestamp DESC';

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const csv = convertToCSV(rows);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=settings_logs.csv');
        res.send(csv);
    });
});

// GET /api/export/session-settings - Export session settings as CSV
router.get('/export/session-settings', authenticateToken, (req, res) => {
    const { start_date, end_date, case_id } = req.query;
    
    let sql = `
        SELECT 
            ss.id, ss.session_id, ss.case_id, ss.user_id,
            ss.llm_provider, ss.llm_model, ss.llm_base_url,
            ss.monitor_hr, ss.monitor_rhythm, ss.monitor_spo2,
            ss.monitor_bp_sys, ss.monitor_bp_dia, ss.monitor_rr, ss.monitor_temp,
            ss.timestamp,
            u.username, u.email, c.name as case_name,
            s.start_time, s.end_time, s.duration
        FROM session_settings ss
        JOIN users u ON ss.user_id = u.id
        JOIN cases c ON ss.case_id = c.id
        JOIN sessions s ON ss.session_id = s.id
        WHERE 1=1
    `;
    
    const params = [];
    
    // Users can only see their own
    if (req.user.role !== 'admin') {
        sql += ' AND ss.user_id = ?';
        params.push(req.user.id);
    }
    
    if (case_id) {
        sql += ' AND ss.case_id = ?';
        params.push(case_id);
    }
    if (start_date) {
        sql += ' AND ss.timestamp >= ?';
        params.push(start_date);
    }
    if (end_date) {
        sql += ' AND ss.timestamp <= ?';
        params.push(end_date);
    }
    
    sql += ' ORDER BY ss.timestamp DESC';

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const csv = convertToCSV(rows);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=session_settings.csv');
        res.send(csv);
    });
});

// GET /api/export/complete-session/:sessionId - Export complete session data
router.get('/export/complete-session/:sessionId', authenticateToken, (req, res) => {
    const sessionId = req.params.sessionId;
    
    // Verify ownership
    db.get('SELECT user_id FROM sessions WHERE id = ?', [sessionId], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        
        if (session.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get complete session data
        const sql = `
            SELECT 
                s.id as session_id, s.start_time, s.end_time, s.duration,
                s.llm_settings, s.monitor_settings,
                u.username, u.email,
                c.name as case_name, c.description as case_description,
                ss.llm_provider, ss.llm_model, ss.monitor_hr, ss.monitor_rhythm,
                ss.monitor_spo2, ss.monitor_bp_sys, ss.monitor_bp_dia, ss.monitor_rr
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            JOIN cases c ON s.case_id = c.id
            LEFT JOIN session_settings ss ON s.id = ss.session_id
            WHERE s.id = ?
        `;

        db.get(sql, [sessionId], (err, sessionData) => {
            if (err) return res.status(500).json({ error: err.message });

            // Get all interactions
            db.all(
                'SELECT role, content, timestamp FROM interactions WHERE session_id = ? ORDER BY timestamp ASC',
                [sessionId],
                (err, interactions) => {
                    if (err) return res.status(500).json({ error: err.message });

                    // Combine data
                    const completeData = {
                        ...sessionData,
                        interactions
                    };

                    // Convert to CSV format
                    const csv = convertCompleteSessionToCSV(completeData);
                    res.setHeader('Content-Type', 'text/csv');
                    res.setHeader('Content-Disposition', `attachment; filename=session_${sessionId}_complete.csv`);
                    res.send(csv);
                }
            );
        });
    });
});

// Helper function to convert JSON to CSV
function convertToCSV(data) {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvRows = [];
    
    // Add headers
    csvRows.push(headers.map(h => `"${h}"`).join(','));
    
    // Add data rows
    for (const row of data) {
        const values = headers.map(header => {
            const val = row[header];
            const escaped = ('' + val).replace(/"/g, '""');
            return `"${escaped}"`;
        });
        csvRows.push(values.join(','));
    }
    
    return csvRows.join('\n');
}

// Helper function to convert complete session to CSV
function convertCompleteSessionToCSV(data) {
    const { interactions, ...sessionInfo } = data;
    
    let csv = '=== SESSION INFORMATION ===\n';
    csv += convertToCSV([sessionInfo]) + '\n\n';
    csv += '=== CHAT LOG ===\n';
    csv += convertToCSV(interactions);
    
    return csv;
}

// --- EVENT LOG ENDPOINTS ---

// POST /api/events/batch - Log multiple events at once
router.post('/events/batch', authenticateToken, (req, res) => {
    const { session_id, events } = req.body;
    
    if (!session_id || !events || !Array.isArray(events)) {
        return res.status(400).json({ error: 'session_id and events array required' });
    }

    const sql = `INSERT INTO event_log (session_id, event_type, description, vital_sign, old_value, new_value, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;

    const stmt = db.prepare(sql);
    let inserted = 0;
    let runError = null;
    let pending = events.length;

    if (pending === 0) {
        stmt.finalize();
        return res.json({ message: '0 events logged' });
    }

    events.forEach(event => {
        stmt.run(
            session_id,
            event.event_type,
            event.description,
            event.vital_sign || null,
            event.old_value || null,
            event.new_value || null,
            event.timestamp,
            function(err) {
                if (err && !runError) {
                    runError = err;
                } else if (!err) {
                    inserted++;
                }
                pending--;
                if (pending === 0) {
                    stmt.finalize((finalizeErr) => {
                        if (runError) {
                            return res.status(500).json({ error: runError.message });
                        }
                        if (finalizeErr) {
                            return res.status(500).json({ error: finalizeErr.message });
                        }
                        res.json({ message: `${inserted} events logged` });
                    });
                }
            }
        );
    });
});

// GET /api/sessions/:id/events - Get all events for a session
router.get('/sessions/:id/events', authenticateToken, (req, res) => {
    const sessionId = req.params.id;
    
    const sql = `SELECT * FROM event_log WHERE session_id = ? ORDER BY timestamp ASC`;
    
    db.all(sql, [sessionId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ events: rows });
    });
});

// --- LEARNING ANALYTICS ENDPOINTS ---

// Standard xAPI-style verbs for learning analytics
const LEARNING_VERBS = [
    // Session lifecycle
    'STARTED_SESSION', 'ENDED_SESSION', 'RESUMED_SESSION',
    // Navigation
    'VIEWED', 'OPENED', 'CLOSED', 'NAVIGATED', 'SWITCHED_TAB',
    // Interactions
    'CLICKED', 'SELECTED', 'DESELECTED', 'TOGGLED', 'EXPANDED', 'COLLAPSED',
    // Lab/Investigation actions
    'ORDERED_LAB', 'VIEWED_LAB_RESULT', 'SEARCHED_LABS', 'FILTERED_LABS',
    // Chat interactions
    'SENT_MESSAGE', 'RECEIVED_MESSAGE', 'COPIED_MESSAGE',
    // Monitor interactions
    'ADJUSTED_VITAL', 'ACKNOWLEDGED_ALARM', 'SILENCED_ALARM',
    // Settings
    'CHANGED_SETTING', 'SAVED_SETTING',
    // Case interactions
    'LOADED_CASE', 'VIEWED_PATIENT_INFO', 'VIEWED_RECORDS',
    // Scenario interactions
    'STARTED_SCENARIO', 'PAUSED_SCENARIO', 'RESUMED_SCENARIO',
    // Submissions
    'SUBMITTED', 'ANSWERED', 'ATTEMPTED'
];

// POST /api/learning-events - Log a learning event
router.post('/learning-events', authenticateToken, (req, res) => {
    const {
        session_id,
        case_id,
        verb,
        object_type,
        object_id,
        object_name,
        component,
        parent_component,
        result,
        duration_ms,
        context,
        message_content,
        message_role
    } = req.body;

    const user_id = req.user.id;

    // Validate verb
    if (!verb || !LEARNING_VERBS.includes(verb)) {
        return res.status(400).json({
            error: `Invalid verb. Must be one of: ${LEARNING_VERBS.join(', ')}`
        });
    }

    if (!object_type) {
        return res.status(400).json({ error: 'object_type is required' });
    }

    const sql = `
        INSERT INTO learning_events (
            session_id, user_id, case_id, verb,
            object_type, object_id, object_name,
            component, parent_component,
            result, duration_ms, context,
            message_content, message_role
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
        session_id,
        user_id,
        case_id,
        verb,
        object_type,
        object_id || null,
        object_name || null,
        component || null,
        parent_component || null,
        result || null,
        duration_ms || null,
        context ? JSON.stringify(context) : null,
        message_content || null,
        message_role || null
    ], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID });
    });
});

// POST /api/learning-events/batch - Log multiple events at once
router.post('/learning-events/batch', authenticateToken, (req, res) => {
    const { events } = req.body;
    const user_id = req.user.id;

    if (!Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ error: 'events array is required' });
    }

    const sql = `
        INSERT INTO learning_events (
            session_id, user_id, case_id, verb,
            object_type, object_id, object_name,
            component, parent_component,
            result, duration_ms, context,
            message_content, message_role, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const stmt = db.prepare(sql);
    let inserted = 0;

    events.forEach(event => {
        stmt.run([
            event.session_id,
            user_id,
            event.case_id,
            event.verb,
            event.object_type,
            event.object_id || null,
            event.object_name || null,
            event.component || null,
            event.parent_component || null,
            event.result || null,
            event.duration_ms || null,
            event.context ? JSON.stringify(event.context) : null,
            event.message_content || null,
            event.message_role || null,
            event.timestamp || new Date().toISOString()
        ], function(err) {
            if (!err) inserted++;
        });
    });

    stmt.finalize((err) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ inserted, total: events.length });
    });
});

// GET /api/learning-events/session/:id - Get all learning events for a session
router.get('/learning-events/session/:id', authenticateToken, (req, res) => {
    const sessionId = req.params.id;
    const userId = req.user.id;

    // Verify user owns session or is admin
    db.get('SELECT user_id FROM sessions WHERE id = ?', [sessionId], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.user_id !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied' });
        }

        const sql = `
            SELECT le.*, c.name as case_name
            FROM learning_events le
            LEFT JOIN cases c ON le.case_id = c.id
            WHERE le.session_id = ?
            ORDER BY le.timestamp ASC
        `;

        db.all(sql, [sessionId], (err, events) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ events });
        });
    });
});

// GET /api/learning-events/user/:id - Get all learning events for a user (admin only)
router.get('/learning-events/user/:id', authenticateToken, (req, res) => {
    const targetUserId = req.params.id;

    // Only admin or the user themselves can view
    if (req.user.id !== parseInt(targetUserId) && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }

    const { start_date, end_date, verb, case_id, limit = 1000 } = req.query;

    let sql = `
        SELECT le.*, s.start_time as session_start, c.name as case_name
        FROM learning_events le
        LEFT JOIN sessions s ON le.session_id = s.id
        LEFT JOIN cases c ON le.case_id = c.id
        WHERE le.user_id = ?
    `;
    const params = [targetUserId];

    if (start_date) {
        sql += ` AND le.timestamp >= ?`;
        params.push(start_date);
    }
    if (end_date) {
        sql += ` AND le.timestamp <= ?`;
        params.push(end_date);
    }
    if (verb) {
        sql += ` AND le.verb = ?`;
        params.push(verb);
    }
    if (case_id) {
        sql += ` AND le.case_id = ?`;
        params.push(case_id);
    }

    sql += ` ORDER BY le.timestamp DESC LIMIT ?`;
    params.push(parseInt(limit));

    db.all(sql, params, (err, events) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ events });
    });
});

// GET /api/learning-events/analytics/summary - Get analytics summary
router.get('/learning-events/analytics/summary', authenticateToken, (req, res) => {
    const { session_id, user_id, case_id } = req.query;

    // Build where clause
    let whereClause = '';
    const params = [];

    if (session_id) {
        whereClause = 'WHERE session_id = ?';
        params.push(session_id);
    } else if (user_id) {
        // Check permission
        if (req.user.id !== parseInt(user_id) && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied' });
        }
        whereClause = 'WHERE user_id = ?';
        params.push(user_id);
    } else if (req.user.role !== 'admin') {
        // Non-admins can only see their own data
        whereClause = 'WHERE user_id = ?';
        params.push(req.user.id);
    }

    if (case_id) {
        whereClause += whereClause ? ' AND case_id = ?' : 'WHERE case_id = ?';
        params.push(case_id);
    }

    const sql = `
        SELECT
            verb,
            object_type,
            COUNT(*) as count,
            AVG(duration_ms) as avg_duration_ms
        FROM learning_events
        ${whereClause}
        GROUP BY verb, object_type
        ORDER BY count DESC
    `;

    db.all(sql, params, (err, summary) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ summary });
    });
});

// GET /api/learning-events/verbs - Get list of valid verbs
router.get('/learning-events/verbs', (req, res) => {
    res.json({ verbs: LEARNING_VERBS });
});

// GET /api/learning-events/recent - Get recent events across all sessions (for current user)
router.get('/learning-events/recent', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 200;

    const sql = `
        SELECT le.*, s.case_id, c.name as case_name
        FROM learning_events le
        LEFT JOIN sessions s ON le.session_id = s.id
        LEFT JOIN cases c ON s.case_id = c.id
        WHERE le.user_id = ?
        ORDER BY le.timestamp DESC
        LIMIT ?
    `;

    db.all(sql, [userId, limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Parse JSON fields
        const events = rows.map(row => ({
            ...row,
            context: row.context ? JSON.parse(row.context) : null
        }));

        res.json({ events });
    });
});

// GET /api/learning-events/all - Get ALL events across all users and sessions (admin) or user's events
router.get('/learning-events/all', authenticateToken, (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const limit = parseInt(req.query.limit) || 500;

    // Admin sees all events, regular users see only their own
    const sql = isAdmin ? `
        SELECT le.*,
               s.case_id,
               c.name as case_name,
               u.username
        FROM learning_events le
        LEFT JOIN sessions s ON le.session_id = s.id
        LEFT JOIN cases c ON s.case_id = c.id
        LEFT JOIN users u ON le.user_id = u.id
        ORDER BY le.timestamp DESC
        LIMIT ?
    ` : `
        SELECT le.*,
               s.case_id,
               c.name as case_name,
               u.username
        FROM learning_events le
        LEFT JOIN sessions s ON le.session_id = s.id
        LEFT JOIN cases c ON s.case_id = c.id
        LEFT JOIN users u ON le.user_id = u.id
        WHERE le.user_id = ?
        ORDER BY le.timestamp DESC
        LIMIT ?
    `;

    const params = isAdmin ? [limit] : [req.user.id, limit];

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Parse JSON fields and add session info
        const events = rows.map(row => ({
            ...row,
            context: row.context ? JSON.parse(row.context) : null
        }));

        // Get unique sessions for filtering
        const sessions = [...new Map(events.filter(e => e.session_id).map(e => [
            e.session_id,
            { id: e.session_id, case_name: e.case_name, username: e.username }
        ])).values()];

        res.json({ events, sessions });
    });
});

// GET /api/learning-events/detailed/:sessionId - Get detailed events with lab workflow info
router.get('/learning-events/detailed/:sessionId', authenticateToken, (req, res) => {
    const sessionId = req.params.sessionId;

    // Get all learning events for this session with full details
    const eventsSql = `
        SELECT le.*,
               u.username,
               c.name as case_name
        FROM learning_events le
        LEFT JOIN users u ON le.user_id = u.id
        LEFT JOIN sessions s ON le.session_id = s.id
        LEFT JOIN cases c ON s.case_id = c.id
        WHERE le.session_id = ?
        ORDER BY le.timestamp ASC
    `;

    // Get lab orders with timing info
    const labOrdersSql = `
        SELECT io.*, ci.test_name, ci.test_group,
               ROUND((julianday(io.available_at) - julianday(io.ordered_at)) * 24 * 60, 1) as wait_minutes,
               ROUND((julianday(io.viewed_at) - julianday(io.available_at)) * 24 * 60, 1) as view_delay_minutes
        FROM investigation_orders io
        LEFT JOIN case_investigations ci ON io.investigation_id = ci.id
        WHERE io.session_id = ?
        ORDER BY io.ordered_at ASC
    `;

    // Get chat messages
    const chatSql = `
        SELECT * FROM interactions
        WHERE session_id = ?
        ORDER BY timestamp ASC
    `;

    db.all(eventsSql, [sessionId], (err, events) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all(labOrdersSql, [sessionId], (err, labOrders) => {
            if (err) return res.status(500).json({ error: err.message });

            db.all(chatSql, [sessionId], (err, chatMessages) => {
                if (err) return res.status(500).json({ error: err.message });

                // Parse JSON fields in events
                const parsedEvents = events.map(row => ({
                    ...row,
                    context: row.context ? JSON.parse(row.context) : null
                }));

                res.json({
                    events: parsedEvents,
                    labOrders,
                    chatMessages,
                    summary: {
                        totalEvents: parsedEvents.length,
                        totalLabsOrdered: labOrders.length,
                        totalMessages: chatMessages.length,
                        labsViewed: labOrders.filter(l => l.viewed_at).length,
                        avgLabWaitTime: labOrders.length > 0
                            ? (labOrders.reduce((sum, l) => sum + (l.wait_minutes || 0), 0) / labOrders.length).toFixed(1)
                            : 0
                    }
                });
            });
        });
    });
});

// --- ALARM ENDPOINTS ---

// POST /api/alarms/log - Log an alarm event
router.post('/alarms/log', authenticateToken, (req, res) => {
    const { session_id, vital_sign, threshold_type, threshold_value, actual_value } = req.body;
    
    const sql = `INSERT INTO alarm_events (session_id, vital_sign, threshold_type, threshold_value, actual_value) 
                 VALUES (?, ?, ?, ?, ?)`;
    
    db.run(sql, [session_id, vital_sign, threshold_type, threshold_value, actual_value], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID });
    });
});

// PUT /api/alarms/:id/acknowledge - Acknowledge an alarm
router.put('/alarms/:id/acknowledge', authenticateToken, (req, res) => {
    const alarmId = req.params.id;
    
    const sql = `UPDATE alarm_events SET acknowledged_at = CURRENT_TIMESTAMP WHERE id = ?`;
    
    db.run(sql, [alarmId], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'Alarm acknowledged' });
    });
});

// GET /api/alarms/config - Get default alarm config
router.get('/alarms/config', authenticateToken, (req, res) => {
    const sql = `SELECT * FROM alarm_config WHERE user_id IS NULL`;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ config: rows });
    });
});

// GET /api/alarms/config/:userId - Get alarm config for specific user
router.get('/alarms/config/:userId', authenticateToken, (req, res) => {
    const userId = req.params.userId;
    
    const sql = `SELECT * FROM alarm_config WHERE user_id = ?`;
    
    db.all(sql, [userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ config: rows });
    });
});

// POST /api/alarms/config - Save alarm config for user
router.post('/alarms/config', authenticateToken, (req, res) => {
    const { user_id, vital_sign, high_threshold, low_threshold, enabled } = req.body;
    
    // Check if config exists
    const checkSql = `SELECT id FROM alarm_config WHERE user_id ${user_id ? '= ?' : 'IS NULL'} AND vital_sign = ?`;
    const checkParams = user_id ? [user_id, vital_sign] : [vital_sign];
    
    db.get(checkSql, checkParams, (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (row) {
            // Update existing
            const updateSql = `UPDATE alarm_config SET high_threshold = ?, low_threshold = ?, enabled = ? WHERE id = ?`;
            db.run(updateSql, [high_threshold, low_threshold, enabled ? 1 : 0, row.id], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.json({ message: 'Alarm config updated' });
            });
        } else {
            // Insert new
            const insertSql = `INSERT INTO alarm_config (user_id, vital_sign, high_threshold, low_threshold, enabled) 
                               VALUES (?, ?, ?, ?, ?)`;
            db.run(insertSql, [user_id, vital_sign, high_threshold, low_threshold, enabled ? 1 : 0], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.json({ id: this.lastID });
            });
        }
    });
});

// --- INVESTIGATION ENDPOINTS ---

// GET /api/cases/:id/investigations - Get all investigations for a case
router.get('/cases/:id/investigations', authenticateToken, (req, res) => {
    const caseId = req.params.id;
    
    const sql = `SELECT * FROM case_investigations WHERE case_id = ?`;
    
    db.all(sql, [caseId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ investigations: rows });
    });
});

// POST /api/investigations - Admin creates investigation for case
router.post('/investigations', authenticateToken, requireAdmin, (req, res) => {
    const { case_id, investigation_type, test_name, result_data, image_url, turnaround_minutes } = req.body;
    
    const sql = `INSERT INTO case_investigations (case_id, investigation_type, test_name, result_data, image_url, turnaround_minutes) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    
    db.run(sql, [case_id, investigation_type, test_name, JSON.stringify(result_data), image_url, turnaround_minutes || 30], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID });
    });
});

// POST /api/sessions/:id/order - Order investigation(s)
router.post('/sessions/:id/order', authenticateToken, (req, res) => {
    const sessionId = req.params.id;
    const { investigation_ids } = req.body; // Array of investigation IDs
    
    if (!Array.isArray(investigation_ids)) {
        return res.status(400).json({ error: 'investigation_ids must be an array' });
    }

    const sql = `INSERT INTO investigation_orders (session_id, investigation_id, available_at)
                 VALUES (?, ?, datetime('now', '+' || (SELECT turnaround_minutes FROM case_investigations WHERE id = ?) || ' minutes'))`;

    const stmt = db.prepare(sql);
    let inserted = 0;
    let runError = null;
    let pending = investigation_ids.length;

    if (pending === 0) {
        stmt.finalize();
        return res.json({ message: '0 investigations ordered' });
    }

    investigation_ids.forEach(invId => {
        stmt.run(sessionId, invId, invId, function(err) {
            if (err && !runError) {
                runError = err;
            } else if (!err) {
                inserted++;
            }
            pending--;
            if (pending === 0) {
                stmt.finalize((finalizeErr) => {
                    if (runError) {
                        return res.status(500).json({ error: runError.message });
                    }
                    if (finalizeErr) {
                        return res.status(500).json({ error: finalizeErr.message });
                    }
                    res.json({ message: `${inserted} investigations ordered` });
                });
            }
        });
    });
});

// GET /api/sessions/:id/orders - Get all orders for session
router.get('/sessions/:id/orders', authenticateToken, (req, res) => {
    const sessionId = req.params.id;

    // Calculate is_ready directly in SQLite to avoid timezone issues
    const sql = `
        SELECT
            io.*,
            ci.investigation_type,
            ci.test_name,
            ci.test_group,
            ci.gender_category,
            ci.min_value,
            ci.max_value,
            ci.current_value,
            ci.unit,
            ci.result_data,
            ci.image_url,
            ci.turnaround_minutes,
            ci.is_abnormal,
            CASE WHEN datetime(io.available_at) <= datetime('now') THEN 1 ELSE 0 END as is_ready_db,
            (julianday(io.available_at) - julianday('now')) * 24 * 60 as minutes_remaining
        FROM investigation_orders io
        JOIN case_investigations ci ON io.investigation_id = ci.id
        WHERE io.session_id = ?
        ORDER BY io.ordered_at DESC
    `;

    db.all(sql, [sessionId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        console.log(`[Orders API] Session ${sessionId}: ${rows.length} raw rows from DB`);

        // Parse JSON result_data and ensure all values are present
        const orders = rows.map(row => {
            const order = {
                ...row,
                result_data: row.result_data ? JSON.parse(row.result_data) : null,
                is_ready: row.is_ready_db === 1,
                minutes_remaining: Math.max(0, Math.ceil(row.minutes_remaining || 0)),
                test_group: row.test_group || 'General',
                unit: row.unit || '',
                min_value: row.min_value ?? null,
                max_value: row.max_value ?? null,
                current_value: row.current_value ?? null
            };
            console.log(`  [Order] ${row.test_name}: is_ready=${order.is_ready}, mins_remaining_raw=${row.minutes_remaining?.toFixed(2)}, available_at=${row.available_at}`);
            return order;
        });

        res.json({ orders });
    });
});

// PUT /api/orders/:id/view - Mark investigation as viewed
router.put('/orders/:id/view', authenticateToken, (req, res) => {
    const orderId = req.params.id;
    const userId = req.user.id;

    // First get the order details for logging
    const getOrderSql = `
        SELECT io.*, ci.test_name, ci.test_group, ci.current_value, ci.unit, ci.is_abnormal,
               s.case_id, s.id as session_id
        FROM investigation_orders io
        LEFT JOIN case_investigations ci ON io.investigation_id = ci.id
        LEFT JOIN sessions s ON io.session_id = s.id
        WHERE io.id = ?
    `;

    db.get(getOrderSql, [orderId], (err, order) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!order) return res.status(404).json({ error: 'Order not found' });

        const now = new Date();
        const orderedAt = new Date(order.ordered_at);
        const availableAt = new Date(order.available_at);

        // Calculate timing metrics
        const waitTimeMs = availableAt - orderedAt;
        const viewDelayMs = order.viewed_at ? 0 : (now - availableAt);
        const totalTimeMs = now - orderedAt;

        // Update viewed_at
        const updateSql = `UPDATE investigation_orders SET viewed_at = CURRENT_TIMESTAMP WHERE id = ?`;

        db.run(updateSql, [orderId], function(updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });

            // Log detailed learning event
            const logSql = `
                INSERT INTO learning_events (
                    session_id, user_id, case_id, verb, object_type, object_id, object_name,
                    component, result, duration_ms, context
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const context = {
                test_group: order.test_group,
                value: order.current_value,
                unit: order.unit,
                is_abnormal: order.is_abnormal,
                wait_time_ms: waitTimeMs,
                view_delay_ms: viewDelayMs,
                total_time_ms: totalTimeMs,
                ordered_at: order.ordered_at,
                available_at: order.available_at
            };

            const resultText = `${order.current_value} ${order.unit || ''}${order.is_abnormal ? ' (ABNORMAL)' : ''}`;

            db.run(logSql, [
                order.session_id,
                userId,
                order.case_id,
                'VIEWED_LAB_RESULT',
                'lab_result',
                String(order.investigation_id),
                order.test_name,
                'OrdersDrawer',
                resultText,
                viewDelayMs,
                JSON.stringify(context)
            ]);

            res.json({
                message: 'Investigation marked as viewed',
                timing: {
                    wait_time_minutes: Math.round(waitTimeMs / 60000 * 10) / 10,
                    view_delay_minutes: Math.round(viewDelayMs / 60000 * 10) / 10,
                    total_time_minutes: Math.round(totalTimeMs / 60000 * 10) / 10
                }
            });
        });
    });
});

// --- LABORATORY DATABASE ENDPOINTS ---

// GET /api/labs/search - Search lab database
router.get('/labs/search', authenticateToken, (req, res) => {
    const { q, limit = 50 } = req.query;
    
    if (!q || q.trim() === '') {
        return res.json({ results: [] });
    }
    
    try {
        const results = labDb.searchTests(q, parseInt(limit));
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: 'Error searching labs', details: error.message });
    }
});

// GET /api/labs/groups - Get all test groups
router.get('/labs/groups', authenticateToken, (req, res) => {
    try {
        const groups = labDb.getAllGroups();
        res.json({ groups });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching groups', details: error.message });
    }
});

// GET /api/labs/group/:groupName - Get tests by group
router.get('/labs/group/:groupName', authenticateToken, (req, res) => {
    const { groupName } = req.params;
    
    try {
        const tests = labDb.getTestsByGroup(decodeURIComponent(groupName));
        res.json({ tests });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching tests by group', details: error.message });
    }
});

// GET /api/labs/all - Get all tests (paginated)
router.get('/labs/all', authenticateToken, (req, res) => {
    const { page = 1, pageSize = 50 } = req.query;
    
    try {
        const result = labDb.getAllTests(parseInt(page), parseInt(pageSize));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching all tests', details: error.message });
    }
});

// GET /api/labs/grouped - Get tests grouped by name
router.get('/labs/grouped', authenticateToken, (req, res) => {
    try {
        const grouped = labDb.getGroupedTests();
        res.json({ tests: grouped });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching grouped tests', details: error.message });
    }
});

// GET /api/labs/stats - Get database statistics (Admin only)
router.get('/labs/stats', authenticateToken, requireAdmin, (req, res) => {
    try {
        const stats = labDb.getDatabaseStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching stats', details: error.message });
    }
});

// POST /api/labs/test - Add a new lab test (Admin only)
router.post('/labs/test', authenticateToken, requireAdmin, (req, res) => {
    try {
        const result = labDb.addTest(req.body);
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        res.status(201).json({ message: 'Test added successfully', test: result.test });
    } catch (error) {
        res.status(500).json({ error: 'Error adding test', details: error.message });
    }
});

// PUT /api/labs/test - Update a lab test (Admin only)
router.put('/labs/test', authenticateToken, requireAdmin, (req, res) => {
    const { test_name, category, ...updates } = req.body;

    if (!test_name || !category) {
        return res.status(400).json({ error: 'test_name and category are required' });
    }

    try {
        const result = labDb.updateTest(test_name, category, updates);
        if (!result.success) {
            return res.status(404).json({ error: result.error });
        }
        res.json({ message: 'Test updated successfully', test: result.test });
    } catch (error) {
        res.status(500).json({ error: 'Error updating test', details: error.message });
    }
});

// DELETE /api/labs/test - Delete a lab test (Admin only)
router.delete('/labs/test', authenticateToken, requireAdmin, (req, res) => {
    const { test_name, category } = req.body;

    if (!test_name || !category) {
        return res.status(400).json({ error: 'test_name and category are required' });
    }

    try {
        const result = labDb.deleteTest(test_name, category);
        if (!result.success) {
            return res.status(404).json({ error: result.error });
        }
        res.json({ message: 'Test deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Error deleting test', details: error.message });
    }
});

// POST /api/labs/import - Import lab tests from CSV (Admin only)
router.post('/labs/import', authenticateToken, requireAdmin, (req, res) => {
    const { tests, overwrite = false } = req.body;

    if (!tests || !Array.isArray(tests) || tests.length === 0) {
        return res.status(400).json({ error: 'tests array is required' });
    }

    try {
        const results = labDb.importFromCSV(tests, overwrite);
        res.json({
            message: 'Import completed',
            results
        });
    } catch (error) {
        res.status(500).json({ error: 'Error importing tests', details: error.message });
    }
});

// POST /api/labs/reload - Force reload the lab database (Admin only)
router.post('/labs/reload', authenticateToken, requireAdmin, (req, res) => {
    try {
        labDb.clearCache();
        const tests = labDb.loadLabDatabase();
        res.json({ message: 'Database reloaded', totalTests: tests.length });
    } catch (error) {
        res.status(500).json({ error: 'Error reloading database', details: error.message });
    }
});

// POST /api/cases/:caseId/labs - Add lab test to case (Admin only)
router.post('/cases/:caseId/labs', authenticateToken, requireAdmin, (req, res) => {
    const { caseId } = req.params;
    const { 
        test_name, 
        test_group, 
        gender_category, 
        min_value, 
        max_value, 
        current_value, 
        unit, 
        normal_samples,
        is_abnormal,
        turnaround_minutes = 30
    } = req.body;
    
    if (!test_name) {
        return res.status(400).json({ error: 'test_name is required' });
    }
    
    const sql = `
        INSERT INTO case_investigations (
            case_id, investigation_type, test_name, test_group, gender_category,
            min_value, max_value, current_value, unit, normal_samples,
            is_abnormal, turnaround_minutes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(sql, [
        caseId, 'lab', test_name, test_group, gender_category,
        min_value, max_value, current_value, unit,
        JSON.stringify(normal_samples || []),
        is_abnormal ? 1 : 0, turnaround_minutes
    ], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ 
            id: this.lastID,
            message: 'Lab test added to case'
        });
    });
});

// PUT /api/cases/:caseId/labs/:labId - Update lab values (Admin only)
router.put('/cases/:caseId/labs/:labId', authenticateToken, requireAdmin, (req, res) => {
    const { labId } = req.params;
    const { 
        current_value, 
        is_abnormal,
        min_value,
        max_value,
        turnaround_minutes
    } = req.body;
    
    // Build dynamic update query
    const updates = [];
    const params = [];
    
    if (current_value !== undefined) {
        updates.push('current_value = ?');
        params.push(current_value);
    }
    if (is_abnormal !== undefined) {
        updates.push('is_abnormal = ?');
        params.push(is_abnormal ? 1 : 0);
    }
    if (min_value !== undefined) {
        updates.push('min_value = ?');
        params.push(min_value);
    }
    if (max_value !== undefined) {
        updates.push('max_value = ?');
        params.push(max_value);
    }
    if (turnaround_minutes !== undefined) {
        updates.push('turnaround_minutes = ?');
        params.push(turnaround_minutes);
    }
    
    if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(labId);
    const sql = `UPDATE case_investigations SET ${updates.join(', ')} WHERE id = ?`;
    
    db.run(sql, params, function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Lab test not found' });
        }
        res.json({ message: 'Lab test updated' });
    });
});

// DELETE /api/cases/:caseId/labs/:labId - Remove lab from case (Admin only)
router.delete('/cases/:caseId/labs/:labId', authenticateToken, requireAdmin, (req, res) => {
    const { labId, caseId } = req.params;
    
    const sql = `DELETE FROM case_investigations WHERE id = ? AND case_id = ?`;
    
    db.run(sql, [labId, caseId], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Lab test not found' });
        }
        res.json({ message: 'Lab test removed from case' });
    });
});

// GET /api/sessions/:sessionId/available-labs - Get available labs for session's case
router.get('/sessions/:sessionId/available-labs', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    
    // Get session and case details
    const sessionSql = `SELECT s.case_id, c.config FROM sessions s JOIN cases c ON s.case_id = c.id WHERE s.id = ?`;
    
    db.get(sessionSql, [sessionId], (err, session) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        // Parse case config safely
        let caseConfig = {};
        try {
            caseConfig = JSON.parse(session.config || '{}');
        } catch (parseErr) {
            console.error('[Labs API] Invalid case config JSON:', parseErr.message);
            return res.status(500).json({ error: 'Invalid case configuration' });
        }
        const defaultLabsEnabled = caseConfig.investigations?.defaultLabsEnabled !== false;
        
        // Get configured abnormal labs for this case
        const labsSql = `
            SELECT 
                id, test_name, test_group, gender_category,
                min_value, max_value, current_value, unit,
                normal_samples, is_abnormal, turnaround_minutes
            FROM case_investigations 
            WHERE case_id = ? AND investigation_type = 'lab'
            ORDER BY test_group, test_name
        `;
        
        db.all(labsSql, [session.case_id], (err, dbConfiguredLabs) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            // ALSO get labs from config JSON (case editor saves here)
            const configJsonLabs = caseConfig.investigations?.labs || [];

            // Merge: DB labs take precedence, then config JSON labs
            const configuredMap = {};

            // First add config JSON labs (with generated IDs)
            configJsonLabs.forEach(lab => {
                if (lab.test_name) {
                    configuredMap[lab.test_name] = {
                        id: lab.id || `config_${lab.test_name.replace(/[^a-zA-Z0-9]/g, '_')}`,
                        test_name: lab.test_name,
                        test_group: lab.test_group || 'General',
                        gender_category: lab.gender_category || 'Both',
                        min_value: lab.min_value,
                        max_value: lab.max_value,
                        current_value: lab.current_value,
                        unit: lab.unit || '',
                        normal_samples: lab.normal_samples || [],
                        is_abnormal: lab.is_abnormal || false,
                        turnaround_minutes: lab.turnaround_minutes || 30,
                        source: 'config'
                    };
                }
            });

            // Then DB labs override (they have proper IDs)
            dbConfiguredLabs.forEach(lab => {
                let normalSamples = [];
                try {
                    normalSamples = JSON.parse(lab.normal_samples || '[]');
                } catch (e) {
                    console.error(`[Labs API] Invalid normal_samples JSON for ${lab.test_name}:`, e.message);
                }
                configuredMap[lab.test_name] = {
                    ...lab,
                    normal_samples: normalSamples,
                    source: 'database'
                };
            });

            if (defaultLabsEnabled) {
                // Return ALL labs from database, with configured abnormals overriding normals
                const allLabs = labDb.loadLabDatabase();
                const patientGender = caseConfig.demographics?.gender || 'Male';
                
                // Get unique test names from database
                const uniqueTests = {};
                allLabs.forEach(test => {
                    if (!uniqueTests[test.test_name]) {
                        uniqueTests[test.test_name] = [];
                    }
                    uniqueTests[test.test_name].push(test);
                });
                
                // Build response with all tests
                const responseLabs = [];
                Object.entries(uniqueTests).forEach(([testName, variations]) => {
                    // Check if this test has a configured abnormal value
                    if (configuredMap[testName]) {
                        // Use configured abnormal value
                        const configLab = configuredMap[testName];
                        // normal_samples might be array (config JSON) or string (DB)
                        const normalSamples = Array.isArray(configLab.normal_samples)
                            ? configLab.normal_samples
                            : (typeof configLab.normal_samples === 'string' ? JSON.parse(configLab.normal_samples || '[]') : []);
                        responseLabs.push({
                            ...configLab,
                            normal_samples: normalSamples,
                            source: configLab.source || 'configured'
                        });
                    } else {
                        // Use default normal value from database
                        const genderSpecific = labDb.getGenderSpecificTest(testName, patientGender);
                        if (genderSpecific) {
                            const normalValue = labDb.getRandomNormalValue(genderSpecific);
                            responseLabs.push({
                                id: `default_${testName.replace(/[^a-zA-Z0-9]/g, '_')}`,
                                test_name: genderSpecific.test_name,
                                test_group: genderSpecific.group,
                                gender_category: genderSpecific.category,
                                min_value: genderSpecific.min_value,
                                max_value: genderSpecific.max_value,
                                current_value: normalValue,
                                unit: genderSpecific.unit,
                                normal_samples: genderSpecific.normal_samples,
                                is_abnormal: false,
                                turnaround_minutes: 30,
                                source: 'default'
                            });
                        }
                    }
                });
                
                res.json({ labs: responseLabs, defaultLabsEnabled: true });
            } else {
                // Only return configured labs (from both DB and config JSON)
                const allConfiguredLabs = Object.values(configuredMap);
                res.json({ labs: allConfiguredLabs, defaultLabsEnabled: false });
            }
        });
    });
});

// POST /api/sessions/:sessionId/order-labs - Order multiple lab tests
router.post('/sessions/:sessionId/order-labs', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    const { lab_ids, turnaround_override } = req.body; // Array of lab investigation IDs + optional turnaround override

    if (!Array.isArray(lab_ids) || lab_ids.length === 0) {
        return res.status(400).json({ error: 'lab_ids array is required' });
    }

    console.log(`[Order Labs] Received request: session=${sessionId}, lab_ids=${JSON.stringify(lab_ids)}, turnaround_override=${turnaround_override}`);

    // Verify session exists and user has access
    db.get('SELECT user_id, case_id FROM sessions WHERE id = ?', [sessionId], (err, session) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        if (session.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Separate IDs by type
        const numericIds = lab_ids.filter(id => typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)));
        const defaultIds = lab_ids.filter(id => String(id).startsWith('default_'));
        const configIds = lab_ids.filter(id => String(id).startsWith('config_') || String(id).startsWith('lab_'));

        console.log(`[Order Labs] ID breakdown: numeric=${numericIds.length}, default=${defaultIds.length}, config=${configIds.length}`);

        // Track IDs that need to be inserted as orders
        const configuredIds = [...numericIds.map(id => parseInt(id, 10))];

        // Get case config to determine patient gender and find config-based labs
        db.get('SELECT config FROM cases WHERE id = ?', [session.case_id], (err, caseRow) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            const caseConfig = JSON.parse(caseRow?.config || '{}');
            const patientGender = caseConfig.demographics?.gender || 'Male';
            const configJsonLabs = caseConfig.investigations?.labs || [];

            // Get case-level timing settings
            const caseInstantResults = caseConfig.investigations?.instantResults === true;
            const caseDefaultTurnaround = caseConfig.investigations?.defaultTurnaround || 0;

            console.log(`[Order Labs] Case config: instantResults=${caseInstantResults}, defaultTurnaround=${caseDefaultTurnaround}, configLabs=${configJsonLabs.length}`);

            // Helper to get turnaround time (priority: instant/override > test default > case default)
            const getTurnaround = (testDefaultMinutes) => {
                // Instant results = 0 minutes (from case config)
                if (caseInstantResults) {
                    return 0;
                }
                // Request-level override (0 means instant, positive means that many minutes)
                if (turnaround_override !== null && turnaround_override !== undefined) {
                    if (turnaround_override === 0) {
                        return 0; // Instant results from request
                    }
                    if (turnaround_override > 0) {
                        return turnaround_override;
                    }
                }
                // Test default takes priority (individual lab turnaround times)
                if (testDefaultMinutes && testDefaultMinutes > 0) {
                    return testDefaultMinutes;
                }
                // Case-level default as fallback
                if (caseDefaultTurnaround > 0) {
                    return caseDefaultTurnaround;
                }
                // Final fallback
                return 30;
            };

            // Process all IDs and create orders
            const processOrders = () => {
                const sql = `
                    INSERT INTO investigation_orders (session_id, investigation_id, ordered_at, available_at)
                    VALUES (?, ?, datetime('now'), datetime('now', '+' || ? || ' minutes'))
                `;

                let inserted = 0;
                const orderIds = [];

                // Get configured labs
                if (configuredIds.length > 0) {
                    const labsSql = `SELECT id, turnaround_minutes, test_name FROM case_investigations WHERE id IN (${configuredIds.map(() => '?').join(',')})`;

                    db.all(labsSql, configuredIds, (err, labs) => {
                        if (err) {
                            console.error('Error fetching labs:', err);
                            return finalizeOrders();
                        }

                        // Track pending inserts
                        let pendingInserts = labs.length;
                        if (pendingInserts === 0) {
                            return finalizeOrders();
                        }

                        labs.forEach(lab => {
                            const turnaround = getTurnaround(lab.turnaround_minutes);
                            console.log(`Ordering lab: ${lab.test_name}, turnaround: ${turnaround} min (test default: ${lab.turnaround_minutes}, override: ${turnaround_override}, case default: ${caseDefaultTurnaround})`);
                            db.run(sql, [sessionId, lab.id, turnaround], function(err) {
                                if (!err) {
                                    orderIds.push({ id: this.lastID, test_name: lab.test_name, turnaround });
                                    inserted++;
                                } else {
                                    console.error('Error inserting order:', err);
                                }
                                pendingInserts--;
                                if (pendingInserts === 0) {
                                    finalizeOrders();
                                }
                            });
                        });
                    });
                } else {
                    finalizeOrders();
                }

                function finalizeOrders() {
                    console.log(`[Order Labs] Finalizing: ${inserted} orders created, IDs: ${orderIds.map(o => `${o.test_name}(${o.turnaround}m)`).join(', ')}`);

                    // Log event to event_log
                    db.run(
                        `INSERT INTO event_log (session_id, event_type, description) VALUES (?, ?, ?)`,
                        [sessionId, 'investigation_ordered', `Ordered ${inserted} lab tests`]
                    );

                    // Log detailed learning events for each ordered lab
                    const logSql = `
                        INSERT INTO learning_events (
                            session_id, user_id, case_id, verb, object_type, object_id, object_name,
                            component, result, context
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    orderIds.forEach(order => {
                        const turnaround = getTurnaround(30);
                        const context = {
                            turnaround_minutes: turnaround,
                            instant_results: caseInstantResults,
                            order_id: order.id
                        };

                        db.run(logSql, [
                            sessionId,
                            req.user.id,
                            session.case_id,
                            'ORDERED_LAB',
                            'lab_test',
                            String(order.id),
                            order.test_name,
                            'OrdersDrawer',
                            `Turnaround: ${turnaround} min`,
                            JSON.stringify(context)
                        ]);
                    });

                    res.json({
                        message: `${inserted} lab tests ordered`,
                        orders: orderIds
                    });
                }
            };

            const insertLabSql = `
                INSERT INTO case_investigations (
                    case_id, investigation_type, test_name, test_group, gender_category,
                    min_value, max_value, current_value, unit, normal_samples,
                    is_abnormal, turnaround_minutes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            let pendingOps = 0;
            let completedOps = 0;

            const checkComplete = () => {
                if (completedOps >= pendingOps) {
                    processOrders();
                }
            };

            // Process config-based labs (from case editor config JSON)
            if (configIds.length > 0) {
                configIds.forEach(configId => {
                    // Find the lab in config JSON
                    const idStr = String(configId);
                    const testNameFromId = idStr.replace('config_', '').replace('lab_', '').replace(/_/g, ' ');

                    // Try to find by ID first, then by test name
                    let configLab = configJsonLabs.find(l => l.id === configId);
                    if (!configLab) {
                        configLab = configJsonLabs.find(l =>
                            l.test_name && l.test_name.toLowerCase().replace(/[^a-z0-9]/g, ' ').includes(testNameFromId.toLowerCase())
                        );
                    }

                    if (configLab) {
                        pendingOps++;
                        db.run(insertLabSql, [
                            session.case_id, 'lab',
                            configLab.test_name,
                            configLab.test_group || 'General',
                            configLab.gender_category || 'Both',
                            configLab.min_value,
                            configLab.max_value,
                            configLab.current_value,
                            configLab.unit || '',
                            JSON.stringify(configLab.normal_samples || []),
                            configLab.is_abnormal ? 1 : 0,
                            getTurnaround(configLab.turnaround_minutes)
                        ], function(err) {
                            completedOps++;
                            if (!err) {
                                configuredIds.push(this.lastID);
                            } else {
                                console.error('Error creating config lab:', err);
                            }
                            checkComplete();
                        });
                    }
                });
            }

            // Process default labs (from lab database with normal values)
            if (defaultIds.length > 0) {
                console.log(`[Order Labs] Processing ${defaultIds.length} default lab IDs`);
                const testNames = defaultIds.map(id => String(id).replace('default_', '').replace(/_/g, ' '));

                testNames.forEach((testName, idx) => {
                    const genderSpecific = labDb.getGenderSpecificTest(testName, patientGender);
                    if (genderSpecific) {
                        pendingOps++;
                        const normalValue = labDb.getRandomNormalValue(genderSpecific);
                        console.log(`[Order Labs] Found default lab: "${testName}" -> "${genderSpecific.test_name}"`);

                        db.run(insertLabSql, [
                            session.case_id, 'lab',
                            genderSpecific.test_name,
                            genderSpecific.group,
                            genderSpecific.category,
                            genderSpecific.min_value,
                            genderSpecific.max_value,
                            normalValue,
                            genderSpecific.unit,
                            JSON.stringify(genderSpecific.normal_samples),
                            0,
                            getTurnaround(30)
                        ], function(err) {
                            completedOps++;
                            if (!err) {
                                configuredIds.push(this.lastID);
                            } else {
                                console.error('Error creating default lab:', err);
                            }
                            checkComplete();
                        });
                    } else {
                        console.warn(`[Order Labs] WARNING: Test not found in lab database: "${testName}" (from ID: ${defaultIds[idx]})`);
                    }
                });
            }

            // If no async ops needed, process immediately
            if (pendingOps === 0) {
                processOrders();
            }
        });
    });
});

// GET /api/sessions/:sessionId/lab-results - Get completed lab results
router.get('/sessions/:sessionId/lab-results', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    
    const sql = `
        SELECT 
            io.id as order_id,
            io.ordered_at,
            io.available_at,
            io.viewed_at,
            ci.id as lab_id,
            ci.test_name,
            ci.test_group,
            ci.unit,
            ci.current_value,
            ci.min_value,
            ci.max_value,
            ci.is_abnormal,
            ci.gender_category
        FROM investigation_orders io
        JOIN case_investigations ci ON io.investigation_id = ci.id
        WHERE io.session_id = ? AND ci.investigation_type = 'lab'
        AND datetime(io.available_at) <= datetime('now')
        ORDER BY io.available_at DESC
    `;
    
    db.all(sql, [sessionId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        // Evaluate each result
        const processedResults = results.map(result => ({
            ...result,
            status: labDb.evaluateValue(result.current_value, result.min_value, result.max_value),
            flag: labDb.getValueFlag(labDb.evaluateValue(result.current_value, result.min_value, result.max_value)),
            is_ready: true
        }));
        
        res.json({ results: processedResults });
    });
});

// PUT /api/sessions/:sessionId/labs/:labId - Instructor edit lab value during simulation (Admin only)
router.put('/sessions/:sessionId/labs/:labId', authenticateToken, requireAdmin, (req, res) => {
    const { sessionId, labId } = req.params;
    const { current_value } = req.body;
    
    if (current_value === undefined) {
        return res.status(400).json({ error: 'current_value is required' });
    }
    
    // Update the lab value in case_investigations
    const sql = `UPDATE case_investigations SET current_value = ?, is_abnormal = 1 WHERE id = ?`;
    
    db.run(sql, [current_value, labId], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Lab test not found' });
        }
        
        // Log the instructor edit
        db.run(
            `INSERT INTO event_log (session_id, event_type, description) VALUES (?, ?, ?)`,
            [sessionId, 'lab_value_edited', `Instructor edited lab value for test ID ${labId} to ${current_value}`],
            (err) => {
                if (err) console.error('[Event Log] Failed to log lab edit:', err.message);
            }
        );

        res.json({
            message: 'Lab value updated',
            new_value: current_value
        });
    });
});

// --- RADIOLOGY ORDERING ENDPOINTS ---

// GET /api/radiology-database - Get master radiology database for case designer
router.get('/radiology-database', authenticateToken, (req, res) => {
    const { search, modality } = req.query;

    let filtered = radiologyDatabase;

    // Filter by search term
    if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(study =>
            study.name.toLowerCase().includes(searchLower) ||
            study.modality.toLowerCase().includes(searchLower) ||
            study.body_region.toLowerCase().includes(searchLower) ||
            (study.common_indications && study.common_indications.some(ind =>
                ind.toLowerCase().includes(searchLower)
            ))
        );
    }

    // Filter by modality
    if (modality && modality !== 'all') {
        filtered = filtered.filter(study => study.modality === modality);
    }

    // Get unique modalities for filter dropdown
    const modalities = [...new Set(radiologyDatabase.map(s => s.modality))].sort();

    res.json({
        studies: filtered,
        modalities,
        total: filtered.length,
        totalAvailable: radiologyDatabase.length
    });
});

// GET /api/sessions/:sessionId/available-radiology - Get available radiology studies
router.get('/sessions/:sessionId/available-radiology', authenticateToken, (req, res) => {
    const { sessionId } = req.params;

    // Get case config to include custom studies
    db.get(
        'SELECT c.config FROM sessions s JOIN cases c ON s.case_id = c.id WHERE s.id = ?',
        [sessionId],
        (err, row) => {
            if (err) {
                console.error('Error fetching case config:', err);
                return res.json({
                    studies: radiologyDatabase,
                    groups: [...new Set(radiologyDatabase.map(s => s.modality))].sort(),
                    total: radiologyDatabase.length
                });
            }

            let allStudies = [...radiologyDatabase];

            // Parse case config and add custom studies
            if (row?.config) {
                try {
                    const config = JSON.parse(row.config);
                    const configuredRadiology = config.radiology || config.clinicalRecords?.radiology || [];

                    // Add custom studies that aren't in the master database
                    configuredRadiology.forEach(cr => {
                        if (cr.isCustom && cr.studyId) {
                            allStudies.push({
                                id: cr.studyId,
                                name: cr.studyName || 'Custom Study',
                                modality: cr.modality || 'Other',
                                body_region: cr.bodyRegion || '',
                                turnaround_minutes: cr.turnaroundMinutes || 30,
                                common_indications: [],
                                isCustom: true
                            });
                        }
                    });
                } catch (e) {
                    console.warn('Failed to parse case config:', e.message);
                }
            }

            // Group by modality for easier display
            const groups = [...new Set(allStudies.map(s => s.modality))].sort();

            res.json({
                studies: allStudies,
                groups: groups,
                total: allStudies.length
            });
        }
    );
});

// GET /api/sessions/:sessionId/radiology-orders - Get radiology orders for session
router.get('/sessions/:sessionId/radiology-orders', authenticateToken, (req, res) => {
    const { sessionId } = req.params;

    const sql = `
        SELECT
            io.id,
            io.investigation_id as study_id,
            io.ordered_at,
            io.available_at,
            io.viewed_at,
            ci.test_name,
            ci.test_group as modality,
            ci.image_url,
            ci.result_data,
            ci.turnaround_minutes,
            CASE
                WHEN datetime(io.available_at) <= datetime('now') THEN 1
                ELSE 0
            END as is_ready,
            CASE
                WHEN datetime(io.available_at) > datetime('now')
                THEN ROUND((julianday(io.available_at) - julianday('now')) * 24 * 60, 1)
                ELSE 0
            END as minutes_remaining
        FROM investigation_orders io
        JOIN case_investigations ci ON io.investigation_id = ci.id
        WHERE io.session_id = ? AND ci.investigation_type = 'radiology'
        ORDER BY io.ordered_at DESC
    `;

    db.all(sql, [sessionId], (err, orders) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ orders: orders || [] });
    });
});

// POST /api/sessions/:sessionId/order-radiology - Order radiology studies
router.post('/sessions/:sessionId/order-radiology', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    const { radiology_ids, instant } = req.body;

    if (!Array.isArray(radiology_ids) || radiology_ids.length === 0) {
        return res.status(400).json({ error: 'radiology_ids array is required' });
    }

    // Verify session exists and get case config
    db.get('SELECT s.user_id, s.case_id, c.config FROM sessions s JOIN cases c ON s.case_id = c.id WHERE s.id = ?', [sessionId], (err, session) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Parse case config to get configured radiology studies
        let caseConfig = {};
        try {
            caseConfig = JSON.parse(session.config || '{}');
        } catch (e) {
            console.warn('Failed to parse case config:', e.message);
        }
        // Check both new location (config.radiology) and old location (clinicalRecords.radiology)
        const configuredRadiology = caseConfig.radiology || caseConfig.clinicalRecords?.radiology || [];

        let inserted = 0;
        let pending = radiology_ids.length;
        const orderIds = [];

        if (pending === 0) {
            return res.json({ message: '0 radiology studies ordered', orders: [] });
        }

        radiology_ids.forEach(radId => {
            // Check if this is a custom study (ID starts with "custom_")
            const isCustomStudy = typeof radId === 'string' && radId.startsWith('custom_');

            // Find study in radiology database by ID (for non-custom studies)
            const study = isCustomStudy ? null : radiologyDatabase.find(s => s.id === radId);

            // Check if this study has configured results in the case config
            const configuredResult = configuredRadiology.find(cr =>
                cr.studyId === radId ||
                (study && cr.studyName?.toLowerCase() === study.name?.toLowerCase()) ||
                (study && cr.type?.toLowerCase() === study.name?.toLowerCase())
            );

            // For custom studies, we MUST have a configured result
            if (!study && !configuredResult) {
                console.warn(`Radiology study not found and no config: ${radId}`);
                pending--;
                if (pending === 0) {
                    res.json({ message: `${inserted} radiology studies ordered`, orders: orderIds });
                }
                return;
            }

            // Get study details from master database or configured result
            const testName = study?.name || configuredResult?.studyName || 'Unknown Study';
            const modality = study?.modality || configuredResult?.modality || 'Other';
            const bodyRegion = study?.body_region || configuredResult?.bodyRegion || '';
            const defaultTurnaround = study?.turnaround_minutes || 30;

            // Use configured turnaround time if available
            const configuredTurnaround = configuredResult?.turnaroundMinutes;
            const turnaround = instant ? 0 : (configuredTurnaround ?? defaultTurnaround);

            // Use configured findings/interpretation if available, otherwise use normal defaults from master database
            const findings = configuredResult?.findings || study?.normal_findings || '';
            const interpretation = configuredResult?.interpretation || study?.normal_interpretation || '';
            const imageUrl = configuredResult?.imageUrl || null;

            // Build result data including configured findings
            const resultData = {
                indications: study?.common_indications || [],
                body_region: bodyRegion,
                findings: findings,
                interpretation: interpretation,
                hasConfiguredResult: !!configuredResult,
                isCustomStudy: isCustomStudy,
                isNormalDefault: !configuredResult?.findings && !configuredResult?.interpretation && !!study?.normal_findings
            };

            // First insert into case_investigations
            const insertStudySql = `
                INSERT INTO case_investigations (
                    case_id, investigation_type, test_name, test_group,
                    image_url, result_data, turnaround_minutes
                ) VALUES (?, 'radiology', ?, ?, ?, ?, ?)
            `;

            db.run(insertStudySql, [
                session.case_id,
                testName,
                modality,
                imageUrl,
                JSON.stringify(resultData),
                turnaround
            ], function(err) {
                if (err) {
                    console.error('Error inserting radiology study:', err);
                    pending--;
                    if (pending === 0) {
                        res.json({ message: `${inserted} radiology studies ordered`, orders: orderIds });
                    }
                    return;
                }

                const investigationId = this.lastID;

                // Now create the order
                const orderSql = `
                    INSERT INTO investigation_orders (session_id, investigation_id, available_at)
                    VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))
                `;

                db.run(orderSql, [sessionId, investigationId, turnaround], function(orderErr) {
                    pending--;
                    if (!orderErr) {
                        inserted++;
                        orderIds.push(this.lastID);
                    }
                    if (pending === 0) {
                        res.json({ message: `${inserted} radiology studies ordered`, orders: orderIds });
                    }
                });
            });
        });
    });
});

// --- LLM PROXY ROUTE with Authentication & Rate Limiting ---
router.post('/proxy/llm', authenticateToken, async (req, res) => {
    const { messages, system_prompt, session_id, agent_llm_config } = req.body;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    const startTime = Date.now();

    try {
        // 1. Check if LLM is enabled
        const llmEnabled = await new Promise((resolve, reject) => {
            db.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', ['llm_enabled'], (err, row) => {
                if (err) reject(err);
                else resolve(row?.setting_value !== 'false');
            });
        });

        if (!llmEnabled) {
            return res.status(503).json({ error: 'LLM service is currently disabled by administrator' });
        }

        // 2. Get user's current usage
        const userUsage = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM llm_usage WHERE user_id = ? AND date = ?', [userId, today], (err, row) => {
                if (err) reject(err);
                else resolve(row || { total_tokens: 0, estimated_cost: 0, request_count: 0 });
            });
        });

        // 3. Get platform usage
        const platformUsage = await new Promise((resolve, reject) => {
            db.get('SELECT SUM(total_tokens) as total_tokens, SUM(estimated_cost) as total_cost FROM llm_usage WHERE date = ?', [today], (err, row) => {
                if (err) reject(err);
                else resolve(row || { total_tokens: 0, total_cost: 0 });
            });
        });

        // 4. Get rate limits
        const getLimitSetting = (key, defaultVal) => new Promise((resolve, reject) => {
            db.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key], (err, row) => {
                if (err) reject(err);
                else resolve(row?.setting_value ? parseFloat(row.setting_value) : defaultVal);
            });
        });

        const tokensPerUserDaily = await getLimitSetting('rate_limit_tokens_per_user_daily', 0);
        const costPerUserDaily = await getLimitSetting('rate_limit_cost_per_user_daily', 0);
        const tokensPlatformDaily = await getLimitSetting('rate_limit_tokens_platform_daily', 0);
        const costPlatformDaily = await getLimitSetting('rate_limit_cost_platform_daily', 0);

        // Helper to log rate limit events (fire and forget with error handling)
        const logRateLimit = (msg) => {
            db.run('INSERT INTO llm_request_log (user_id, session_id, status, error_message) VALUES (?, ?, ?, ?)',
                [userId, session_id, 'rate_limited', msg],
                (err) => { if (err) console.error('[LLM Rate Limit] Log failed:', err.message); }
            );
        };

        // 5. Check user rate limits (0 = unlimited/disabled)
        if (tokensPerUserDaily > 0 && userUsage.total_tokens >= tokensPerUserDaily) {
            logRateLimit('User daily token limit exceeded');
            return res.status(429).json({
                error: 'Daily token limit exceeded',
                tokensUsed: userUsage.total_tokens,
                tokensLimit: tokensPerUserDaily,
                resetsAt: 'midnight UTC'
            });
        }

        if (costPerUserDaily > 0 && userUsage.estimated_cost >= costPerUserDaily) {
            logRateLimit('User daily cost limit exceeded');
            return res.status(429).json({
                error: 'Daily cost limit exceeded',
                costUsed: userUsage.estimated_cost,
                costLimit: costPerUserDaily,
                resetsAt: 'midnight UTC'
            });
        }

        // 6. Check platform rate limits (0 = unlimited/disabled)
        if (tokensPlatformDaily > 0 && (platformUsage.total_tokens || 0) >= tokensPlatformDaily) {
            logRateLimit('Platform daily token limit exceeded');
            return res.status(429).json({
                error: 'Platform daily token limit exceeded. Please try again tomorrow.',
                resetsAt: 'midnight UTC'
            });
        }

        if (costPlatformDaily > 0 && (platformUsage.total_cost || 0) >= costPlatformDaily) {
            logRateLimit('Platform daily cost limit exceeded');
            return res.status(429).json({
                error: 'Platform daily cost limit exceeded. Please try again tomorrow.',
                resetsAt: 'midnight UTC'
            });
        }

        // 7. Get LLM settings from platform settings (these are the defaults)
        const getPlatformLLMSetting = (key, defaultVal) => new Promise((resolve, reject) => {
            db.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key], (err, row) => {
                if (err) reject(err);
                else resolve(row?.setting_value || defaultVal);
            });
        });

        // Get all platform settings first (these are always the base)
        const platformProvider = await getPlatformLLMSetting('llm_provider', 'lmstudio');
        const platformModel = await getPlatformLLMSetting('llm_model', '');
        const platformBaseUrl = await getPlatformLLMSetting('llm_base_url', 'http://localhost:1234/v1');
        const platformApiKey = await getPlatformLLMSetting('llm_api_key', '');
        const platformMaxTokens = await getPlatformLLMSetting('llm_max_output_tokens', '');
        const platformTemperature = await getPlatformLLMSetting('llm_temperature', '');
        const systemPromptTemplate = await getPlatformLLMSetting('llm_system_prompt_template', '');

        // Check if session has user-specific LLM settings (optional overrides)
        let sessionLlmSettings = null;
        if (session_id) {
            sessionLlmSettings = await new Promise((resolve, reject) => {
                db.get('SELECT llm_settings FROM sessions WHERE id = ?', [session_id], (err, row) => {
                    if (err) reject(err);
                    else {
                        try {
                            const parsed = row?.llm_settings ? JSON.parse(row.llm_settings) : null;
                            // Only use if it has actual settings (not empty object)
                            if (parsed && Object.keys(parsed).length > 0) {
                                resolve(parsed);
                            } else {
                                resolve(null);
                            }
                        } catch {
                            resolve(null);
                        }
                    }
                });
            });
        }

        // Merge: agent_llm_config > session settings > platform settings
        // Agent-specific LLM config has highest priority
        let agentProvider = null;
        let agentModel = null;
        let agentApiKey = null;
        let agentEndpoint = null;

        if (agent_llm_config && agent_llm_config.provider) {
            // Agent has override settings
            agentProvider = agent_llm_config.provider;
            agentModel = agent_llm_config.model;
            agentApiKey = agent_llm_config.api_key;
            agentEndpoint = agent_llm_config.endpoint;
            console.log(`[LLM Proxy] Using agent-specific LLM config: provider=${agentProvider}, model=${agentModel || '(default)'}`);
        } else if (agent_llm_config?.agent_template_id) {
            // Try to fetch agent template LLM config from DB
            const agentTemplate = await new Promise((resolve, reject) => {
                db.get('SELECT llm_provider, llm_model, llm_api_key, llm_endpoint FROM agent_templates WHERE id = ?',
                    [agent_llm_config.agent_template_id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            if (agentTemplate && agentTemplate.llm_provider) {
                agentProvider = agentTemplate.llm_provider;
                agentModel = agentTemplate.llm_model;
                agentApiKey = agentTemplate.llm_api_key;
                agentEndpoint = agentTemplate.llm_endpoint;
                console.log(`[LLM Proxy] Using agent template ${agent_llm_config.agent_template_id} LLM config: provider=${agentProvider}`);
            }
        }

        // Priority: agent > session > platform
        const provider = agentProvider || (sessionLlmSettings?.provider && sessionLlmSettings.provider.trim()) || platformProvider;
        const model = agentModel || (sessionLlmSettings?.model && sessionLlmSettings.model.trim()) || platformModel;

        // For API key and base URL, also consider agent settings
        let baseUrl = platformBaseUrl;
        let apiKey = platformApiKey;

        // Handle provider-specific defaults for base URL
        if (agentProvider) {
            // Agent provider override
            if (agentProvider === 'openai') {
                baseUrl = 'https://api.openai.com/v1';
            } else if (agentProvider === 'anthropic') {
                baseUrl = 'https://api.anthropic.com/v1';
            } else if (agentProvider === 'openrouter') {
                baseUrl = 'https://openrouter.ai/api/v1';
            } else if (agentProvider === 'custom' && agentEndpoint) {
                baseUrl = agentEndpoint;
            }
            apiKey = agentApiKey || platformApiKey;
        } else if (sessionLlmSettings?.baseUrl && sessionLlmSettings.baseUrl.trim()) {
            baseUrl = sessionLlmSettings.baseUrl.trim();
            apiKey = (sessionLlmSettings?.apiKey && sessionLlmSettings.apiKey.trim()) || platformApiKey;
        } else {
            apiKey = (sessionLlmSettings?.apiKey && sessionLlmSettings.apiKey.trim()) || platformApiKey;
        }

        const maxOutputTokensRaw = sessionLlmSettings?.maxOutputTokens || platformMaxTokens;
        const temperatureRaw = sessionLlmSettings?.temperature || platformTemperature;
        const maxOutputTokens = maxOutputTokensRaw ? parseInt(maxOutputTokensRaw) : null;
        const temperature = temperatureRaw ? parseFloat(temperatureRaw) : null;

        // Debug logging
        console.log(`[LLM Proxy] Final settings: provider=${provider}, model=${model || '(default)'}, baseUrl=${baseUrl}`);
        if (sessionLlmSettings && Object.keys(sessionLlmSettings).length > 0) {
            console.log(`[LLM Proxy] Using session overrides for session ${session_id}:`, Object.keys(sessionLlmSettings).filter(k => sessionLlmSettings[k]));
        }

        // 8. Build system prompt
        let fullSystemPrompt = '';
        if (systemPromptTemplate) {
            fullSystemPrompt = systemPromptTemplate;
        }
        if (system_prompt) {
            fullSystemPrompt += (fullSystemPrompt ? '\n\n---\n\n' : '') + system_prompt;
        }

        // 9. Build request based on provider type
        let llmHeaders = { 'Content-Type': 'application/json' };
        let requestPayload = {};
        let endpoint = '';

        if (provider === 'anthropic') {
            // Anthropic Claude API format
            llmHeaders['x-api-key'] = apiKey;
            llmHeaders['anthropic-version'] = '2023-06-01';

            // Filter out system messages for Anthropic (uses separate system field)
            const anthropicMessages = (messages || []).filter(m => m.role !== 'system').map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content
            }));

            requestPayload = {
                model: model || 'claude-3-5-sonnet-20241022',
                max_tokens: maxOutputTokens || 1024,
                messages: anthropicMessages
            };
            if (fullSystemPrompt) {
                requestPayload.system = fullSystemPrompt;
            }
            if (temperature !== null) {
                requestPayload.temperature = temperature;
            }
            endpoint = `${baseUrl}/messages`;
        } else {
            // OpenAI-compatible API format (OpenAI, LM Studio, Ollama, OpenRouter, Groq, Together, etc.)
            if (apiKey) {
                llmHeaders['Authorization'] = `Bearer ${apiKey}`;
            }

            const conversation = [];
            if (fullSystemPrompt) {
                conversation.push({ role: 'system', content: fullSystemPrompt });
            }
            if (messages && Array.isArray(messages)) {
                conversation.push(...messages);
            }

            requestPayload = {
                messages: conversation,
                stream: false
            };
            if (temperature !== null) {
                requestPayload.temperature = temperature;
            }
            if (maxOutputTokens) {
                if (provider === 'openai') {
                    requestPayload.max_completion_tokens = maxOutputTokens;
                } else {
                    requestPayload.max_tokens = maxOutputTokens;
                }
            }
            if (model && model.trim() !== '') {
                requestPayload.model = model;
            }
            endpoint = `${baseUrl}/chat/completions`;
        }

        // 10. Make LLM request
        console.log(`[LLM Proxy] User ${userId} sending request to ${provider}${model ? '/' + model : ' (default model)'} at ${endpoint}`);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: llmHeaders,
            body: JSON.stringify(requestPayload)
        });

        const responseTime = Date.now() - startTime;

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[LLM Proxy] Error ${response.status}: ${errText}`);
            db.run('INSERT INTO llm_request_log (user_id, session_id, model, status, error_message, response_time_ms) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, session_id, model, 'error', errText.substring(0, 500), responseTime]);
            return res.status(response.status).json({ error: errText });
        }

        const rawData = await response.json();

        // 11. Normalize response format (Anthropic vs OpenAI)
        let data;
        let promptTokens, completionTokens, totalTokens;

        if (provider === 'anthropic') {
            // Anthropic response format -> OpenAI format
            const content = rawData.content?.[0]?.text || '';
            promptTokens = rawData.usage?.input_tokens || 0;
            completionTokens = rawData.usage?.output_tokens || 0;
            totalTokens = promptTokens + completionTokens;

            data = {
                choices: [{
                    message: { role: 'assistant', content },
                    finish_reason: rawData.stop_reason || 'stop'
                }],
                usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens }
            };
        } else {
            // OpenAI-compatible format
            data = rawData;
            promptTokens = data.usage?.prompt_tokens || 0;
            completionTokens = data.usage?.completion_tokens || 0;
            totalTokens = data.usage?.total_tokens || promptTokens + completionTokens;
        }

        // 12. Calculate estimated cost
        const pricing = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM llm_model_pricing WHERE provider = ? AND (model = ? OR model = ?)',
                [provider, model, 'default'], (err, row) => {
                if (err) reject(err);
                else resolve(row || { input_cost_per_1k: 0, output_cost_per_1k: 0 });
            });
        });

        const estimatedCost = (promptTokens / 1000) * pricing.input_cost_per_1k +
                             (completionTokens / 1000) * pricing.output_cost_per_1k;

        // 13. Update user's daily usage (upsert)
        db.run(`
            INSERT INTO llm_usage (user_id, date, prompt_tokens, completion_tokens, total_tokens, estimated_cost, model, request_count, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, date) DO UPDATE SET
            prompt_tokens = llm_usage.prompt_tokens + excluded.prompt_tokens,
            completion_tokens = llm_usage.completion_tokens + excluded.completion_tokens,
            total_tokens = llm_usage.total_tokens + excluded.total_tokens,
            estimated_cost = llm_usage.estimated_cost + excluded.estimated_cost,
            request_count = llm_usage.request_count + 1,
            updated_at = CURRENT_TIMESTAMP
        `, [userId, today, promptTokens, completionTokens, totalTokens, estimatedCost, model]);

        // 14. Log the request
        db.run(`INSERT INTO llm_request_log (user_id, session_id, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost, status, response_time_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, session_id, model, promptTokens, completionTokens, totalTokens, estimatedCost, 'success', responseTime]);

        console.log(`[LLM Proxy] User ${userId}: ${totalTokens} tokens, $${estimatedCost.toFixed(4)}, ${responseTime}ms`);

        // 15. Return response
        res.json(data);
    } catch (err) {
        console.error('[LLM Proxy] Failure:', err);
        res.status(500).json({ error: "LLM Request Failed", details: err.message });
    }
});

// ========================================
// SCENARIO REPOSITORY ROUTES
// ========================================

// Get all scenarios (public + user's private ones)
router.get('/scenarios', authenticateToken, (req, res) => {
    const userId = req.user?.id;
    
    const query = `
        SELECT s.*, u.username as created_by_username 
        FROM scenarios s
        LEFT JOIN users u ON s.created_by = u.id
        WHERE s.is_public = 1 OR s.created_by = ?
        ORDER BY s.created_at DESC
    `;
    
    db.all(query, [userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        // Parse JSON timeline
        const scenarios = rows.map(row => ({
            ...row,
            timeline: JSON.parse(row.timeline || '[]')
        }));
        
        res.json({ scenarios });
    });
});

// Get single scenario
router.get('/scenarios/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT * FROM scenarios WHERE id = ?', [id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        
        res.json({
            ...row,
            timeline: JSON.parse(row.timeline || '[]')
        });
    });
});

// Create scenario
router.post('/scenarios', authenticateToken, (req, res) => {
    const { name, description, duration_minutes, category, timeline, is_public } = req.body;
    const created_by = req.user.id;
    
    if (!name || !timeline || !duration_minutes) {
        return res.status(400).json({ error: 'Name, timeline, and duration are required' });
    }
    
    const query = `
        INSERT INTO scenarios (name, description, duration_minutes, category, timeline, created_by, is_public)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(
        query,
        [name, description, duration_minutes, category, JSON.stringify(timeline), created_by, is_public ? 1 : 0],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            res.json({ 
                id: this.lastID,
                message: 'Scenario created successfully' 
            });
        }
    );
});

// Update scenario
router.put('/scenarios/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { name, description, duration_minutes, category, timeline, is_public } = req.body;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    
    // Check ownership or admin
    db.get('SELECT created_by FROM scenarios WHERE id = ?', [id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        if (row.created_by !== userId && !isAdmin) {
            return res.status(403).json({ error: 'Not authorized to edit this scenario' });
        }
        
        const query = `
            UPDATE scenarios 
            SET name = ?, description = ?, duration_minutes = ?, category = ?, timeline = ?, is_public = ?
            WHERE id = ?
        `;
        
        db.run(
            query,
            [name, description, duration_minutes, category, JSON.stringify(timeline), is_public ? 1 : 0, id],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.json({ message: 'Scenario updated successfully' });
            }
        );
    });
});

// Delete scenario
router.delete('/scenarios/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    
    // Check ownership or admin
    db.get('SELECT created_by FROM scenarios WHERE id = ?', [id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        if (row.created_by !== userId && !isAdmin) {
            return res.status(403).json({ error: 'Not authorized to delete this scenario' });
        }
        
        db.run('DELETE FROM scenarios WHERE id = ?', [id], (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: 'Scenario deleted successfully' });
        });
    });
});

// Seed default scenarios (admin only)
router.post('/scenarios/seed', requireAdmin, (req, res) => {
    const defaultScenarios = [
        {
            name: "STEMI Progression",
            description: "Acute MI progressing to cardiogenic shock - late stage",
            duration_minutes: 40,
            category: "Cardiac",
            timeline: [
                { time: 0, label: "Initial presentation", params: { hr: 80, spo2: 98, rr: 16, bpSys: 125, bpDia: 82, temp: 37.0, etco2: 38 }, conditions: { stElev: 0 }, rhythm: "NSR" },
                { time: 600, label: "STEMI develops", params: { hr: 110, spo2: 96, rr: 22, bpSys: 145, bpDia: 95, temp: 37.0, etco2: 40 }, conditions: { stElev: 2.0 } },
                { time: 1500, label: "Worsening ischemia", params: { hr: 125, spo2: 92, rr: 26, bpSys: 100, bpDia: 60, temp: 37.0, etco2: 42 }, conditions: { stElev: 2.5, pvc: true } },
                { time: 2400, label: "Late stage", params: { hr: 135, spo2: 85, rr: 28, bpSys: 70, bpDia: 45, temp: 37.0, etco2: 44 }, conditions: { stElev: 2.5, pvc: true, noise: 2 } }
            ]
        },
        {
            name: "Septic Shock Progression",
            description: "Vasodilation leading to severe hypotension - late stage",
            duration_minutes: 40,
            category: "Sepsis",
            timeline: [
                { time: 0, label: "Early sepsis", params: { hr: 95, spo2: 94, rr: 20, bpSys: 110, bpDia: 70, temp: 38.5, etco2: 35 }, conditions: { stElev: 0 }, rhythm: "NSR" },
                { time: 900, label: "Progressive shock", params: { hr: 115, spo2: 90, rr: 26, bpSys: 90, bpDia: 50, temp: 39.5, etco2: 32 }, conditions: { noise: 1 } },
                { time: 1800, label: "Severe shock", params: { hr: 135, spo2: 85, rr: 32, bpSys: 70, bpDia: 35, temp: 39.5, etco2: 28 }, conditions: { noise: 2 } },
                { time: 2400, label: "Late stage", params: { hr: 145, spo2: 80, rr: 36, bpSys: 60, bpDia: 25, temp: 39.8, etco2: 26 }, conditions: { noise: 3 } }
            ]
        },
        {
            name: "Respiratory Failure",
            description: "Gradual onset of hypoxia and hypercapnia - late stage",
            duration_minutes: 30,
            category: "Respiratory",
            timeline: [
                { time: 0, label: "Early distress", params: { hr: 90, spo2: 93, rr: 24, bpSys: 125, bpDia: 80, temp: 37.0, etco2: 42 }, rhythm: "NSR" },
                { time: 600, label: "Worsening hypoxia", params: { hr: 100, spo2: 88, rr: 32, bpSys: 130, bpDia: 85, temp: 37.0, etco2: 48 }, conditions: { noise: 1 } },
                { time: 1200, label: "Severe hypoxia", params: { hr: 115, spo2: 82, rr: 36, bpSys: 140, bpDia: 90, temp: 37.5, etco2: 54 }, conditions: { noise: 2 } },
                { time: 1800, label: "Late stage", params: { hr: 125, spo2: 78, rr: 38, bpSys: 145, bpDia: 92, temp: 37.5, etco2: 60 }, conditions: { noise: 3 } }
            ]
        },
        {
            name: "Hypertensive Crisis",
            description: "Rapid increase in blood pressure - late stage",
            duration_minutes: 45,
            category: "Cardiovascular",
            timeline: [
                { time: 0, label: "Baseline", params: { hr: 75, spo2: 99, rr: 14, bpSys: 130, bpDia: 85, temp: 37.0, etco2: 38 }, rhythm: "NSR" },
                { time: 900, label: "BP rising", params: { hr: 90, spo2: 98, rr: 18, bpSys: 180, bpDia: 110, temp: 37.0, etco2: 40 } },
                { time: 1800, label: "Crisis peak", params: { hr: 105, spo2: 96, rr: 22, bpSys: 220, bpDia: 130, temp: 37.0, etco2: 42 }, conditions: { stElev: -1.0 } },
                { time: 2700, label: "Late stage", params: { hr: 115, spo2: 94, rr: 24, bpSys: 240, bpDia: 150, temp: 37.0, etco2: 45 } }
            ]
        },
        {
            name: "Anaphylactic Shock",
            description: "Rapid onset of severe allergic reaction - late stage",
            duration_minutes: 10,
            category: "Allergic",
            timeline: [
                { time: 0, label: "Initial exposure", params: { hr: 85, spo2: 98, rr: 16, bpSys: 120, bpDia: 80, temp: 37.0, etco2: 38 }, rhythm: "NSR" },
                { time: 120, label: "Rapid onset", params: { hr: 115, spo2: 92, rr: 28, bpSys: 100, bpDia: 65, temp: 37.0, etco2: 42 }, conditions: { noise: 2 } },
                { time: 300, label: "Severe reaction", params: { hr: 135, spo2: 85, rr: 35, bpSys: 75, bpDia: 45, temp: 37.0, etco2: 48 }, conditions: { noise: 3 } },
                { time: 600, label: "Late stage", params: { hr: 150, spo2: 80, rr: 36, bpSys: 60, bpDia: 35, temp: 36.5, etco2: 50 }, conditions: { pvc: true, noise: 3 } }
            ]
        },
        {
            name: "Post-Resuscitation Recovery",
            description: "Patient recovering after successful resuscitation",
            duration_minutes: 30,
            category: "Recovery",
            timeline: [
                { time: 0, label: "Post-ROSC", params: { hr: 130, spo2: 85, rr: 30, bpSys: 80, bpDia: 50, temp: 35.0, etco2: 30 }, conditions: { noise: 1 }, rhythm: "NSR" },
                { time: 900, label: "Stabilizing", params: { hr: 110, spo2: 92, rr: 20, bpSys: 100, bpDia: 60, temp: 36.0, etco2: 35 }, conditions: { noise: 0 } },
                { time: 1800, label: "Improving", params: { hr: 90, spo2: 96, rr: 16, bpSys: 120, bpDia: 75, temp: 37.0, etco2: 38 } }
            ]
        }
    ];
    
    let inserted = 0;
    let errors = 0;
    
    defaultScenarios.forEach(scenario => {
        const query = `
            INSERT INTO scenarios (name, description, duration_minutes, category, timeline, created_by, is_public)
            VALUES (?, ?, ?, ?, ?, NULL, 1)
        `;
        
        db.run(
            query,
            [scenario.name, scenario.description, scenario.duration_minutes, scenario.category, JSON.stringify(scenario.timeline)],
            (err) => {
                if (err) {
                    console.error(`Error seeding scenario ${scenario.name}:`, err.message);
                    errors++;
                } else {
                    inserted++;
                }
                
                // After all scenarios processed
                if (inserted + errors === defaultScenarios.length) {
                    res.json({ 
                        message: `Seeded ${inserted} scenarios, ${errors} errors`,
                        inserted,
                        errors
                    });
                }
            }
        );
    });
});

// ============================================
// NEW ROUTES - Physical Exam, Audit, Preferences
// ============================================

// --- PHYSICAL EXAM FINDINGS ---

// POST /api/sessions/:sessionId/exam-findings - Record a physical exam finding
router.post('/sessions/:sessionId/exam-findings', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    const { body_region, exam_type, finding, is_abnormal, audio_url, audio_played, case_id } = req.body;

    if (!body_region || !exam_type || !finding) {
        return res.status(400).json({ error: 'body_region, exam_type, and finding are required' });
    }

    const sql = `INSERT INTO physical_exam_findings
                 (session_id, case_id, user_id, body_region, exam_type, finding, is_abnormal, audio_url, audio_played)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(sql, [
        sessionId,
        case_id || null,
        req.user.id,
        body_region,
        exam_type,
        finding,
        is_abnormal ? 1 : 0,
        audio_url || null,
        audio_played ? 1 : 0
    ], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        // Update session exam count
        db.run(`UPDATE sessions SET exam_findings_count = exam_findings_count + 1 WHERE id = ?`, [sessionId]);

        res.json({ id: this.lastID, message: 'Exam finding recorded' });
    });
});

// GET /api/sessions/:sessionId/exam-findings - Get all exam findings for a session
router.get('/sessions/:sessionId/exam-findings', authenticateToken, (req, res) => {
    const { sessionId } = req.params;

    db.all(
        `SELECT * FROM physical_exam_findings WHERE session_id = ? ORDER BY timestamp`,
        [sessionId],
        (err, findings) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ findings });
        }
    );
});

// --- CASE VERSIONS ---

// GET /api/cases/:caseId/versions - Get version history for a case
router.get('/cases/:caseId/versions', authenticateToken, requireAdmin, (req, res) => {
    const { caseId } = req.params;

    db.all(
        `SELECT cv.*, u.username as changed_by_username
         FROM case_versions cv
         LEFT JOIN users u ON cv.changed_by = u.id
         WHERE cv.case_id = ?
         ORDER BY cv.version_number DESC`,
        [caseId],
        (err, versions) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ versions });
        }
    );
});

// POST /api/cases/:caseId/restore/:versionId - Restore a case to a previous version
router.post('/cases/:caseId/restore/:versionId', authenticateToken, requireAdmin, (req, res) => {
    const { caseId, versionId } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    db.get(
        `SELECT * FROM case_versions WHERE id = ? AND case_id = ?`,
        [versionId, caseId],
        (err, version) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!version) return res.status(404).json({ error: 'Version not found' });

            const config = JSON.parse(version.config_snapshot);
            const sql = `UPDATE cases SET
                         name = ?, description = ?, system_prompt = ?, config = ?, scenario = ?,
                         last_modified_by = ?, updated_at = CURRENT_TIMESTAMP, version = version + 1
                         WHERE id = ?`;

            db.run(sql, [
                config.name,
                config.description,
                config.system_prompt,
                JSON.stringify(config.config || {}),
                config.scenario ? JSON.stringify(config.scenario) : null,
                req.user.id,
                caseId
            ], function(err) {
                if (err) return res.status(500).json({ error: err.message });

                // Log audit and create new version
                logAudit({
                    userId: req.user.id,
                    username: req.user.username,
                    action: 'RESTORE_CASE_VERSION',
                    resourceType: 'case',
                    resourceId: caseId,
                    metadata: { restored_from_version: version.version_number },
                    ipAddress,
                    userAgent,
                    status: 'success'
                });

                createCaseVersion(caseId, req.user.id, 'restored', `Restored from version ${version.version_number}`, config);

                res.json({ message: 'Case restored successfully', restoredFromVersion: version.version_number });
            });
        }
    );
});

// --- USER PREFERENCES ---

// GET /api/users/preferences - Get current user's preferences
router.get('/users/preferences', authenticateToken, (req, res) => {
    db.get(
        `SELECT * FROM user_preferences WHERE user_id = ?`,
        [req.user.id],
        (err, prefs) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!prefs) {
                // Return default preferences
                return res.json({
                    theme: 'dark',
                    language: 'en',
                    notification_settings: null,
                    dashboard_layout: null,
                    default_llm_settings: null,
                    default_monitor_settings: null
                });
            }
            res.json(prefs);
        }
    );
});

// PUT /api/users/preferences - Update current user's preferences
router.put('/users/preferences', authenticateToken, (req, res) => {
    const { theme, language, notification_settings, dashboard_layout, default_llm_settings, default_monitor_settings, accessibility_settings } = req.body;

    db.run(
        `INSERT INTO user_preferences (user_id, theme, language, notification_settings, dashboard_layout, default_llm_settings, default_monitor_settings, accessibility_settings)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
         theme = excluded.theme,
         language = excluded.language,
         notification_settings = excluded.notification_settings,
         dashboard_layout = excluded.dashboard_layout,
         default_llm_settings = excluded.default_llm_settings,
         default_monitor_settings = excluded.default_monitor_settings,
         accessibility_settings = excluded.accessibility_settings,
         updated_at = CURRENT_TIMESTAMP`,
        [
            req.user.id,
            theme || 'dark',
            language || 'en',
            notification_settings ? JSON.stringify(notification_settings) : null,
            dashboard_layout ? JSON.stringify(dashboard_layout) : null,
            default_llm_settings ? JSON.stringify(default_llm_settings) : null,
            default_monitor_settings ? JSON.stringify(default_monitor_settings) : null,
            accessibility_settings ? JSON.stringify(accessibility_settings) : null
        ],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Preferences updated' });
        }
    );
});

// --- SYSTEM AUDIT LOG ---

// GET /api/admin/audit-log - Get system audit log (Admin only)
router.get('/admin/audit-log', authenticateToken, requireAdmin, (req, res) => {
    const { limit = 100, offset = 0, action, resource_type, user_id, from_date, to_date } = req.query;

    let sql = `SELECT sal.*, u.username as user_username
               FROM system_audit_log sal
               LEFT JOIN users u ON sal.user_id = u.id
               WHERE 1=1`;
    const params = [];

    if (action) {
        sql += ` AND sal.action = ?`;
        params.push(action);
    }
    if (resource_type) {
        sql += ` AND sal.resource_type = ?`;
        params.push(resource_type);
    }
    if (user_id) {
        sql += ` AND sal.user_id = ?`;
        params.push(user_id);
    }
    if (from_date) {
        sql += ` AND sal.timestamp >= ?`;
        params.push(from_date);
    }
    if (to_date) {
        sql += ` AND sal.timestamp <= ?`;
        params.push(to_date);
    }

    sql += ` ORDER BY sal.timestamp DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    db.all(sql, params, (err, logs) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ logs });
    });
});

// --- VITAL SIGN HISTORY ---

// POST /api/sessions/:sessionId/vitals - Record a vital sign reading
router.post('/sessions/:sessionId/vitals', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    const { vital_sign, value, unit, is_alarm_triggered, alarm_type, source } = req.body;

    if (!vital_sign || value === undefined) {
        return res.status(400).json({ error: 'vital_sign and value are required' });
    }

    db.run(
        `INSERT INTO vital_sign_history (session_id, vital_sign, value, unit, is_alarm_triggered, alarm_type, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, vital_sign, value, unit || null, is_alarm_triggered ? 1 : 0, alarm_type || null, source || 'system'],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Vital sign recorded' });
        }
    );
});

// GET /api/sessions/:sessionId/vitals - Get vital sign history for a session
router.get('/sessions/:sessionId/vitals', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    const { vital_sign, limit = 1000 } = req.query;

    let sql = `SELECT * FROM vital_sign_history WHERE session_id = ?`;
    const params = [sessionId];

    if (vital_sign) {
        sql += ` AND vital_sign = ?`;
        params.push(vital_sign);
    }

    sql += ` ORDER BY recorded_at DESC LIMIT ?`;
    params.push(parseInt(limit));

    db.all(sql, params, (err, vitals) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ vitals });
    });
});

// --- CLINICAL NOTES ---

// POST /api/sessions/:sessionId/notes - Add a clinical note
router.post('/sessions/:sessionId/notes', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    const { note_type, content } = req.body;

    if (!content) {
        return res.status(400).json({ error: 'content is required' });
    }

    db.run(
        `INSERT INTO clinical_notes (session_id, user_id, note_type, content)
         VALUES (?, ?, ?, ?)`,
        [sessionId, req.user.id, note_type || 'general', content],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Note added' });
        }
    );
});

// GET /api/sessions/:sessionId/notes - Get clinical notes for a session
router.get('/sessions/:sessionId/notes', authenticateToken, (req, res) => {
    const { sessionId } = req.params;

    db.all(
        `SELECT cn.*, u.username
         FROM clinical_notes cn
         LEFT JOIN users u ON cn.user_id = u.id
         WHERE cn.session_id = ? AND cn.deleted_at IS NULL
         ORDER BY cn.created_at`,
        [sessionId],
        (err, notes) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ notes });
        }
    );
});

// --- EXPORT RECORDS ---

// POST /api/admin/export-records - Log an export action (Admin only)
router.post('/admin/export-records', authenticateToken, requireAdmin, (req, res) => {
    const { export_type, export_format, resource_type, resource_ids, record_count, file_name, file_size_bytes, filters_applied, notes } = req.body;

    db.run(
        `INSERT INTO export_records (user_id, export_type, export_format, resource_type, resource_ids, record_count, file_name, file_size_bytes, filters_applied, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            req.user.id,
            export_type,
            export_format || null,
            resource_type || null,
            resource_ids ? JSON.stringify(resource_ids) : null,
            record_count || null,
            file_name || null,
            file_size_bytes || null,
            filters_applied ? JSON.stringify(filters_applied) : null,
            notes || null
        ],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Export recorded' });
        }
    );
});

// GET /api/admin/export-records - Get export history (Admin only)
router.get('/admin/export-records', authenticateToken, requireAdmin, (req, res) => {
    const { limit = 100, offset = 0 } = req.query;

    db.all(
        `SELECT er.*, u.username
         FROM export_records er
         LEFT JOIN users u ON er.user_id = u.id
         ORDER BY er.exported_at DESC
         LIMIT ? OFFSET ?`,
        [parseInt(limit), parseInt(offset)],
        (err, records) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ records });
        }
    );
});

// --- ACTIVE SESSIONS ---

// GET /api/admin/active-sessions - Get currently active sessions (Admin only)
router.get('/admin/active-sessions', authenticateToken, requireAdmin, (req, res) => {
    db.all(
        `SELECT acs.*, u.username, u.email, u.role
         FROM active_sessions acs
         LEFT JOIN users u ON acs.user_id = u.id
         WHERE acs.is_active = 1 AND (acs.expires_at IS NULL OR acs.expires_at > datetime('now'))
         ORDER BY acs.last_activity_at DESC`,
        [],
        (err, sessions) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ sessions });
        }
    );
});

// DELETE /api/admin/active-sessions/:id - Force logout a session (Admin only)
router.delete('/admin/active-sessions/:id', authenticateToken, requireAdmin, (req, res) => {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection?.remoteAddress;

    db.run(
        `UPDATE active_sessions SET is_active = 0 WHERE id = ?`,
        [id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Session not found' });
            }

            logAudit({
                userId: req.user.id,
                username: req.user.username,
                action: 'FORCE_LOGOUT',
                resourceType: 'active_session',
                resourceId: id,
                ipAddress,
                status: 'success'
            });

            res.json({ message: 'Session terminated' });
        }
    );
});

// --- DATABASE STATISTICS ---

// GET /api/admin/database-stats - Get database statistics (Admin only)
router.get('/admin/database-stats', authenticateToken, requireAdmin, (req, res) => {
    const stats = {};

    const tables = [
        'users', 'cases', 'sessions', 'interactions', 'learning_events',
        'physical_exam_findings', 'case_versions', 'system_audit_log',
        'vital_sign_history', 'clinical_notes', 'export_records', 'active_sessions'
    ];

    let completed = 0;
    tables.forEach(table => {
        db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
            stats[table] = err ? 'error' : row.count;
            completed++;
            if (completed === tables.length) {
                // Get database file size
                const dbPath = path.join(__dirname, 'database.sqlite');
                try {
                    const dbStats = fs.statSync(dbPath);
                    stats.database_size_mb = (dbStats.size / (1024 * 1024)).toFixed(2);
                } catch (e) {
                    stats.database_size_mb = 'unknown';
                }
                res.json({ stats });
            }
        });
    });
});

// ============================================
// MASTER DATA ROUTES - Reference Data Management
// ============================================

// --- BODY REGIONS ---

// GET /api/master/body-regions - Get all body regions
router.get('/master/body-regions', (req, res) => {
    db.all(
        `SELECT br.*,
                GROUP_CONCAT(DISTINCT et.technique_id) as exam_types
         FROM body_regions br
         LEFT JOIN region_exam_types ret ON br.id = ret.region_id
         LEFT JOIN exam_techniques et ON ret.technique_id = et.id
         WHERE br.is_active = 1
         GROUP BY br.id
         ORDER BY br.display_order`,
        [],
        (err, regions) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ regions });
        }
    );
});

// POST /api/master/body-regions - Create body region (Admin)
router.post('/master/body-regions', authenticateToken, requireAdmin, (req, res) => {
    const { region_id, name, anatomical_view, description, parent_region_id, display_order } = req.body;

    db.run(
        `INSERT INTO body_regions (region_id, name, anatomical_view, description, parent_region_id, display_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [region_id, name, anatomical_view || 'both', description, parent_region_id, display_order || 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Body region created' });
        }
    );
});

// --- EXAM TECHNIQUES ---

// GET /api/master/exam-techniques - Get all exam techniques
router.get('/master/exam-techniques', (req, res) => {
    db.all(
        `SELECT * FROM exam_techniques WHERE is_active = 1 ORDER BY display_order`,
        [],
        (err, techniques) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ techniques });
        }
    );
});

// --- BODY MAP COORDINATES ---

// GET /api/master/body-map-coordinates - Get body map coordinates
router.get('/master/body-map-coordinates', (req, res) => {
    const { gender, view } = req.query;

    let sql = `SELECT bmc.*, br.region_id, br.name as region_name
               FROM body_map_coordinates bmc
               JOIN body_regions br ON bmc.region_id = br.id
               WHERE bmc.is_clickable = 1`;
    const params = [];

    if (gender) {
        sql += ` AND (bmc.gender = ? OR bmc.gender = 'unisex')`;
        params.push(gender);
    }
    if (view) {
        sql += ` AND bmc.view = ?`;
        params.push(view);
    }

    sql += ` ORDER BY bmc.z_index`;

    db.all(sql, params, (err, coordinates) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ coordinates });
    });
});

// --- SCENARIO TEMPLATES ---

// GET /api/master/scenario-templates - Get all scenario templates
router.get('/master/scenario-templates', (req, res) => {
    const { category, include_timeline } = req.query;

    let sql = `SELECT * FROM scenario_templates WHERE is_active = 1`;
    const params = [];

    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }

    sql += ` ORDER BY name`;

    db.all(sql, params, (err, templates) => {
        if (err) return res.status(500).json({ error: err.message });

        if (include_timeline === 'true') {
            // Fetch timeline for each template
            const templateIds = templates.map(t => t.id);
            if (templateIds.length === 0) {
                return res.json({ templates });
            }

            db.all(
                `SELECT * FROM scenario_timeline_points WHERE scenario_id IN (${templateIds.join(',')}) ORDER BY sequence_order`,
                [],
                (err, points) => {
                    if (err) return res.status(500).json({ error: err.message });

                    templates.forEach(t => {
                        t.timeline = points.filter(p => p.scenario_id === t.id);
                    });
                    res.json({ templates });
                }
            );
        } else {
            res.json({ templates });
        }
    });
});

// GET /api/master/scenario-templates/:id - Get single scenario with timeline
router.get('/master/scenario-templates/:id', (req, res) => {
    const { id } = req.params;

    db.get(`SELECT * FROM scenario_templates WHERE id = ? OR template_id = ?`, [id, id], (err, template) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!template) return res.status(404).json({ error: 'Scenario not found' });

        db.all(
            `SELECT * FROM scenario_timeline_points WHERE scenario_id = ? ORDER BY sequence_order`,
            [template.id],
            (err, timeline) => {
                if (err) return res.status(500).json({ error: err.message });
                template.timeline = timeline;
                res.json({ template });
            }
        );
    });
});

// POST /api/master/scenario-templates - Create scenario template (Admin)
router.post('/master/scenario-templates', authenticateToken, requireAdmin, (req, res) => {
    const { template_id, name, description, category, duration_minutes, difficulty_level, clinical_condition, timeline } = req.body;

    db.run(
        `INSERT INTO scenario_templates (template_id, name, description, category, duration_minutes, difficulty_level, clinical_condition, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [template_id, name, description, category, duration_minutes, difficulty_level, clinical_condition, req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });

            const scenarioId = this.lastID;

            // Insert timeline points if provided
            if (timeline && timeline.length > 0) {
                const stmt = db.prepare(
                    `INSERT INTO scenario_timeline_points
                     (scenario_id, sequence_order, time_minutes, label, hr, spo2, rr, bp_sys, bp_dia, temp, etco2, cardiac_rhythm, st_elevation, pvc_present, wide_qrs, t_inversion, noise_level)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                );

                timeline.forEach((point, index) => {
                    stmt.run([
                        scenarioId, index + 1, point.time_minutes || point.time, point.label,
                        point.hr, point.spo2, point.rr, point.bp_sys || point.bpSys, point.bp_dia || point.bpDia,
                        point.temp, point.etco2, point.cardiac_rhythm || point.rhythm,
                        point.st_elevation || point.stElev ? 1 : 0,
                        point.pvc_present || point.pvc ? 1 : 0,
                        point.wide_qrs || point.wideQRS ? 1 : 0,
                        point.t_inversion || point.tInv ? 1 : 0,
                        point.noise_level || point.noise || 0
                    ]);
                });
                stmt.finalize();
            }

            res.json({ id: scenarioId, message: 'Scenario template created' });
        }
    );
});

// --- LAB TESTS ---

// GET /api/master/lab-tests - Get all lab tests
router.get('/master/lab-tests', (req, res) => {
    const { group, category, search, limit = 500, offset = 0 } = req.query;

    let sql = `SELECT * FROM lab_tests WHERE is_active = 1`;
    const params = [];

    if (group) {
        sql += ` AND test_group = ?`;
        params.push(group);
    }
    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }
    if (search) {
        sql += ` AND (test_name LIKE ? OR test_code LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY test_group, test_name LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    db.all(sql, params, (err, tests) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ tests });
    });
});

// GET /api/master/lab-tests/groups - Get lab test groups
router.get('/master/lab-tests/groups', (req, res) => {
    db.all(
        `SELECT DISTINCT test_group, COUNT(*) as count FROM lab_tests WHERE is_active = 1 GROUP BY test_group ORDER BY test_group`,
        [],
        (err, groups) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ groups });
        }
    );
});

// POST /api/master/lab-tests - Create lab test (Admin)
router.post('/master/lab-tests', authenticateToken, requireAdmin, (req, res) => {
    const { test_code, test_name, test_group, category, specimen_type, min_value, max_value, unit, critical_low, critical_high, normal_samples, description, turnaround_minutes } = req.body;

    db.run(
        `INSERT INTO lab_tests (test_code, test_name, test_group, category, specimen_type, min_value, max_value, unit, critical_low, critical_high, normal_samples, description, turnaround_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [test_code, test_name, test_group, category || 'General', specimen_type, min_value, max_value, unit, critical_low, critical_high, JSON.stringify(normal_samples || []), description, turnaround_minutes || 30],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Lab test created' });
        }
    );
});

// --- LAB PANELS ---

// GET /api/master/lab-panels - Get all lab panels
router.get('/master/lab-panels', (req, res) => {
    const { category, include_tests } = req.query;

    let sql = `SELECT * FROM lab_panels WHERE is_active = 1`;
    const params = [];

    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }

    sql += ` ORDER BY display_order, panel_name`;

    db.all(sql, params, (err, panels) => {
        if (err) return res.status(500).json({ error: err.message });

        if (include_tests === 'true') {
            const panelIds = panels.map(p => p.id);
            if (panelIds.length === 0) {
                return res.json({ panels });
            }

            db.all(
                `SELECT pt.*, lt.test_name, lt.test_group, lt.unit, lt.min_value, lt.max_value
                 FROM panel_tests pt
                 JOIN lab_tests lt ON pt.lab_test_id = lt.id
                 WHERE pt.panel_id IN (${panelIds.join(',')})
                 ORDER BY pt.display_order`,
                [],
                (err, tests) => {
                    if (err) return res.status(500).json({ error: err.message });

                    panels.forEach(p => {
                        p.tests = tests.filter(t => t.panel_id === p.id);
                    });
                    res.json({ panels });
                }
            );
        } else {
            res.json({ panels });
        }
    });
});

// --- MEDICATIONS ---

// GET /api/master/medications - Get all medications
router.get('/master/medications', (req, res) => {
    const { drug_class, category, search, limit = 500, offset = 0 } = req.query;

    let sql = `SELECT * FROM medications WHERE is_active = 1`;
    const params = [];

    if (drug_class) {
        sql += ` AND drug_class = ?`;
        params.push(drug_class);
    }
    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }
    if (search) {
        sql += ` AND (generic_name LIKE ? OR brand_names LIKE ? OR medication_code LIKE ? OR indications LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY generic_name LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    db.all(sql, params, (err, medications) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ medications });
    });
});

// POST /api/master/medications - Create medication (Admin)
router.post('/master/medications', authenticateToken, requireAdmin, (req, res) => {
    const { medication_code, generic_name, brand_names, drug_class, category, route, typical_dose, dose_unit, frequency, indications, contraindications, side_effects, is_controlled, is_high_alert } = req.body;

    db.run(
        `INSERT INTO medications (medication_code, generic_name, brand_names, drug_class, category, route, typical_dose, dose_unit, frequency, indications, contraindications, side_effects, is_controlled, is_high_alert)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [medication_code, generic_name, JSON.stringify(brand_names || []), drug_class, category, route, typical_dose, dose_unit, frequency, JSON.stringify(indications || []), JSON.stringify(contraindications || []), JSON.stringify(side_effects || []), is_controlled ? 1 : 0, is_high_alert ? 1 : 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Medication created' });
        }
    );
});

// POST /api/master/medications/bulk - Bulk import medications (Admin)
router.post('/master/medications/bulk', authenticateToken, requireAdmin, (req, res) => {
    const { medications } = req.body; // Array of { name, uses, side_effects, description }

    if (!Array.isArray(medications) || medications.length === 0) {
        return res.status(400).json({ error: 'medications array is required' });
    }

    const stmt = db.prepare(
        `INSERT OR IGNORE INTO medications (generic_name, indications, side_effects, category) VALUES (?, ?, ?, ?)`
    );

    let inserted = 0;
    let skipped = 0;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        for (const med of medications) {
            const name = med.name || med.medicine_name || med.generic_name;
            if (!name) {
                skipped++;
                continue;
            }

            stmt.run(
                name.trim(),
                JSON.stringify(med.uses || []),
                JSON.stringify(med.side_effects || []),
                'General',
                function(err) {
                    if (!err && this.changes > 0) inserted++;
                    else skipped++;
                }
            );
        }

        db.run('COMMIT', () => {
            stmt.finalize();
            res.json({
                message: 'Bulk import completed',
                inserted,
                skipped,
                total: medications.length
            });
        });
    });
});

// DELETE /api/master/medications/:id - Delete single medication (Admin)
router.delete('/master/medications/:id', authenticateToken, requireAdmin, (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM medications WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Medication not found' });
        res.json({ message: 'Medication deleted' });
    });
});

// DELETE /api/master/medications/all - Clear all medications (Admin)
router.delete('/master/medications/all', authenticateToken, requireAdmin, (req, res) => {
    db.run('DELETE FROM medications', function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'All medications deleted', deleted: this.changes });
    });
});

// --- INVESTIGATION TEMPLATES ---

// GET /api/master/investigation-templates - Get all investigation templates
router.get('/master/investigation-templates', (req, res) => {
    const { investigation_type, category } = req.query;

    let sql = `SELECT * FROM investigation_templates WHERE is_active = 1`;
    const params = [];

    if (investigation_type) {
        sql += ` AND investigation_type = ?`;
        params.push(investigation_type);
    }
    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }

    sql += ` ORDER BY category, name`;

    db.all(sql, params, (err, templates) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ templates });
    });
});

// --- VITAL SIGN DEFINITIONS ---

// GET /api/master/vital-sign-definitions - Get vital sign definitions
router.get('/master/vital-sign-definitions', (req, res) => {
    db.all(
        `SELECT * FROM vital_sign_definitions WHERE is_active = 1 ORDER BY display_order`,
        [],
        (err, vitals) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ vitals });
        }
    );
});

// --- DIAGNOSES ---

// GET /api/master/diagnoses - Get diagnoses
router.get('/master/diagnoses', (req, res) => {
    const { body_system, severity, search, limit = 500, offset = 0 } = req.query;

    let sql = `SELECT * FROM diagnoses WHERE is_active = 1`;
    const params = [];

    if (body_system) {
        sql += ` AND body_system = ?`;
        params.push(body_system);
    }
    if (severity) {
        sql += ` AND severity = ?`;
        params.push(severity);
    }
    if (search) {
        sql += ` AND (name LIKE ? OR icd_code LIKE ? OR description LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY name LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    db.all(sql, params, (err, diagnoses) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ diagnoses });
    });
});

// --- SEARCH ALIASES ---

// GET /api/master/search-aliases - Get search aliases
router.get('/master/search-aliases', (req, res) => {
    const { alias_type } = req.query;

    let sql = `SELECT * FROM search_aliases WHERE is_active = 1`;
    const params = [];

    if (alias_type) {
        sql += ` AND alias_type = ?`;
        params.push(alias_type);
    }

    sql += ` ORDER BY alias_term`;

    db.all(sql, params, (err, aliases) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ aliases });
    });
});

// ============================================
// SEEDING ROUTES - Import data from files
// ============================================

// POST /api/admin/seed/exam-techniques - Seed exam techniques
router.post('/admin/seed/exam-techniques', authenticateToken, requireAdmin, (req, res) => {
    const techniques = [
        { technique_id: 'inspection', name: 'Inspection', icon: 'Eye', description: 'Visual examination', display_order: 1 },
        { technique_id: 'palpation', name: 'Palpation', icon: 'Hand', description: 'Examination by touch', display_order: 2 },
        { technique_id: 'percussion', name: 'Percussion', icon: 'Waves', description: 'Tapping to assess underlying structures', display_order: 3 },
        { technique_id: 'auscultation', name: 'Auscultation', icon: 'Stethoscope', description: 'Listening to body sounds', display_order: 4 },
        { technique_id: 'special', name: 'Special Tests', icon: 'ClipboardCheck', description: 'Specialized examination techniques', display_order: 5 }
    ];

    let inserted = 0;
    techniques.forEach(t => {
        db.run(
            `INSERT OR IGNORE INTO exam_techniques (technique_id, name, icon, description, display_order) VALUES (?, ?, ?, ?, ?)`,
            [t.technique_id, t.name, t.icon, t.description, t.display_order],
            (err) => {
                if (!err) inserted++;
            }
        );
    });

    setTimeout(() => {
        res.json({ message: `Seeded ${inserted} exam techniques` });
    }, 500);
});

// POST /api/admin/seed/vital-definitions - Seed vital sign definitions
router.post('/admin/seed/vital-definitions', authenticateToken, requireAdmin, (req, res) => {
    const vitals = [
        { vital_id: 'hr', name: 'Heart Rate', abbreviation: 'HR', unit: 'bpm', normal_min: 60, normal_max: 100, critical_low: 40, critical_high: 150, alarm_low: 50, alarm_high: 120, display_order: 1, color_code: '#ef4444' },
        { vital_id: 'spo2', name: 'Oxygen Saturation', abbreviation: 'SpO2', unit: '%', normal_min: 95, normal_max: 100, critical_low: 88, critical_high: null, alarm_low: 90, alarm_high: null, display_order: 2, color_code: '#3b82f6' },
        { vital_id: 'rr', name: 'Respiratory Rate', abbreviation: 'RR', unit: '/min', normal_min: 12, normal_max: 20, critical_low: 8, critical_high: 30, alarm_low: 10, alarm_high: 24, display_order: 3, color_code: '#22c55e' },
        { vital_id: 'bp_sys', name: 'Systolic BP', abbreviation: 'SBP', unit: 'mmHg', normal_min: 90, normal_max: 140, critical_low: 70, critical_high: 180, alarm_low: 80, alarm_high: 160, display_order: 4, color_code: '#f59e0b' },
        { vital_id: 'bp_dia', name: 'Diastolic BP', abbreviation: 'DBP', unit: 'mmHg', normal_min: 60, normal_max: 90, critical_low: 40, critical_high: 110, alarm_low: 50, alarm_high: 100, display_order: 5, color_code: '#f59e0b' },
        { vital_id: 'temp', name: 'Temperature', abbreviation: 'Temp', unit: '°C', normal_min: 36.5, normal_max: 37.5, critical_low: 35, critical_high: 40, alarm_low: 36, alarm_high: 38.5, decimal_places: 1, display_order: 6, color_code: '#a855f7' },
        { vital_id: 'etco2', name: 'End-Tidal CO2', abbreviation: 'EtCO2', unit: 'mmHg', normal_min: 35, normal_max: 45, critical_low: 20, critical_high: 60, alarm_low: 30, alarm_high: 50, display_order: 7, color_code: '#6366f1' }
    ];

    let inserted = 0;
    vitals.forEach(v => {
        db.run(
            `INSERT OR IGNORE INTO vital_sign_definitions (vital_id, name, abbreviation, unit, normal_min, normal_max, critical_low, critical_high, alarm_low, alarm_high, decimal_places, display_order, color_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [v.vital_id, v.name, v.abbreviation, v.unit, v.normal_min, v.normal_max, v.critical_low, v.critical_high, v.alarm_low, v.alarm_high, v.decimal_places || 0, v.display_order, v.color_code],
            (err) => {
                if (!err) inserted++;
            }
        );
    });

    setTimeout(() => {
        res.json({ message: `Seeded ${inserted} vital sign definitions` });
    }, 500);
});

// POST /api/admin/seed/lab-tests - Seed lab tests from file
router.post('/admin/seed/lab-tests', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const labDbPath = path.join(__dirname, '../Lab_database.txt');

        if (!fs.existsSync(labDbPath)) {
            return res.status(404).json({ error: 'Lab_database.txt not found' });
        }

        const content = fs.readFileSync(labDbPath, 'utf8');
        const tests = JSON.parse(content);

        let inserted = 0;
        let errors = 0;

        const stmt = db.prepare(
            `INSERT OR IGNORE INTO lab_tests (test_name, test_group, category, min_value, max_value, unit, normal_samples)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        );

        tests.forEach(test => {
            stmt.run(
                [test.test_name, test.group, test.category || 'General', test.min_value, test.max_value, test.unit, JSON.stringify(test.normal_samples || [])],
                (err) => {
                    if (err) errors++;
                    else inserted++;
                }
            );
        });

        stmt.finalize(() => {
            res.json({ message: `Imported ${inserted} lab tests, ${errors} errors`, total: tests.length });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error importing lab tests', details: error.message });
    }
});

// POST /api/admin/seed/body-regions - Seed body regions from examRegions.js data
router.post('/admin/seed/body-regions', authenticateToken, requireAdmin, (req, res) => {
    // Basic body regions - can be expanded
    const regions = [
        { region_id: 'headNeck', name: 'Head & Neck', anatomical_view: 'anterior', display_order: 1 },
        { region_id: 'eyes', name: 'Eyes', anatomical_view: 'anterior', display_order: 2 },
        { region_id: 'ears', name: 'Ears', anatomical_view: 'both', display_order: 3 },
        { region_id: 'nose', name: 'Nose', anatomical_view: 'anterior', display_order: 4 },
        { region_id: 'mouth', name: 'Mouth/Throat', anatomical_view: 'anterior', display_order: 5 },
        { region_id: 'neck', name: 'Neck', anatomical_view: 'both', display_order: 6 },
        { region_id: 'chest', name: 'Chest', anatomical_view: 'anterior', display_order: 7 },
        { region_id: 'heart', name: 'Heart', anatomical_view: 'anterior', display_order: 8 },
        { region_id: 'lungs', name: 'Lungs', anatomical_view: 'both', display_order: 9 },
        { region_id: 'abdomen', name: 'Abdomen', anatomical_view: 'anterior', display_order: 10 },
        { region_id: 'back', name: 'Back', anatomical_view: 'posterior', display_order: 11 },
        { region_id: 'upperExtremities', name: 'Upper Extremities', anatomical_view: 'both', display_order: 12 },
        { region_id: 'lowerExtremities', name: 'Lower Extremities', anatomical_view: 'both', display_order: 13 },
        { region_id: 'skin', name: 'Skin', anatomical_view: 'both', display_order: 14 },
        { region_id: 'neurological', name: 'Neurological', anatomical_view: 'special', display_order: 15 }
    ];

    let inserted = 0;
    regions.forEach(r => {
        db.run(
            `INSERT OR IGNORE INTO body_regions (region_id, name, anatomical_view, display_order) VALUES (?, ?, ?, ?)`,
            [r.region_id, r.name, r.anatomical_view, r.display_order],
            (err) => {
                if (!err) inserted++;
            }
        );
    });

    setTimeout(() => {
        res.json({ message: `Seeded ${inserted} body regions` });
    }, 500);
});

// POST /api/admin/seed/all - Seed all master data
router.post('/admin/seed/all', authenticateToken, requireAdmin, async (req, res) => {
    const results = {
        exam_techniques: 0,
        vital_definitions: 0,
        body_regions: 0,
        lab_tests: 0
    };

    // This would trigger all seed operations
    res.json({
        message: 'To seed all data, call individual seed endpoints:',
        endpoints: [
            'POST /api/admin/seed/exam-techniques',
            'POST /api/admin/seed/vital-definitions',
            'POST /api/admin/seed/body-regions',
            'POST /api/admin/seed/lab-tests'
        ]
    });
});

// ============================================
// USER PROFILE ENDPOINTS
// ============================================

// GET /api/user/profile - Get current user's profile
router.get('/user/profile', authenticateToken, (req, res) => {
    db.get(
        `SELECT id, username, name, email, role, department, institution, address, phone,
                alternative_email, education, grade, created_at, updated_at, last_login
         FROM users WHERE id = ? AND deleted_at IS NULL`,
        [req.user.id],
        (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) return res.status(404).json({ error: 'User not found' });
            res.json({ user });
        }
    );
});

// PUT /api/user/profile - Update current user's profile
router.put('/user/profile', authenticateToken, (req, res) => {
    const { name, institution, address, phone, alternative_email, education, grade } = req.body;

    // Note: username and email cannot be changed by the user
    db.run(
        `UPDATE users SET
            name = COALESCE(?, name),
            institution = ?,
            address = ?,
            phone = ?,
            alternative_email = ?,
            education = ?,
            grade = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND deleted_at IS NULL`,
        [name, institution, address, phone, alternative_email, education, grade, req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'User not found' });

            // Return updated profile
            db.get(
                `SELECT id, username, name, email, role, department, institution, address, phone,
                        alternative_email, education, grade, created_at, updated_at
                 FROM users WHERE id = ?`,
                [req.user.id],
                (err, user) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'Profile updated', user });
                }
            );
        }
    );
});

// PUT /api/user/password - Change current user's password
router.put('/user/password', authenticateToken, async (req, res) => {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
        return res.status(400).json({ error: 'Current password and new password are required' });
    }

    const passwordValidation = validatePassword(new_password);
    if (!passwordValidation.valid) {
        return res.status(400).json({ error: passwordValidation.errors.join('. ') });
    }

    try {
        // Get current user
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify current password (using bcrypt imported at top of file)
        const isValid = await bcrypt.compare(current_password, user.password_hash);

        if (!isValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        // Hash new password
        const newHash = await bcrypt.hash(new_password, 10);

        // Update password
        db.run(
            'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newHash, req.user.id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Password changed successfully' });
            }
        );
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PLATFORM SETTINGS - USER FIELD CONFIGURATION
// ============================================

// Default user field configuration
const DEFAULT_USER_FIELD_CONFIG = {
    name: { label: 'Full Name', required: true, enabled: true },
    institution: { label: 'Institution', required: false, enabled: true },
    address: { label: 'Address', required: false, enabled: true },
    phone: { label: 'Phone Number', required: false, enabled: true },
    alternative_email: { label: 'Alternative Email', required: false, enabled: true },
    education: { label: 'Education', required: false, enabled: true },
    grade: { label: 'Grade/Year', required: false, enabled: true }
};

// GET /api/platform-settings/user-fields - Get user field configuration
router.get('/platform-settings/user-fields', authenticateToken, (req, res) => {
    db.get(
        `SELECT setting_value FROM platform_settings WHERE setting_key = 'user_field_config'`,
        [],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });

            if (row && row.setting_value) {
                try {
                    const config = JSON.parse(row.setting_value);
                    res.json({ config });
                } catch (e) {
                    res.json({ config: DEFAULT_USER_FIELD_CONFIG });
                }
            } else {
                res.json({ config: DEFAULT_USER_FIELD_CONFIG });
            }
        }
    );
});

// PUT /api/platform-settings/user-fields - Update user field configuration (Admin only)
router.put('/platform-settings/user-fields', authenticateToken, requireAdmin, (req, res) => {
    const { config } = req.body;

    if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'Invalid configuration' });
    }

    const configJson = JSON.stringify(config);

    db.run(
        `INSERT INTO platform_settings (setting_key, setting_value, updated_by, updated_at)
         VALUES ('user_field_config', ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(setting_key) DO UPDATE SET
         setting_value = excluded.setting_value,
         updated_by = excluded.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
        [configJson, req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'User field configuration updated', config });
        }
    );
});

// GET /api/platform-settings - Get all platform settings (Admin only)
router.get('/platform-settings', authenticateToken, requireAdmin, (req, res) => {
    db.all(
        `SELECT ps.*, u.username as updated_by_username
         FROM platform_settings ps
         LEFT JOIN users u ON ps.updated_by = u.id
         ORDER BY ps.setting_key`,
        [],
        (err, settings) => {
            if (err) return res.status(500).json({ error: err.message });

            // Parse JSON values
            const parsed = settings.map(s => ({
                ...s,
                setting_value: s.setting_value ? (() => {
                    try { return JSON.parse(s.setting_value); }
                    catch { return s.setting_value; }
                })() : null
            }));

            res.json({ settings: parsed });
        }
    );
});

// ============================================
// LLM SETTINGS & RATE LIMITING API
// ============================================

// Helper function to get a platform setting
const getPlatformSetting = (key) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key], (err, row) => {
            if (err) reject(err);
            else resolve(row?.setting_value || null);
        });
    });
};

// Helper function to set a platform setting
const setPlatformSetting = (key, value, userId) => {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO platform_settings (setting_key, setting_value, updated_by, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(setting_key) DO UPDATE SET
             setting_value = excluded.setting_value,
             updated_by = excluded.updated_by,
             updated_at = CURRENT_TIMESTAMP`,
            [key, value, userId],
            function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
};

// Default LLM settings
const DEFAULT_LLM_SETTINGS = {
    provider: 'lmstudio',
    model: 'local-model',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: '',
    enabled: true,
    maxOutputTokens: '',  // Empty = use provider default
    temperature: '',      // Empty = use provider default
    systemPromptTemplate: `You are a simulated patient in a medical training scenario.

BEHAVIORAL GUIDELINES:
- Stay fully in character as the patient described below at all times
- Respond naturally and conversationally, exactly like a real patient would
- Keep responses concise (2-4 sentences typically) - do not ramble or over-explain
- Express appropriate emotions based on your condition (anxiety, pain, worry, frustration, confusion)
- Use everyday language - do NOT use medical terminology or jargon
- Do NOT volunteer diagnoses or suggest what might be wrong with you
- Do NOT give unsolicited medical information - only answer what is asked
- Only reveal information when the doctor specifically asks about it
- It's okay to say "I don't know", "I'm not sure", or "I don't remember exactly"
- If asked about test results or numbers you weren't told, say you don't remember the exact values
- Show realistic patient behaviors: interrupt, ask questions back, express concerns
- If in pain or distress, let it affect how you communicate (shorter answers, difficulty focusing)

CONVERSATION STYLE:
- Speak in first person as the patient
- Use natural speech patterns with occasional filler words ("um", "well", "you know")
- React emotionally to concerning questions or news
- Ask clarifying questions if you don't understand medical terms
- Express gratitude, frustration, or worry as appropriate to the situation

The doctor will ask you questions. Answer based on your patient profile provided below.`
};

// Default rate limit settings (0 = unlimited/disabled)
const DEFAULT_RATE_LIMITS = {
    tokensPerUserDaily: 0,
    costPerUserDaily: 0,
    tokensPlatformDaily: 0,
    costPlatformDaily: 0,
    requestsPerUserHourly: 0
};

// GET /api/platform-settings/llm - Get LLM configuration
router.get('/platform-settings/llm', authenticateToken, async (req, res) => {
    try {
        const settings = {};
        const keys = ['llm_provider', 'llm_model', 'llm_base_url', 'llm_api_key', 'llm_enabled', 'llm_max_output_tokens', 'llm_temperature', 'llm_system_prompt_template'];

        for (const key of keys) {
            settings[key] = await getPlatformSetting(key);
        }

        // Build response with defaults
        const response = {
            provider: settings.llm_provider || DEFAULT_LLM_SETTINGS.provider,
            model: settings.llm_model || DEFAULT_LLM_SETTINGS.model,
            baseUrl: settings.llm_base_url || DEFAULT_LLM_SETTINGS.baseUrl,
            apiKey: settings.llm_api_key ? '••••••••' : '', // Mask API key for non-admins
            apiKeySet: !!settings.llm_api_key,
            enabled: settings.llm_enabled !== 'false',
            maxOutputTokens: settings.llm_max_output_tokens || '',
            temperature: settings.llm_temperature || '',
            systemPromptTemplate: settings.llm_system_prompt_template || DEFAULT_LLM_SETTINGS.systemPromptTemplate
        };

        // Admins get full settings
        if (req.user.role === 'admin') {
            response.apiKey = settings.llm_api_key || '';
        }

        res.json(response);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/platform-settings/llm - Update LLM configuration (Admin only)
router.put('/platform-settings/llm', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { provider, model, baseUrl, apiKey, enabled, maxOutputTokens, temperature, systemPromptTemplate } = req.body;

        if (provider) await setPlatformSetting('llm_provider', provider, req.user.id);
        if (model !== undefined) await setPlatformSetting('llm_model', model, req.user.id);
        if (baseUrl) await setPlatformSetting('llm_base_url', baseUrl, req.user.id);
        if (apiKey !== undefined) await setPlatformSetting('llm_api_key', apiKey, req.user.id);
        if (enabled !== undefined) await setPlatformSetting('llm_enabled', String(enabled), req.user.id);
        if (maxOutputTokens !== undefined) await setPlatformSetting('llm_max_output_tokens', String(maxOutputTokens), req.user.id);
        if (temperature !== undefined) await setPlatformSetting('llm_temperature', String(temperature), req.user.id);
        if (systemPromptTemplate !== undefined) await setPlatformSetting('llm_system_prompt_template', systemPromptTemplate, req.user.id);

        res.json({ message: 'LLM settings updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/platform-settings/llm/test - Test LLM connection (Admin only)
router.post('/platform-settings/llm/test', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const provider = await getPlatformSetting('llm_provider') || DEFAULT_LLM_SETTINGS.provider;
        const model = await getPlatformSetting('llm_model') || '';
        const baseUrl = await getPlatformSetting('llm_base_url') || DEFAULT_LLM_SETTINGS.baseUrl;
        const apiKey = await getPlatformSetting('llm_api_key') || '';

        let headers = { 'Content-Type': 'application/json' };
        let requestPayload = {};
        let endpoint = '';

        if (provider === 'anthropic') {
            // Anthropic API format
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
            requestPayload = {
                model: model || 'claude-3-5-sonnet-20241022',
                max_tokens: 100,
                messages: [{ role: 'user', content: 'Say "test successful" in exactly two words.' }]
            };
            endpoint = `${baseUrl}/messages`;
        } else {
            // OpenAI-compatible format
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
            requestPayload = {
                messages: [{ role: 'user', content: 'Say "test successful" in exactly two words.' }]
            };
            if (model && model.trim() !== '') {
                requestPayload.model = model;
            }
            endpoint = `${baseUrl}/chat/completions`;
        }

        console.log(`[LLM Test] Testing ${provider} at ${endpoint}`);
        const testResponse = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestPayload)
        });

        if (!testResponse.ok) {
            const errText = await testResponse.text();
            return res.status(400).json({
                success: false,
                error: `LLM API returned ${testResponse.status}: ${errText}`
            });
        }

        const data = await testResponse.json();

        // Extract content based on provider
        let responseContent;
        if (provider === 'anthropic') {
            responseContent = data.content?.[0]?.text || 'No response content';
        } else {
            responseContent = data.choices?.[0]?.message?.content || 'No response content';
        }

        res.json({
            success: true,
            message: 'Connection successful',
            response: responseContent
        });
    } catch (err) {
        console.error('[LLM Test] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/platform-settings/rate-limits - Get rate limit configuration
router.get('/platform-settings/rate-limits', authenticateToken, async (req, res) => {
    try {
        const settings = {
            tokensPerUserDaily: parseInt(await getPlatformSetting('rate_limit_tokens_per_user_daily')) || DEFAULT_RATE_LIMITS.tokensPerUserDaily,
            costPerUserDaily: parseFloat(await getPlatformSetting('rate_limit_cost_per_user_daily')) || DEFAULT_RATE_LIMITS.costPerUserDaily,
            tokensPlatformDaily: parseInt(await getPlatformSetting('rate_limit_tokens_platform_daily')) || DEFAULT_RATE_LIMITS.tokensPlatformDaily,
            costPlatformDaily: parseFloat(await getPlatformSetting('rate_limit_cost_platform_daily')) || DEFAULT_RATE_LIMITS.costPlatformDaily,
            requestsPerUserHourly: parseInt(await getPlatformSetting('rate_limit_requests_per_user_hourly')) || DEFAULT_RATE_LIMITS.requestsPerUserHourly
        };

        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/platform-settings/rate-limits - Update rate limit configuration (Admin only)
router.put('/platform-settings/rate-limits', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { tokensPerUserDaily, costPerUserDaily, tokensPlatformDaily, costPlatformDaily, requestsPerUserHourly } = req.body;

        if (tokensPerUserDaily !== undefined) await setPlatformSetting('rate_limit_tokens_per_user_daily', String(tokensPerUserDaily), req.user.id);
        if (costPerUserDaily !== undefined) await setPlatformSetting('rate_limit_cost_per_user_daily', String(costPerUserDaily), req.user.id);
        if (tokensPlatformDaily !== undefined) await setPlatformSetting('rate_limit_tokens_platform_daily', String(tokensPlatformDaily), req.user.id);
        if (costPlatformDaily !== undefined) await setPlatformSetting('rate_limit_cost_platform_daily', String(costPlatformDaily), req.user.id);
        if (requestsPerUserHourly !== undefined) await setPlatformSetting('rate_limit_requests_per_user_hourly', String(requestsPerUserHourly), req.user.id);

        res.json({ message: 'Rate limits updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Default monitor visibility settings
const DEFAULT_MONITOR_SETTINGS = {
    showTimer: true,
    showECG: true,
    showSpO2: true,
    showBP: true,
    showRR: true,
    showTemp: true,
    showCO2: true,
    showPleth: true,
    showNumerics: true
};

// GET /api/platform-settings/monitor - Get monitor visibility settings (public, no auth required)
router.get('/platform-settings/monitor', async (req, res) => {
    try {
        const settings = {};
        for (const [key, defaultVal] of Object.entries(DEFAULT_MONITOR_SETTINGS)) {
            const value = await getPlatformSetting(`monitor_${key}`);
            settings[key] = value !== null ? value === 'true' : defaultVal;
        }
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/platform-settings/monitor - Update monitor visibility settings (Admin only)
router.put('/platform-settings/monitor', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const validKeys = Object.keys(DEFAULT_MONITOR_SETTINGS);

        for (const [key, value] of Object.entries(req.body)) {
            if (validKeys.includes(key)) {
                await setPlatformSetting(`monitor_${key}`, String(value), req.user.id);
            }
        }

        res.json({ message: 'Monitor settings updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Default doctor/chat settings
const DEFAULT_CHAT_SETTINGS = {
    doctorName: 'Dr. Carmen',
    doctorAvatar: ''
};

// GET /api/platform-settings/chat - Get chat/doctor settings
router.get('/platform-settings/chat', authenticateToken, async (req, res) => {
    try {
        const doctorName = await getPlatformSetting('chat_doctor_name') || DEFAULT_CHAT_SETTINGS.doctorName;
        const doctorAvatar = await getPlatformSetting('chat_doctor_avatar') || DEFAULT_CHAT_SETTINGS.doctorAvatar;

        res.json({
            doctorName,
            doctorAvatar
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/platform-settings/chat - Update chat/doctor settings (Admin only)
router.put('/platform-settings/chat', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { doctorName, doctorAvatar } = req.body;

        if (doctorName !== undefined) await setPlatformSetting('chat_doctor_name', doctorName, req.user.id);
        if (doctorAvatar !== undefined) await setPlatformSetting('chat_doctor_avatar', doctorAvatar, req.user.id);

        res.json({ message: 'Chat settings updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/llm/usage - Get current user's usage
router.get('/llm/usage', authenticateToken, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Get user's daily usage
        const userUsage = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM llm_usage WHERE user_id = ? AND date = ?`,
                [req.user.id, today],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { total_tokens: 0, estimated_cost: 0, request_count: 0 });
                }
            );
        });

        // Get rate limits
        const limits = {
            tokensPerUserDaily: parseInt(await getPlatformSetting('rate_limit_tokens_per_user_daily')) || DEFAULT_RATE_LIMITS.tokensPerUserDaily,
            costPerUserDaily: parseFloat(await getPlatformSetting('rate_limit_cost_per_user_daily')) || DEFAULT_RATE_LIMITS.costPerUserDaily
        };

        res.json({
            date: today,
            tokensUsed: userUsage.total_tokens,
            tokensLimit: limits.tokensPerUserDaily,
            tokensRemaining: Math.max(0, limits.tokensPerUserDaily - userUsage.total_tokens),
            costUsed: userUsage.estimated_cost,
            costLimit: limits.costPerUserDaily,
            costRemaining: Math.max(0, limits.costPerUserDaily - userUsage.estimated_cost),
            requestCount: userUsage.request_count
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/llm/usage/all - Get all users' usage (Admin only)
router.get('/llm/usage/all', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        const usage = await new Promise((resolve, reject) => {
            db.all(
                `SELECT lu.*, u.username, u.name
                 FROM llm_usage lu
                 JOIN users u ON lu.user_id = u.id
                 WHERE lu.date = ?
                 ORDER BY lu.total_tokens DESC`,
                [today],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        res.json({ date: today, users: usage });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/llm/usage/platform - Get platform-wide usage (Admin only)
router.get('/llm/usage/platform', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Get platform-wide totals for today
        const platformUsage = await new Promise((resolve, reject) => {
            db.get(
                `SELECT
                    SUM(total_tokens) as total_tokens,
                    SUM(estimated_cost) as total_cost,
                    SUM(request_count) as total_requests,
                    COUNT(DISTINCT user_id) as active_users
                 FROM llm_usage WHERE date = ?`,
                [today],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { total_tokens: 0, total_cost: 0, total_requests: 0, active_users: 0 });
                }
            );
        });

        // Get limits
        const limits = {
            tokensPlatformDaily: parseInt(await getPlatformSetting('rate_limit_tokens_platform_daily')) || DEFAULT_RATE_LIMITS.tokensPlatformDaily,
            costPlatformDaily: parseFloat(await getPlatformSetting('rate_limit_cost_platform_daily')) || DEFAULT_RATE_LIMITS.costPlatformDaily
        };

        res.json({
            date: today,
            tokensUsed: platformUsage.total_tokens || 0,
            tokensLimit: limits.tokensPlatformDaily,
            tokensRemaining: Math.max(0, limits.tokensPlatformDaily - (platformUsage.total_tokens || 0)),
            costUsed: platformUsage.total_cost || 0,
            costLimit: limits.costPlatformDaily,
            costRemaining: Math.max(0, limits.costPlatformDaily - (platformUsage.total_cost || 0)),
            totalRequests: platformUsage.total_requests || 0,
            activeUsers: platformUsage.active_users || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/llm/pricing - Get model pricing table (Admin only)
router.get('/llm/pricing', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const pricing = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM llm_model_pricing WHERE is_active = 1 ORDER BY provider, model', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        res.json({ pricing });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/llm/pricing - Update model pricing (Admin only)
router.put('/llm/pricing', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { provider, model, inputCostPer1k, outputCostPer1k } = req.body;

        if (!provider || !model) {
            return res.status(400).json({ error: 'Provider and model are required' });
        }

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO llm_model_pricing (provider, model, input_cost_per_1k, output_cost_per_1k, updated_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(provider, model) DO UPDATE SET
                 input_cost_per_1k = excluded.input_cost_per_1k,
                 output_cost_per_1k = excluded.output_cost_per_1k,
                 updated_at = CURRENT_TIMESTAMP`,
                [provider, model, inputCostPer1k || 0, outputCostPer1k || 0],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        res.json({ message: 'Pricing updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// PATIENT RECORD MEMORY MODULE ENDPOINTS
// ============================================

// POST /api/patient-record/sync - Sync patient record (events + document)
router.post('/patient-record/sync', async (req, res) => {
    try {
        const { session_id, record_id, events, document, patient_info, current_state, events_count } = req.body;

        if (!session_id || !record_id) {
            return res.status(400).json({ error: 'session_id and record_id are required' });
        }

        // Insert new events
        if (events && events.length > 0) {
            const insertEvent = db.prepare(`
                INSERT OR IGNORE INTO patient_record_events
                (session_id, record_id, event_id, verb, time_elapsed, category, region, source, item, content, finding, value, unit, abnormal, details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const event of events) {
                insertEvent.run(
                    session_id,
                    record_id,
                    event.id,
                    event.verb,
                    event.time,
                    event.category || null,
                    event.region || null,
                    event.source || null,
                    event.item || null,
                    event.content || null,
                    event.finding || null,
                    event.value || null,
                    event.unit || null,
                    event.abnormal ? 1 : 0,
                    JSON.stringify(event)
                );
            }
            insertEvent.finalize();
        }

        // Upsert document
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO patient_record_documents (session_id, record_id, patient_info, current_state, events_count, document, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(session_id) DO UPDATE SET
                    current_state = excluded.current_state,
                    events_count = excluded.events_count,
                    document = excluded.document,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                session_id,
                record_id,
                JSON.stringify(patient_info),
                JSON.stringify(current_state),
                events_count || 0,
                JSON.stringify(document)
            ], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        res.json({
            success: true,
            message: 'Patient record synced',
            events_synced: events?.length || 0
        });
    } catch (err) {
        console.error('Patient record sync error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/patient-record/:sessionId - Get patient record document
router.get('/patient-record/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const record = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM patient_record_documents WHERE session_id = ?',
                [sessionId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!record) {
            return res.status(404).json({ error: 'Patient record not found' });
        }

        res.json({
            session_id: record.session_id,
            record_id: record.record_id,
            patient_info: JSON.parse(record.patient_info || '{}'),
            current_state: JSON.parse(record.current_state || '{}'),
            events_count: record.events_count,
            document: JSON.parse(record.document || '{}'),
            created_at: record.created_at,
            updated_at: record.updated_at
        });
    } catch (err) {
        console.error('Patient record get error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/patient-record/:sessionId/events - Get patient record events
router.get('/patient-record/:sessionId/events', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { verb } = req.query;

        let query = 'SELECT * FROM patient_record_events WHERE session_id = ?';
        const params = [sessionId];

        if (verb) {
            query += ' AND verb = ?';
            params.push(verb);
        }

        query += ' ORDER BY time_elapsed ASC, id ASC';

        const events = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Parse details JSON for each event
        const parsedEvents = events.map(e => ({
            ...e,
            details: JSON.parse(e.details || '{}'),
            abnormal: e.abnormal === 1
        }));

        res.json({ events: parsedEvents });
    } catch (err) {
        console.error('Patient record events get error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/patient-record/:sessionId - Delete patient record
router.delete('/patient-record/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        // Delete events
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM patient_record_events WHERE session_id = ?', [sessionId], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        // Delete document
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM patient_record_documents WHERE session_id = ?', [sessionId], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        res.json({ success: true, message: 'Patient record deleted' });
    } catch (err) {
        console.error('Patient record delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/patient-record/:sessionId/summary - Get patient record summary
router.get('/patient-record/:sessionId/summary', async (req, res) => {
    try {
        const { sessionId } = req.params;

        // Get document
        const record = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM patient_record_documents WHERE session_id = ?',
                [sessionId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!record) {
            return res.status(404).json({ error: 'Patient record not found' });
        }

        // Get verb counts
        const verbCounts = await new Promise((resolve, reject) => {
            db.all(
                `SELECT verb, COUNT(*) as count FROM patient_record_events
                 WHERE session_id = ? GROUP BY verb`,
                [sessionId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const verbCountMap = {};
        verbCounts.forEach(v => {
            verbCountMap[v.verb] = v.count;
        });

        const document = JSON.parse(record.document || '{}');

        res.json({
            session_id: record.session_id,
            record_id: record.record_id,
            patient_name: document.patient?.name || 'Unknown',
            events_count: record.events_count,
            events_by_verb: verbCountMap,
            current_state: JSON.parse(record.current_state || '{}'),
            created_at: record.created_at,
            updated_at: record.updated_at
        });
    } catch (err) {
        console.error('Patient record summary error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// MULTI-AGENT SYSTEM ROUTES
// ============================================

// -------------------- AGENT TEMPLATES (Admin) --------------------

// GET /api/agents/templates - List all agent templates
router.get('/agents/templates', authenticateToken, async (req, res) => {
    try {
        const templates = await new Promise((resolve, reject) => {
            db.all(
                `SELECT * FROM agent_templates ORDER BY is_default DESC, agent_type ASC, name ASC`,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const parsed = templates.map(t => ({
            ...t,
            config: JSON.parse(t.config || '{}'),
            is_default: t.is_default === 1
        }));

        res.json({ templates: parsed });
    } catch (err) {
        console.error('Agent templates list error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/agents/templates/:id - Get single agent template
router.get('/agents/templates/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const template = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM agent_templates WHERE id = ?',
                [id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!template) {
            return res.status(404).json({ error: 'Agent template not found' });
        }

        res.json({
            ...template,
            config: JSON.parse(template.config || '{}'),
            is_default: template.is_default === 1
        });
    } catch (err) {
        console.error('Agent template get error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/agents/templates - Create agent template (admin only)
router.post('/agents/templates', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const {
            agent_type,
            name,
            role_title,
            avatar_url,
            system_prompt,
            context_filter = 'full',
            communication_style,
            config = {},
            // LLM configuration
            llm_provider,
            llm_model,
            llm_api_key,
            llm_endpoint,
            llm_config,
            // Memory access configuration
            memory_access
        } = req.body;

        if (!agent_type || !name || !system_prompt) {
            return res.status(400).json({ error: 'agent_type, name, and system_prompt are required' });
        }

        const result = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO agent_templates
                 (agent_type, name, role_title, avatar_url, system_prompt, context_filter, communication_style, config,
                  llm_provider, llm_model, llm_api_key, llm_endpoint, llm_config, memory_access, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    agent_type, name, role_title, avatar_url, system_prompt, context_filter, communication_style,
                    JSON.stringify(config),
                    llm_provider || null, llm_model || null, llm_api_key || null, llm_endpoint || null,
                    llm_config ? JSON.stringify(llm_config) : null,
                    memory_access ? JSON.stringify(memory_access) : null,
                    req.user.id
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });

        logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'create_agent_template',
            resourceType: 'agent_template',
            resourceId: result.id.toString(),
            resourceName: name,
            newValue: { agent_type, name }
        });

        res.status(201).json({ id: result.id, message: 'Agent template created' });
    } catch (err) {
        console.error('Agent template create error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/agents/templates/:id - Update agent template (admin only)
router.put('/agents/templates/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            agent_type,
            name,
            role_title,
            avatar_url,
            system_prompt,
            context_filter,
            communication_style,
            config,
            // LLM configuration
            llm_provider,
            llm_model,
            llm_api_key,
            llm_endpoint,
            llm_config,
            // Memory access configuration
            memory_access
        } = req.body;

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (agent_type !== undefined) { updates.push('agent_type = ?'); params.push(agent_type); }
        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (role_title !== undefined) { updates.push('role_title = ?'); params.push(role_title); }
        if (avatar_url !== undefined) { updates.push('avatar_url = ?'); params.push(avatar_url); }
        if (system_prompt !== undefined) { updates.push('system_prompt = ?'); params.push(system_prompt); }
        if (context_filter !== undefined) { updates.push('context_filter = ?'); params.push(context_filter); }
        if (communication_style !== undefined) { updates.push('communication_style = ?'); params.push(communication_style); }
        if (config !== undefined) { updates.push('config = ?'); params.push(JSON.stringify(config)); }
        // LLM fields
        if (llm_provider !== undefined) { updates.push('llm_provider = ?'); params.push(llm_provider || null); }
        if (llm_model !== undefined) { updates.push('llm_model = ?'); params.push(llm_model || null); }
        if (llm_api_key !== undefined) { updates.push('llm_api_key = ?'); params.push(llm_api_key || null); }
        if (llm_endpoint !== undefined) { updates.push('llm_endpoint = ?'); params.push(llm_endpoint || null); }
        if (llm_config !== undefined) { updates.push('llm_config = ?'); params.push(llm_config ? JSON.stringify(llm_config) : null); }
        // Memory access
        if (memory_access !== undefined) { updates.push('memory_access = ?'); params.push(memory_access ? JSON.stringify(memory_access) : null); }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);

        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE agent_templates SET ${updates.join(', ')} WHERE id = ?`,
                params,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'update_agent_template',
            resourceType: 'agent_template',
            resourceId: id,
            newValue: req.body
        });

        res.json({ success: true, message: 'Agent template updated' });
    } catch (err) {
        console.error('Agent template update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/agents/templates/:id - Delete agent template (admin only)
router.delete('/agents/templates/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if it's a default template
        const template = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM agent_templates WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!template) {
            return res.status(404).json({ error: 'Agent template not found' });
        }

        if (template.is_default === 1) {
            return res.status(400).json({ error: 'Cannot delete default agent templates' });
        }

        await new Promise((resolve, reject) => {
            db.run('DELETE FROM agent_templates WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'delete_agent_template',
            resourceType: 'agent_template',
            resourceId: id,
            resourceName: template.name
        });

        res.json({ success: true, message: 'Agent template deleted' });
    } catch (err) {
        console.error('Agent template delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/agents/templates/:id/test-llm - Test agent LLM configuration
router.post('/agents/templates/:id/test-llm', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Get template with LLM config
        const template = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM agent_templates WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!template) {
            return res.status(404).json({ error: 'Agent template not found' });
        }

        // Get provider config - use template override or fall back to platform default
        let provider = template.llm_provider;
        let model = template.llm_model;
        let apiKey = template.llm_api_key;
        let endpoint = template.llm_endpoint;

        // If no override, use platform defaults
        if (!provider) {
            const platformConfig = await new Promise((resolve, reject) => {
                db.get('SELECT value FROM config WHERE key = ?', ['llm_provider'], (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.value || 'openai');
                });
            });
            provider = platformConfig;
        }

        if (!model) {
            const platformModel = await new Promise((resolve, reject) => {
                db.get('SELECT value FROM config WHERE key = ?', ['llm_model'], (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.value || 'gpt-4o-mini');
                });
            });
            model = platformModel;
        }

        if (!apiKey) {
            const keyMap = {
                'openai': 'openai_api_key',
                'anthropic': 'anthropic_api_key',
                'openrouter': 'openrouter_api_key'
            };
            const keyName = keyMap[provider] || 'openai_api_key';
            const platformKey = await new Promise((resolve, reject) => {
                db.get('SELECT value FROM config WHERE key = ?', [keyName], (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.value);
                });
            });
            apiKey = platformKey;
        }

        if (!endpoint && provider === 'custom') {
            const platformEndpoint = await new Promise((resolve, reject) => {
                db.get('SELECT value FROM config WHERE key = ?', ['custom_llm_endpoint'], (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.value);
                });
            });
            endpoint = platformEndpoint;
        }

        if (!apiKey && provider !== 'custom') {
            return res.status(400).json({ error: `No API key configured for provider: ${provider}` });
        }

        // Build a simple test message
        const testMessages = [
            { role: 'system', content: template.system_prompt || 'You are a helpful assistant.' },
            { role: 'user', content: 'Please respond with a single sentence confirming you are working correctly.' }
        ];

        let response;
        const startTime = Date.now();

        if (provider === 'openai') {
            const OpenAI = (await import('openai')).default;
            const openai = new OpenAI({ apiKey });
            const completion = await openai.chat.completions.create({
                model: model || 'gpt-4o-mini',
                messages: testMessages,
                max_tokens: 100
            });
            response = completion.choices[0]?.message?.content;
        } else if (provider === 'anthropic') {
            const Anthropic = (await import('@anthropic-ai/sdk')).default;
            const anthropic = new Anthropic({ apiKey });
            const completion = await anthropic.messages.create({
                model: model || 'claude-3-5-sonnet-20241022',
                max_tokens: 100,
                system: testMessages[0].content,
                messages: [{ role: 'user', content: testMessages[1].content }]
            });
            response = completion.content[0]?.text;
        } else if (provider === 'openrouter') {
            const OpenAI = (await import('openai')).default;
            const openai = new OpenAI({
                apiKey,
                baseURL: 'https://openrouter.ai/api/v1'
            });
            const completion = await openai.chat.completions.create({
                model: model || 'openai/gpt-4o-mini',
                messages: testMessages,
                max_tokens: 100
            });
            response = completion.choices[0]?.message?.content;
        } else if (provider === 'custom' && endpoint) {
            const OpenAI = (await import('openai')).default;
            const openai = new OpenAI({
                apiKey: apiKey || 'not-needed',
                baseURL: endpoint
            });
            const completion = await openai.chat.completions.create({
                model: model || 'default',
                messages: testMessages,
                max_tokens: 100
            });
            response = completion.choices[0]?.message?.content;
        } else {
            return res.status(400).json({ error: `Unsupported provider: ${provider}` });
        }

        const latency = Date.now() - startTime;

        res.json({
            success: true,
            provider,
            model,
            latency_ms: latency,
            response,
            message: 'LLM connection test successful'
        });
    } catch (err) {
        console.error('Agent LLM test error:', err);
        res.status(500).json({
            success: false,
            error: err.message,
            message: 'LLM connection test failed'
        });
    }
});

// POST /api/agents/templates/:id/duplicate - Duplicate an agent template
router.post('/agents/templates/:id/duplicate', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name: newName } = req.body;

        // Get original template
        const original = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM agent_templates WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!original) {
            return res.status(404).json({ error: 'Agent template not found' });
        }

        const duplicateName = newName || `${original.name} (Copy)`;

        const result = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO agent_templates
                 (agent_type, name, role_title, avatar_url, system_prompt, context_filter, communication_style, is_default, config, created_by,
                  llm_provider, llm_model, llm_api_key, llm_endpoint, llm_config, memory_access)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    original.agent_type,
                    duplicateName,
                    original.role_title,
                    original.avatar_url,
                    original.system_prompt,
                    original.context_filter,
                    original.communication_style,
                    original.config,
                    req.user.id,
                    original.llm_provider,
                    original.llm_model,
                    original.llm_api_key,
                    original.llm_endpoint,
                    original.llm_config,
                    original.memory_access
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });

        res.status(201).json({ id: result.id, message: 'Agent template duplicated' });
    } catch (err) {
        console.error('Agent template duplicate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// -------------------- CASE AGENTS (Per-Case Config) --------------------

// GET /api/cases/:caseId/agents - List agents configured for a case
router.get('/cases/:caseId/agents', authenticateToken, async (req, res) => {
    try {
        const { caseId } = req.params;

        const agents = await new Promise((resolve, reject) => {
            db.all(
                `SELECT ca.*, at.name as template_name, at.role_title as template_role_title,
                        at.system_prompt as template_system_prompt, at.agent_type,
                        at.avatar_url as template_avatar, at.context_filter as template_context_filter,
                        at.communication_style as template_communication_style, at.config as template_config
                 FROM case_agents ca
                 JOIN agent_templates at ON ca.agent_template_id = at.id
                 WHERE ca.case_id = ?
                 ORDER BY at.agent_type ASC`,
                [caseId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        // Merge template data with overrides
        const parsed = agents.map(a => ({
            id: a.id,
            case_id: a.case_id,
            agent_template_id: a.agent_template_id,
            agent_type: a.agent_type,
            enabled: a.enabled === 1,
            // Use override if set, else template value
            name: a.name_override || a.template_name,
            role_title: a.template_role_title,
            avatar_url: a.template_avatar,
            system_prompt: a.system_prompt_override || a.template_system_prompt,
            context_filter: a.template_context_filter,
            communication_style: a.template_communication_style,
            // Availability config
            availability_type: a.availability_type,
            available_from_minute: a.available_from_minute,
            auto_arrive_minute: a.auto_arrive_minute,
            depart_at_minute: a.depart_at_minute,
            response_time_min: a.response_time_min,
            response_time_max: a.response_time_max,
            // Merged config
            config: {
                ...JSON.parse(a.template_config || '{}'),
                ...JSON.parse(a.config_override || '{}')
            },
            // Keep override flags for editing
            has_name_override: !!a.name_override,
            has_prompt_override: !!a.system_prompt_override,
            has_config_override: !!a.config_override
        }));

        res.json({ agents: parsed });
    } catch (err) {
        console.error('Case agents list error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/cases/:caseId/agents - Add agent to case
router.post('/cases/:caseId/agents', authenticateToken, async (req, res) => {
    try {
        const { caseId } = req.params;
        const {
            agent_template_id,
            enabled = true,
            name_override,
            system_prompt_override,
            availability_type = 'present',
            available_from_minute = 0,
            auto_arrive_minute,
            depart_at_minute,
            response_time_min = 0,
            response_time_max = 0,
            config_override
        } = req.body;

        if (!agent_template_id) {
            return res.status(400).json({ error: 'agent_template_id is required' });
        }

        // Check if template exists
        const template = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM agent_templates WHERE id = ?', [agent_template_id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!template) {
            return res.status(404).json({ error: 'Agent template not found' });
        }

        const result = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO case_agents
                 (case_id, agent_template_id, enabled, name_override, system_prompt_override,
                  availability_type, available_from_minute, auto_arrive_minute, depart_at_minute,
                  response_time_min, response_time_max, config_override)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    caseId, agent_template_id, enabled ? 1 : 0, name_override, system_prompt_override,
                    availability_type, available_from_minute, auto_arrive_minute, depart_at_minute,
                    response_time_min, response_time_max, config_override ? JSON.stringify(config_override) : null
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });

        res.status(201).json({ id: result.id, message: 'Agent added to case' });
    } catch (err) {
        console.error('Case agent add error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/cases/:caseId/agents/:agentId - Update case agent config
router.put('/cases/:caseId/agents/:agentId', authenticateToken, async (req, res) => {
    try {
        const { caseId, agentId } = req.params;
        const {
            enabled,
            name_override,
            system_prompt_override,
            availability_type,
            available_from_minute,
            auto_arrive_minute,
            depart_at_minute,
            response_time_min,
            response_time_max,
            config_override
        } = req.body;

        const updates = [];
        const params = [];

        if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
        if (name_override !== undefined) { updates.push('name_override = ?'); params.push(name_override || null); }
        if (system_prompt_override !== undefined) { updates.push('system_prompt_override = ?'); params.push(system_prompt_override || null); }
        if (availability_type !== undefined) { updates.push('availability_type = ?'); params.push(availability_type); }
        if (available_from_minute !== undefined) { updates.push('available_from_minute = ?'); params.push(available_from_minute); }
        if (auto_arrive_minute !== undefined) { updates.push('auto_arrive_minute = ?'); params.push(auto_arrive_minute); }
        if (depart_at_minute !== undefined) { updates.push('depart_at_minute = ?'); params.push(depart_at_minute); }
        if (response_time_min !== undefined) { updates.push('response_time_min = ?'); params.push(response_time_min); }
        if (response_time_max !== undefined) { updates.push('response_time_max = ?'); params.push(response_time_max); }
        if (config_override !== undefined) { updates.push('config_override = ?'); params.push(config_override ? JSON.stringify(config_override) : null); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        params.push(agentId, caseId);

        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE case_agents SET ${updates.join(', ')} WHERE id = ? AND case_id = ?`,
                params,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        res.json({ success: true, message: 'Case agent updated' });
    } catch (err) {
        console.error('Case agent update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/cases/:caseId/agents/:agentId - Remove agent from case
router.delete('/cases/:caseId/agents/:agentId', authenticateToken, async (req, res) => {
    try {
        const { caseId, agentId } = req.params;

        await new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM case_agents WHERE id = ? AND case_id = ?',
                [agentId, caseId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        res.json({ success: true, message: 'Agent removed from case' });
    } catch (err) {
        console.error('Case agent delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/cases/:caseId/agents/add-defaults - Add all default agents to case
router.post('/cases/:caseId/agents/add-defaults', authenticateToken, async (req, res) => {
    try {
        const { caseId } = req.params;

        // Get all default templates
        const defaults = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM agent_templates WHERE is_default = 1', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Insert each default agent for the case
        let addedCount = 0;
        for (const template of defaults) {
            const config = JSON.parse(template.config || '{}');
            try {
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT OR IGNORE INTO case_agents
                         (case_id, agent_template_id, enabled, availability_type, available_from_minute,
                          response_time_min, response_time_max)
                         VALUES (?, ?, 1, ?, 0, ?, ?)`,
                        [
                            caseId,
                            template.id,
                            config.typical_availability || 'present',
                            config.response_time?.min || 0,
                            config.response_time?.max || 0
                        ],
                        function(err) {
                            if (err) reject(err);
                            else {
                                if (this.changes > 0) addedCount++;
                                resolve(this.changes);
                            }
                        }
                    );
                });
            } catch (e) {
                // Ignore duplicates
            }
        }

        res.json({ success: true, added: addedCount, message: `Added ${addedCount} default agents to case` });
    } catch (err) {
        console.error('Add default agents error:', err);
        res.status(500).json({ error: err.message });
    }
});

// -------------------- AGENT SESSION STATE (Runtime) --------------------

// GET /api/sessions/:sessionId/agents - Get agent states for session
router.get('/sessions/:sessionId/agents', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;

        // Get session to find case_id
        const session = await new Promise((resolve, reject) => {
            db.get('SELECT case_id FROM sessions WHERE id = ?', [sessionId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Get case agents with current session state
        const agents = await new Promise((resolve, reject) => {
            db.all(
                `SELECT ca.*, at.name as template_name, at.role_title, at.agent_type,
                        at.avatar_url, at.system_prompt as template_system_prompt,
                        at.context_filter, at.communication_style, at.config as template_config,
                        ass.status as session_status, ass.paged_at, ass.arrived_at, ass.departed_at
                 FROM case_agents ca
                 JOIN agent_templates at ON ca.agent_template_id = at.id
                 LEFT JOIN agent_session_state ass ON ass.session_id = ? AND ass.agent_type = at.agent_type
                 WHERE ca.case_id = ? AND ca.enabled = 1
                 ORDER BY at.agent_type ASC`,
                [sessionId, session.case_id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const parsed = agents.map(a => ({
            agent_type: a.agent_type,
            name: a.name_override || a.template_name,
            role_title: a.role_title,
            avatar_url: a.avatar_url,
            system_prompt: a.system_prompt_override || a.template_system_prompt,
            context_filter: a.context_filter,
            communication_style: a.communication_style,
            availability_type: a.availability_type,
            available_from_minute: a.available_from_minute,
            auto_arrive_minute: a.auto_arrive_minute,
            depart_at_minute: a.depart_at_minute,
            response_time_min: a.response_time_min,
            response_time_max: a.response_time_max,
            config: {
                ...JSON.parse(a.template_config || '{}'),
                ...JSON.parse(a.config_override || '{}')
            },
            // Session state
            status: a.session_status || 'absent',
            paged_at: a.paged_at,
            arrived_at: a.arrived_at,
            departed_at: a.departed_at
        }));

        res.json({ agents: parsed });
    } catch (err) {
        console.error('Session agents list error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:sessionId/agents/:agentType/page - Page an agent
router.post('/sessions/:sessionId/agents/:agentType/page', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;

        // Upsert the session state
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO agent_session_state (session_id, agent_type, status, paged_at)
                 VALUES (?, ?, 'paged', CURRENT_TIMESTAMP)
                 ON CONFLICT(session_id, agent_type) DO UPDATE SET
                 status = 'paged', paged_at = CURRENT_TIMESTAMP`,
                [sessionId, agentType],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        res.json({ success: true, message: `Agent ${agentType} paged` });
    } catch (err) {
        console.error('Page agent error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:sessionId/agents/:agentType/arrive - Mark agent as arrived
router.post('/sessions/:sessionId/agents/:agentType/arrive', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO agent_session_state (session_id, agent_type, status, arrived_at)
                 VALUES (?, ?, 'present', CURRENT_TIMESTAMP)
                 ON CONFLICT(session_id, agent_type) DO UPDATE SET
                 status = 'present', arrived_at = CURRENT_TIMESTAMP`,
                [sessionId, agentType],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        res.json({ success: true, message: `Agent ${agentType} arrived` });
    } catch (err) {
        console.error('Agent arrive error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:sessionId/agents/:agentType/depart - Mark agent as departed
router.post('/sessions/:sessionId/agents/:agentType/depart', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;

        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE agent_session_state SET status = 'departed', departed_at = CURRENT_TIMESTAMP
                 WHERE session_id = ? AND agent_type = ?`,
                [sessionId, agentType],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        res.json({ success: true, message: `Agent ${agentType} departed` });
    } catch (err) {
        console.error('Agent depart error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sessions/:sessionId/agents/:agentType/status - Get single agent status
router.get('/sessions/:sessionId/agents/:agentType/status', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;

        const state = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM agent_session_state WHERE session_id = ? AND agent_type = ?`,
                [sessionId, agentType],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        res.json({
            agent_type: agentType,
            status: state?.status || 'absent',
            paged_at: state?.paged_at || null,
            arrived_at: state?.arrived_at || null,
            departed_at: state?.departed_at || null
        });
    } catch (err) {
        console.error('Agent status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// -------------------- AGENT CONVERSATIONS --------------------

// GET /api/sessions/:sessionId/agents/:agentType/conversation - Get conversation history
router.get('/sessions/:sessionId/agents/:agentType/conversation', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;

        const messages = await new Promise((resolve, reject) => {
            db.all(
                `SELECT * FROM agent_conversations
                 WHERE session_id = ? AND agent_type = ?
                 ORDER BY created_at ASC`,
                [sessionId, agentType],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        res.json({ messages });
    } catch (err) {
        console.error('Agent conversation get error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:sessionId/agents/:agentType/conversation - Add message to conversation
router.post('/sessions/:sessionId/agents/:agentType/conversation', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;
        const { role, content } = req.body;

        if (!role || !content) {
            return res.status(400).json({ error: 'role and content are required' });
        }

        const result = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO agent_conversations (session_id, agent_type, role, content)
                 VALUES (?, ?, ?, ?)`,
                [sessionId, agentType, role, content],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });

        res.status(201).json({ id: result.id, message: 'Message added' });
    } catch (err) {
        console.error('Agent conversation add error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/sessions/:sessionId/agents/:agentType/conversation - Clear conversation
router.delete('/sessions/:sessionId/agents/:agentType/conversation', authenticateToken, async (req, res) => {
    try {
        const { sessionId, agentType } = req.params;

        await new Promise((resolve, reject) => {
            db.run(
                `DELETE FROM agent_conversations WHERE session_id = ? AND agent_type = ?`,
                [sessionId, agentType],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        res.json({ success: true, message: 'Conversation cleared' });
    } catch (err) {
        console.error('Agent conversation clear error:', err);
        res.status(500).json({ error: err.message });
    }
});

// -------------------- TEAM COMMUNICATIONS LOG --------------------

// GET /api/sessions/:sessionId/team-communications - Get team communications log
router.get('/sessions/:sessionId/team-communications', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;

        const log = await new Promise((resolve, reject) => {
            db.all(
                `SELECT * FROM team_communications_log
                 WHERE session_id = ?
                 ORDER BY created_at DESC`,
                [sessionId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        res.json({ log });
    } catch (err) {
        console.error('Team communications get error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sessions/:sessionId/team-communications - Add entry to team log
router.post('/sessions/:sessionId/team-communications', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { agent_type, key_points } = req.body;

        if (!agent_type || !key_points) {
            return res.status(400).json({ error: 'agent_type and key_points are required' });
        }

        const result = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO team_communications_log (session_id, agent_type, key_points)
                 VALUES (?, ?, ?)`,
                [sessionId, agent_type, key_points],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });

        res.status(201).json({ id: result.id, message: 'Entry added to team log' });
    } catch (err) {
        console.error('Team communications add error:', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
