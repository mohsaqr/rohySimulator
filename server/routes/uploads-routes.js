import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
    authenticateToken,
    requireAdmin,
    requireEducator,
} from '../middleware/auth.js';




import { logger } from '../logger.js';



const radiologyLog = logger('radiology');
const routesCasesLog = logger('routes-cases-sessions');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let radiologyDatabase = [];
try {
    const radiologyPath = path.join(__dirname, '../data/radiology_database.json');
    if (fs.existsSync(radiologyPath)) {
        const data = JSON.parse(fs.readFileSync(radiologyPath, 'utf8'));
        radiologyDatabase = data.studies || [];
        radiologyLog.info('radiology database loaded', { count: radiologyDatabase.length });
    }
} catch (err) {
    radiologyLog.error('radiology database load failed', { error: err.message });
}

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../public/uploads');
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
//
// SVG is intentionally NOT in the allowlist for /api/upload — uploaded files
// are served back from /uploads as-is, and an SVG with embedded <script> is
// stored XSS. The /api/upload-body-image route still accepts .svg because it
// renames the file into /public/<type>.svg (admin-only, controlled set of 4
// filenames) and is meant for the body silhouette overlay.
const fileFilter = (req, file, cb) => {
    // Allowed MIME types for images, audio, and video
    const allowedMimes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        // audio
        'audio/mpeg',
        'audio/wav',
        'audio/ogg',
        'audio/webm',
        'audio/mp4',
        // video
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/quicktime',
        'video/x-msvideo',
        'video/mpeg'
    ];

    // Allowed extensions (must align with allowedMimes)
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp',
        '.mp3', '.wav', '.ogg', '.webm', '.m4a',
        '.mp4', '.mov', '.avi', '.ogv', '.mpeg', '.mpg'];
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
        fileSize: 100 * 1024 * 1024 // 100MB max
    }
});

// Separate multer for the body-image silhouette upload. That route renames
// the file into /public/<fixed-name>.svg|.png and is admin-only, so SVG is
// safe there even though it's stored XSS for the generic /upload route.
const bodyImageFileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const okMime = file.mimetype === 'image/png' || file.mimetype === 'image/svg+xml';
    const okExt = ext === '.png' || ext === '.svg';
    if (okMime && okExt) cb(null, true);
    else cb(new Error('Body image must be PNG or SVG'), false);
};
const uploadBodyImage = multer({
    storage,
    fileFilter: bodyImageFileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB cap is plenty for a silhouette
});

// ---------------------------------------------------------------------------
// Observability slice: routes — auth + users + tenants.
// Console logging in this route family now goes through req.log where possible,
// falling back to routes-auth-users-tenants for helper/background callbacks.
// ---------------------------------------------------------------------------
// --- AUTHENTICATION ---

// POST /api/auth/register - Register a new user

router.post('/upload', authenticateToken, upload.single('photo'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const imageUrl = `./uploads/${req.file.filename}`;
    res.json({ imageUrl });
});

// --- BODY IMAGE UPLOAD (Admin Only) ---
router.post('/upload-body-image', authenticateToken, requireAdmin, uploadBodyImage.single('image'), (req, res) => {
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
    const targetPath = path.join(__dirname, '../../public', `${imageType}${ext}`);

    try {
        // Move file from uploads to public folder with correct name
        fs.renameSync(req.file.path, targetPath);
        res.json({
            success: true,
            message: `Body image ${imageType} updated successfully`,
            path: `/${imageType}${ext}`
        });
    } catch (err) {
        (req.log || routesCasesLog).error('body image save failed', { error: err.message });
        res.status(500).json({ error: 'Failed to save image: ' + err.message });
    }
});

// --- BODY MAP REGIONS ---
const BODYMAP_REGIONS_FILE = path.join(__dirname, '../../public/bodymap-regions.json');

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
        (req.log || routesCasesLog).error('bodymap regions read failed', { error: err.message });
        res.status(500).json({ error: 'Failed to read regions' });
    }
});

// POST save body map regions (admin only)
router.post('/bodymap-regions', authenticateToken, requireEducator, (req, res) => {
    const { regions } = req.body;
    if (!regions) {
        return res.status(400).json({ error: 'No regions data provided' });
    }

    try {
        fs.writeFileSync(BODYMAP_REGIONS_FILE, JSON.stringify({ regions }, null, 2));
        res.json({ success: true, message: 'Body map regions saved' });
    } catch (err) {
        (req.log || routesCasesLog).error('bodymap regions save failed', { error: err.message });
        res.status(500).json({ error: 'Failed to save regions: ' + err.message });
    }
});

// ---------------------------------------------------------------------------
// Observability slice: routes — cases + sessions.
// Request-scoped warnings/errors now use req.log; shared case/session helpers
// use routes-cases-sessions.
// ---------------------------------------------------------------------------
// --- CASES ---

// GET /api/cases - Authenticated users can view cases (students only see available cases)

export default router;
