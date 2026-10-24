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




import { auditSuccess } from './_helpers.js';
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

// A fileFilter rejection is the caller's mistake, not the server's: carry the
// status so middleware/errorHandler.js answers 415 instead of 500.
function unsupportedType(message) {
    const err = new Error(message);
    err.status = 415;
    err.code = 'unsupported_media_type';
    return err;
}

// File type validation
//
// SVG is intentionally NOT in the allowlist for /api/upload — uploaded files
// are served back from /uploads as-is, and an SVG with embedded <script> is
// stored XSS. The /api/upload-body-image route still accepts .svg because it
// renames the file into public/uploads/bodymap/<type>.svg (admin-only,
// controlled set of 4 filenames) and is meant for the body silhouette overlay.
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
        cb(unsupportedType(`Invalid file type. Allowed: ${allowedExts.join(', ')}`), false);
    }
};

// 25 MB: the largest thing this route legitimately carries is a short
// auscultation clip or a radiology video; the previous 100 MB cap was a
// disk-filling surface for any signed-in account (students included, before
// the educator gate below).
export const GENERIC_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: GENERIC_UPLOAD_MAX_BYTES
    }
});

// Leading bytes per image type (the same table casePackage.js uses for a
// package's media). The declared Content-Type and the extension are the
// client's claims; the bytes are what a browser will interpret. An HTML or SVG
// document renamed `.png` and served back from /uploads is stored XSS, so a
// declared image is accepted only when its bytes start like one.
function looksLikeImage(ext, head) {
    const at = (offset, text) => head.subarray(offset, offset + text.length).toString('latin1') === text;
    switch (ext) {
    case '.jpg': case '.jpeg': return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case '.png': return at(0, '\x89PNG\r\n\x1a\n');
    case '.gif': return at(0, 'GIF87a') || at(0, 'GIF89a');
    case '.webp': return at(0, 'RIFF') && at(8, 'WEBP');
    default: return false;
    }
}

function readHead(filePath, bytes = 16) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const head = Buffer.alloc(bytes);
        const n = fs.readSync(fd, head, 0, bytes, 0);
        return head.subarray(0, n);
    } finally {
        fs.closeSync(fd);
    }
}

/** True when a file declared as an image does not start like that image. */
function imageBytesMismatch(file) {
    if (!file.mimetype.startsWith('image/')) return false;
    const ext = path.extname(file.originalname).toLowerCase();
    return !looksLikeImage(ext, readHead(file.path));
}

function removeQuietly(filePath, log) {
    try { fs.unlinkSync(filePath); } catch (err) {
        log.warn('could not remove rejected upload', { path: filePath, error: err.message });
    }
}

// Separate multer for the body-image silhouette upload. That route renames
// the file into public/uploads/bodymap/<fixed-name>.svg|.png and is admin-only,
// so SVG is safe there even though it's stored XSS for the generic /upload route.
const bodyImageFileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const okMime = file.mimetype === 'image/png' || file.mimetype === 'image/svg+xml';
    const okExt = ext === '.png' || ext === '.svg';
    if (okMime && okExt) cb(null, true);
    else cb(unsupportedType('Body image must be PNG or SVG'), false);
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

// Authoring media (auscultation audio, radiology images/videos). Educator-gated:
// it is only ever called from the case editors, yet it used to accept any
// signed-in role, which made every student account a 100 MB-per-request
// writer into a publicly served directory. Audited like every other mutation.
router.post('/upload', authenticateToken, requireEducator, upload.single('photo'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    if (imageBytesMismatch(req.file)) {
        removeQuietly(req.file.path, req.log || routesCasesLog);
        return res.status(415).json({ error: 'The file does not look like the image type it declares', code: 'unsupported_media_type' });
    }
    auditSuccess(req, {
        action: 'upload_media',
        resourceType: 'upload',
        resourceId: req.file.filename,
        resourceName: req.file.originalname,
        newValue: { size: req.file.size, mimetype: req.file.mimetype },
    });
    const imageUrl = `./uploads/${req.file.filename}`;
    res.json({ imageUrl });
});

// ---------------------------------------------------------------------------
// Lessons module uploads — the contract the vendored lesson editor expects:
// multipart field `file`, response { success, data: { url, path, ... } } with a
// server-absolute `/uploads/<name>` url. Educator-gated (authoring only).
// SVG is excluded everywhere (stored-XSS); docs are allowed only on /uploads/file.
// ---------------------------------------------------------------------------
const DOC_MIME = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv', 'application/zip',
];
const DOC_EXT = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.csv', '.zip'];
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const VIDEO_MIME = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
const VIDEO_EXT = ['.mp4', '.webm', '.ogv', '.mov'];

function makeUpload(mimes, exts, maxBytesMB) {
    return multer({
        storage,
        limits: { fileSize: maxBytesMB * 1024 * 1024 },
        fileFilter: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            if (mimes.includes(file.mimetype) && exts.includes(ext)) cb(null, true);
            else cb(unsupportedType(`Invalid file type. Allowed: ${exts.join(', ')}`), false);
        },
    });
}
const imageUpload = makeUpload(IMAGE_MIME, IMAGE_EXT, 5);
const fileUpload = makeUpload([...DOC_MIME, ...IMAGE_MIME, ...VIDEO_MIME], [...DOC_EXT, ...IMAGE_EXT, ...VIDEO_EXT], 50);
const videoUpload = makeUpload(VIDEO_MIME, VIDEO_EXT, 200);

function sendUploaded(req, res) {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    if (imageBytesMismatch(req.file)) {
        removeQuietly(req.file.path, req.log || routesCasesLog);
        return res.status(415).json({ success: false, error: 'The file does not look like the image type it declares', code: 'unsupported_media_type' });
    }
    auditSuccess(req, {
        action: 'upload_media',
        resourceType: 'upload',
        resourceId: req.file.filename,
        resourceName: req.file.originalname,
        newValue: { size: req.file.size, mimetype: req.file.mimetype },
    });
    const url = `/uploads/${req.file.filename}`;
    const data = {
        url,
        path: url,
        originalName: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
    };
    // `url` at top level too, for resilience against differing client readers.
    res.json({ success: true, data, url });
}

router.post('/uploads/image', authenticateToken, requireEducator, imageUpload.single('file'), sendUploaded);
router.post('/uploads/file', authenticateToken, requireEducator, fileUpload.single('file'), sendUploaded);
router.post('/uploads/video', authenticateToken, requireEducator, videoUpload.single('file'), sendUploaded);

// --- BODY IMAGE UPLOAD (Admin Only) ---
// The four silhouette slots. Shared by the upload and the reset route so the
// two can never disagree about what a valid slot is.
const BODY_IMAGE_TYPES = ['man-front', 'man-back', 'woman-front', 'woman-back'];

router.post('/upload-body-image', authenticateToken, requireAdmin, uploadBodyImage.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const imageType = req.body.type;

    if (!BODY_IMAGE_TYPES.includes(imageType)) {
        // Delete the uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid image type. Must be one of: ' + BODY_IMAGE_TYPES.join(', ') });
    }

    // Get file extension
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.png', '.svg'].includes(ext)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Only PNG and SVG files are allowed' });
    }

    // Regression lock: body-image upload wrote to unserved public/ root (bug report 2.9.15 #13)
    // Only /uploads/* is statically served out of public/ (server.js); the SPA's
    // assets come from frontend/. Writing to the public/ ROOT therefore landed
    // where no reader looked — the upload "succeeded" but the image never
    // appeared. Uploaded silhouettes now live under public/uploads/bodymap/ and
    // are addressed by the returned `url`.
    const bodymapDir = path.join(__dirname, '../../public/uploads/bodymap');
    const targetPath = path.join(bodymapDir, `${imageType}${ext}`);
    const url = `/uploads/bodymap/${imageType}${ext}`;

    try {
        fs.mkdirSync(bodymapDir, { recursive: true });
        // Move file from the multer staging dir into the served location.
        fs.renameSync(req.file.path, targetPath);
        // Readers probe `<type>.png` before `<type>.svg` — drop the stale
        // other-extension file so it can't shadow the fresh upload.
        const staleTwin = path.join(bodymapDir, `${imageType}${ext === '.png' ? '.svg' : '.png'}`);
        if (fs.existsSync(staleTwin)) fs.unlinkSync(staleTwin);
        res.json({
            success: true,
            message: `Body image ${imageType} updated successfully`,
            url,
            path: url
        });
    } catch (err) {
        (req.log || routesCasesLog).error('body image save failed', { error: err.message });
        res.status(500).json({ error: 'Failed to save image: ' + err.message });
    }
});

// DELETE /api/body-image/:type - restore the bundled default silhouette.
//
// There is nothing to "reset" in a database: useBodyImage() probes
// /uploads/bodymap/<type>.png → .svg → the bundled /<type>.png, so removing
// the uploaded override IS the reset — the reader falls through to the
// default on its own. Both extensions go, because either one would keep
// shadowing the default (2.9.37 report, bug 4).
router.delete('/body-image/:type', authenticateToken, requireAdmin, (req, res) => {
    const imageType = req.params.type;
    if (!BODY_IMAGE_TYPES.includes(imageType)) {
        return res.status(400).json({
            error: 'Invalid image type. Must be one of: ' + BODY_IMAGE_TYPES.join(', '),
            code: 'INVALID_BODY_IMAGE_TYPE',
        });
    }

    const bodymapDir = path.join(__dirname, '../../public/uploads/bodymap');
    const removed = [];
    try {
        for (const ext of ['.png', '.svg']) {
            const candidate = path.join(bodymapDir, `${imageType}${ext}`);
            if (fs.existsSync(candidate)) {
                fs.unlinkSync(candidate);
                removed.push(`${imageType}${ext}`);
            }
        }
    } catch (err) {
        (req.log || routesCasesLog).error('body image reset failed', { error: err.message, type: imageType });
        return res.status(500).json({ error: 'Failed to reset image: ' + err.message });
    }

    // Idempotent: resetting a slot that never had an override is a success
    // with removed: [] — the slot is already showing the default.
    auditSuccess(req, {
        action: 'reset_body_image',
        resourceType: 'body_image',
        resourceId: imageType,
        resourceName: imageType,
        oldValue: { removed },
    });
    res.json({ success: true, type: imageType, removed, wasCustom: removed.length > 0 });
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

// What a saved region may look like: a flat object of strings and numbers
// (id, label, x, y, w, h, side …). The file is read back by every learner's
// body map without authentication, so a nested object or a megabyte of text
// must be refused here rather than written for everyone to download.
export const BODYMAP_REGIONS_MAX = 500;
export const BODYMAP_REGIONS_MAX_BYTES = 256 * 1024;

function regionsProblem(regions) {
    if (!Array.isArray(regions)) return 'regions must be an array';
    if (regions.length > BODYMAP_REGIONS_MAX) return `regions may hold at most ${BODYMAP_REGIONS_MAX} entries`;
    for (const [i, region] of regions.entries()) {
        if (region === null || typeof region !== 'object' || Array.isArray(region)) return `regions[${i}] must be an object`;
        for (const [key, value] of Object.entries(region)) {
            const ok = typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
            if (!ok) return `regions[${i}].${key} must be a string or a number`;
        }
    }
    if (Buffer.byteLength(JSON.stringify({ regions })) > BODYMAP_REGIONS_MAX_BYTES) {
        return `regions must serialise to at most ${BODYMAP_REGIONS_MAX_BYTES} bytes`;
    }
    return null;
}

// POST save body map regions (admin only — it rewrites a file every learner
// downloads, so it is platform configuration, not course authoring)
router.post('/bodymap-regions', authenticateToken, requireAdmin, (req, res) => {
    const { regions } = req.body;
    if (!regions) {
        return res.status(400).json({ error: 'No regions data provided' });
    }
    const why = regionsProblem(regions);
    if (why) return res.status(400).json({ error: why, code: 'invalid_regions' });

    try {
        fs.writeFileSync(BODYMAP_REGIONS_FILE, JSON.stringify({ regions }, null, 2));
        auditSuccess(req, {
            action: 'save_bodymap_regions',
            resourceType: 'bodymap_regions',
            resourceId: 'bodymap-regions',
            resourceName: 'Body map regions',
            newValue: { count: regions.length },
        });
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
