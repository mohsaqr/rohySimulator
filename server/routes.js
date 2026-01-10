import express from 'express';
import db from './db.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { authenticateToken, requireAdmin, requireAuth, generateToken } from './middleware/auth.js';
import * as labDb from './services/labDatabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure Multer for local uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../public/uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// --- AUTHENTICATION ---

// POST /api/auth/register - Register a new user
router.post('/auth/register', async (req, res) => {
    const { username, name, email, password, role = 'user' } = req.body;

    // Validation
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
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

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
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
                return res.status(500).json({ error: err.message });
            }

            res.status(201).json({
                message: 'User created successfully',
                user: { id: this.lastID, username, name, email, role }
            });
        });
    } catch (err) {
        res.status(500).json({ error: 'Error creating user', details: err.message });
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

        if (password.length < 6) {
            results.failed.push({ 
                username,
                name, 
                email, 
                error: 'Password must be at least 6 characters' 
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
router.post('/auth/login', (req, res) => {
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

            const token = generateToken(user);
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
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ imageUrl });
});

// --- CASES ---

// GET /api/cases - Authenticated users can view cases
router.get('/cases', authenticateToken, (req, res) => {
    db.all("SELECT * FROM cases ORDER BY created_at DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Parse JSON fields
        const cases = rows.map(row => ({
            ...row,
            config: row.config ? JSON.parse(row.config) : {},
            scenario: row.scenario ? JSON.parse(row.scenario) : null
        }));
        
        res.json({ cases });
    });
});

// POST /api/cases - Admin only
router.post('/cases', authenticateToken, requireAdmin, (req, res) => {
    const { name, description, system_prompt, config, image_url, scenario } = req.body;
    const sql = `INSERT INTO cases (name, description, system_prompt, config, image_url, scenario) VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [
        name, 
        description, 
        system_prompt, 
        JSON.stringify(config || {}), 
        image_url || null,
        scenario ? JSON.stringify(scenario) : null
    ];

    db.run(sql, params, function (err) {
        if (err) {
            console.error('Error saving case:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID, ...req.body });
    });
});

// PUT /api/cases/:id - Admin only
router.put('/cases/:id', authenticateToken, requireAdmin, (req, res) => {
    const { name, description, system_prompt, config, image_url, scenario } = req.body;
    const sql = `UPDATE cases SET name = ?, description = ?, system_prompt = ?, config = ?, image_url = ?, scenario = ? WHERE id = ?`;
    const params = [
        name, 
        description, 
        system_prompt, 
        JSON.stringify(config || {}), 
        image_url || null,
        scenario ? JSON.stringify(scenario) : null,
        req.params.id
    ];

    db.run(sql, params, function (err) {
        if (err) {
            console.error('Error updating case:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: req.params.id, ...req.body });
    });
});

// DELETE /api/cases/:id - Admin only
router.delete('/cases/:id', authenticateToken, requireAdmin, (req, res) => {
    const sql = `DELETE FROM cases WHERE id = ?`;
    db.run(sql, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Case not found' });
        }
        res.json({ message: 'Case deleted successfully', id: req.params.id });
    });
});

// --- SESSIONS ---

// POST /api/sessions - Authenticated users only
router.post('/sessions', authenticateToken, (req, res) => {
    const { case_id, student_name, llm_settings, monitor_settings } = req.body;
    const user_id = req.user.id;
    const sql = `INSERT INTO sessions (case_id, user_id, student_name, llm_settings, monitor_settings) VALUES (?, ?, ?, ?, ?)`;

    db.run(sql, [
        case_id, 
        user_id, 
        student_name || req.user.username,
        JSON.stringify(llm_settings || {}),
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
            llm_settings?.provider, llm_settings?.model, llm_settings?.baseUrl,
            monitor_settings?.hr, monitor_settings?.rhythm, monitor_settings?.spo2,
            monitor_settings?.bp_sys, monitor_settings?.bp_dia, monitor_settings?.rr, monitor_settings?.temp,
            JSON.stringify({ llm: llm_settings, monitor: monitor_settings })
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
    const sql = `SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ users: rows });
    });
});

// GET /api/users/:id - Get user details (Admin only)
router.get('/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const sql = `SELECT id, username, email, role, created_at FROM users WHERE id = ?`;
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
        // If password is provided, hash it
        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters' });
            }
            const password_hash = await bcrypt.hash(password, 10);
            const sql = `UPDATE users SET username = ?, name = ?, email = ?, role = ?, password_hash = ? WHERE id = ?`;
            db.run(sql, [username, name || null, email, role, password_hash, req.params.id], function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(409).json({ error: 'Username or email already exists' });
                    }
                    return res.status(500).json({ error: err.message });
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
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'User not found' });
                }
                res.json({ message: 'User updated successfully', id: req.params.id });
            });
        }
    } catch (err) {
        res.status(500).json({ error: 'Error updating user', details: err.message });
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

    events.forEach(event => {
        stmt.run(
            session_id,
            event.event_type,
            event.description,
            event.vital_sign || null,
            event.old_value || null,
            event.new_value || null,
            event.timestamp
        );
        inserted++;
    });

    stmt.finalize((err) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: `${inserted} events logged` });
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

    investigation_ids.forEach(invId => {
        stmt.run(sessionId, invId, invId);
        inserted++;
    });

    stmt.finalize((err) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: `${inserted} investigations ordered` });
    });
});

// GET /api/sessions/:id/orders - Get all orders for session
router.get('/sessions/:id/orders', authenticateToken, (req, res) => {
    const sessionId = req.params.id;
    
    const sql = `
        SELECT 
            io.*,
            ci.investigation_type,
            ci.test_name,
            ci.result_data,
            ci.image_url,
            ci.turnaround_minutes
        FROM investigation_orders io
        JOIN case_investigations ci ON io.investigation_id = ci.id
        WHERE io.session_id = ?
        ORDER BY io.ordered_at DESC
    `;
    
    db.all(sql, [sessionId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        // Parse JSON result_data
        const orders = rows.map(row => ({
            ...row,
            result_data: row.result_data ? JSON.parse(row.result_data) : null,
            is_ready: new Date(row.available_at) <= new Date()
        }));
        
        res.json({ orders });
    });
});

// PUT /api/orders/:id/view - Mark investigation as viewed
router.put('/orders/:id/view', authenticateToken, (req, res) => {
    const orderId = req.params.id;
    
    const sql = `UPDATE investigation_orders SET viewed_at = CURRENT_TIMESTAMP WHERE id = ?`;
    
    db.run(sql, [orderId], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'Investigation marked as viewed' });
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
        
        // Parse case config
        const caseConfig = JSON.parse(session.config || '{}');
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
        
        db.all(labsSql, [session.case_id], (err, configuredLabs) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            if (defaultLabsEnabled) {
                // Return ALL labs from database, with configured abnormals overriding normals
                const allLabs = labDb.loadLabDatabase();
                const patientGender = caseConfig.demographics?.gender || 'Male';
                
                // Create a map of configured labs by test name
                const configuredMap = {};
                configuredLabs.forEach(lab => {
                    configuredMap[lab.test_name] = lab;
                });
                
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
                        responseLabs.push({
                            ...configuredMap[testName],
                            normal_samples: JSON.parse(configuredMap[testName].normal_samples || '[]'),
                            source: 'configured'
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
                // Only return configured labs
                const parsedLabs = configuredLabs.map(lab => ({
                    ...lab,
                    normal_samples: JSON.parse(lab.normal_samples || '[]'),
                    source: 'configured'
                }));
                
                res.json({ labs: parsedLabs, defaultLabsEnabled: false });
            }
        });
    });
});

// POST /api/sessions/:sessionId/order-labs - Order multiple lab tests
router.post('/sessions/:sessionId/order-labs', authenticateToken, (req, res) => {
    const { sessionId } = req.params;
    const { lab_ids } = req.body; // Array of lab investigation IDs or default_ IDs
    
    if (!Array.isArray(lab_ids) || lab_ids.length === 0) {
        return res.status(400).json({ error: 'lab_ids array is required' });
    }
    
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
        
        // Separate configured IDs from default IDs
        const configuredIds = lab_ids.filter(id => !String(id).startsWith('default_'));
        const defaultIds = lab_ids.filter(id => String(id).startsWith('default_'));
        
        // Process all IDs and create orders
        const processOrders = () => {
            const sql = `
                INSERT INTO investigation_orders (session_id, investigation_id, ordered_at, available_at) 
                VALUES (?, ?, datetime('now'), datetime('now', '+' || ? || ' minutes'))
            `;
            
            const stmt = db.prepare(sql);
            let inserted = 0;
            const orderIds = [];
            
            // Get configured labs
            if (configuredIds.length > 0) {
                const labsSql = `SELECT id, turnaround_minutes, test_name FROM case_investigations WHERE id IN (${configuredIds.map(() => '?').join(',')})`;
                
                db.all(labsSql, configuredIds, (err, labs) => {
                    if (err) {
                        console.error('Error fetching labs:', err);
                    } else {
                        labs.forEach(lab => {
                            stmt.run(sessionId, lab.id, lab.turnaround_minutes || 30, function(err) {
                                if (!err) {
                                    orderIds.push({ id: this.lastID, test_name: lab.test_name });
                                    inserted++;
                                }
                            });
                        });
                    }
                    
                    finalizeOrders();
                });
            } else {
                finalizeOrders();
            }
            
            function finalizeOrders() {
                stmt.finalize((err) => {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    
                    // Log event
                    db.run(
                        `INSERT INTO event_log (session_id, event_type, description) VALUES (?, ?, ?)`,
                        [sessionId, 'investigation_ordered', `Ordered ${inserted} lab tests`]
                    );
                    
                    res.json({ 
                        message: `${inserted} lab tests ordered`,
                        orders: orderIds
                    });
                });
            }
        };
        
        // Create case_investigations entries for default labs if needed
        if (defaultIds.length > 0) {
            // Extract test names from default IDs
            const testNames = defaultIds.map(id => String(id).replace('default_', '').replace(/_/g, ' '));
            
            // Get case config to determine patient gender
            db.get('SELECT config FROM cases WHERE id = ?', [session.case_id], (err, caseRow) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                
                const caseConfig = JSON.parse(caseRow?.config || '{}');
                const patientGender = caseConfig.demographics?.gender || 'Male';
                
                // Create case_investigations for each default lab
                const insertLabSql = `
                    INSERT INTO case_investigations (
                        case_id, investigation_type, test_name, test_group, gender_category,
                        min_value, max_value, current_value, unit, normal_samples,
                        is_abnormal, turnaround_minutes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                let created = 0;
                testNames.forEach(testName => {
                    const genderSpecific = labDb.getGenderSpecificTest(testName, patientGender);
                    if (genderSpecific) {
                        const normalValue = labDb.getRandomNormalValue(genderSpecific);
                        
                        db.run(insertLabSql, [
                            session.case_id, 'lab', genderSpecific.test_name, genderSpecific.group, genderSpecific.category,
                            genderSpecific.min_value, genderSpecific.max_value, normalValue, genderSpecific.unit,
                            JSON.stringify(genderSpecific.normal_samples), 0, 30
                        ], function(err) {
                            if (!err) {
                                // Add to configured IDs
                                configuredIds.push(this.lastID);
                                created++;
                            }
                            
                            // When all created, process orders
                            if (created === testNames.length) {
                                processOrders();
                            }
                        });
                    } else {
                        created++;
                        if (created === testNames.length) {
                            processOrders();
                        }
                    }
                });
            });
        } else {
            processOrders();
        }
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
            [sessionId, 'lab_value_edited', `Instructor edited lab value for test ID ${labId} to ${current_value}`]
        );
        
        res.json({ 
            message: 'Lab value updated',
            new_value: current_value
        });
    });
});

// --- LLM PROXY ROUTE to avoid CORS ---
router.post('/proxy/llm', async (req, res) => {
    const { targetUrl, body, headers } = req.body;

    try {
        console.log(`[Proxy] Forwarding to: ${targetUrl}`);
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: headers || { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[Proxy] Error ${response.status}: ${errText}`);
            return res.status(response.status).json({ error: errText });
        }

        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('[Proxy] Failure:', err);
        res.status(500).json({ error: "Proxy Request Failed", details: err.message });
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

export default router;
