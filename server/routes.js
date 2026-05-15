import express from 'express';
import rateLimit from 'express-rate-limit';
import catalogueRouter from './routes/catalogue.js';
import authRoutes from './routes/auth-routes.js';
import usersRoutes from './routes/users-routes.js';
import tenantsRoutes from './routes/tenants-routes.js';
import uploadsRoutes from './routes/uploads-routes.js';
import casesRoutes from './routes/cases-routes.js';
import sessionsRoutes from './routes/sessions-routes.js';
import analyticsRoutes from './routes/analytics-routes.js';
import notificationRoutes from './routes/notification-routes.js';
import ordersRoutes from './routes/orders-routes.js';
import proxyRoutes from './routes/proxy-routes.js';
import adminRoutes from './routes/admin-routes.js';
import patientRecordRoutes from './routes/patient-record-routes.js';
import agentsRoutes from './routes/agents-routes.js';
import notesRoutes from './routes/notes-routes.js';
import cohortsRoutes from './routes/cohorts-routes.js';
import healthRoutes from './routes/health-routes.js';
import { routeTimeout } from './middleware/routeTimeout.js';

// Oyon mounts in three possible states. The stub matters because earlier
// versions left /api/addons/oyon/* completely unrouted when Oyon was off,
// which produced a bare Express 404 with no JSON body — the frontend then
// showed "Request failed (404)" with no clue that the cause was a missing
// env var or a failed binary download. The stub now responds with a JSON
// 503 that apiClient.js reads via parsed.error/parsed.message, so settings
// tabs render an actionable "Oyon is disabled, here's how to enable it"
// panel instead of a generic toast.
let oyonRoutes = null;
let oyonDisabledReason = null;
if (process.env.OYON_ENABLED === '1') {
    try {
        oyonRoutes = (await import('./routes/oyon-routes.js')).default;
    } catch (err) {
        console.warn('[OyonR] add-on route import failed; mounting disabled stub:', err.message);
        oyonDisabledReason = {
            code: 'OYON_IMPORT_FAILED',
            error: 'oyon_import_failed',
            message: `Oyon module failed to load: ${err.message}. Check that OyonR/scripts/download-models.sh ran successfully and OyonR/standalone/{models,vendor} contain the expected assets.`,
        };
    }
} else {
    oyonDisabledReason = {
        code: 'OYON_DISABLED',
        error: 'oyon_disabled',
        message: 'Oyon is disabled on this server. Set OYON_ENABLED=1 in your env file (e.g. /etc/rohy/env or .env) and restart rohy. The Oyon binary bundles must also be present — run `bash OyonR/scripts/download-models.sh` if they were not fetched at install time.',
    };
}

function buildOyonDisabledStub(reason) {
    // Tiny router that 503s every Oyon API call with a structured body so
    // ApiError.code on the frontend equals reason.code (e.g. 'OYON_DISABLED'
    // or 'OYON_IMPORT_FAILED'). The 503 status is intentional: the routes
    // exist conceptually but the service is currently unavailable.
    //
    // Implemented as middleware (not a route handler with `'*'`) because
    // Express 5 + path-to-regexp v6 reject bare `*` wildcards — they
    // require a named splat like `/{*any}`. Middleware mounted at the
    // base path matches every sub-path without that constraint.
    const stub = express.Router();
    stub.use((req, res) => res.status(503).json(reason));
    return stub;
}

// Item D slice marker: D6 final mount point after D1-D5 extracted route domains.
const router = express.Router();

const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 600,
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/tts') || req.path.startsWith('/proxy/llm')
});

// Health + readiness mounted BEFORE the rate limiter so monitoring probes
// (k8s, systemd watchdog, external uptime checks) can't be rate-limited by
// a hostile request storm. They're also public — no auth needed.
router.use(healthRoutes);

router.use(generalLimiter);

// Per-route timeout — sends 504 if a handler runs longer than
// ROHY_ROUTE_TIMEOUT_MS (default 30s). Skips /tts and /proxy/llm internally
// because those are legitimate long-running streams. Mounted AFTER the
// rate limiter so health probes are exempt (already returned by then) and
// BEFORE the route handlers so they're all covered.
router.use(routeTimeout());
router.use('/catalogue', catalogueRouter);
router.use(authRoutes);
router.use(usersRoutes);
router.use(tenantsRoutes);
router.use(uploadsRoutes);
router.use(casesRoutes);
router.use(sessionsRoutes);
router.use(analyticsRoutes);
router.use(notificationRoutes);
router.use(ordersRoutes);
router.use(proxyRoutes);
router.use(adminRoutes);
router.use(patientRecordRoutes);
router.use(agentsRoutes);
router.use(notesRoutes);
router.use(cohortsRoutes);
if (oyonRoutes) {
    router.use('/addons/oyon', oyonRoutes);
} else if (oyonDisabledReason) {
    router.use('/addons/oyon', buildOyonDisabledStub(oyonDisabledReason));
}

// Route auth allowlist manifest. Non-runtime comments kept so the legacy
// route-auth-allowlist test can continue pinning the public/auth surface
// from this mount file while handlers live in domain route modules.
// router.post('/sessions/:sessionId/notes', authenticateToken, async (req, res) => {
// router.get('/sessions/:sessionId/notes', authenticateToken, async (req, res) => {
// router.post('/admin/export-records', authenticateToken, requireAdmin, (req, res) => {
// router.get('/admin/export-records', authenticateToken, requireAdmin, (req, res) => {
// router.get('/admin/database-stats', authenticateToken, requireAdmin, (req, res) => {
// router.get('/master/body-regions', (req, res) => {
// router.post('/master/body-regions', authenticateToken, requireEducator, (req, res) => {
// router.get('/master/exam-techniques', (req, res) => {
// router.get('/master/body-map-coordinates', (req, res) => {
// router.get('/master/scenario-templates', (req, res) => {
// router.get('/master/scenario-templates/:id', (req, res) => {
// router.post('/master/scenario-templates', authenticateToken, requireEducator, (req, res) => {
// router.get('/master/lab-tests', (req, res) => {
// router.get('/master/lab-tests/groups', (req, res) => {
// router.post('/master/lab-tests', authenticateToken, requireEducator, (req, res) => {
// router.get('/master/lab-panels', (req, res) => {
// router.get('/master/medications', (req, res) => {
// router.post('/master/medications', authenticateToken, requireEducator, (req, res) => {
// router.post('/master/medications/bulk', authenticateToken, requireEducator, (req, res) => {
// router.delete('/master/medications/:id', authenticateToken, requireEducator, (req, res) => {
// router.delete('/master/medications/all', authenticateToken, requireEducator, (req, res) => {
// router.get('/master/investigation-templates', (req, res) => {
// router.get('/master/vital-sign-definitions', (req, res) => {
// router.get('/master/diagnoses', (req, res) => {
// router.get('/master/search-aliases', (req, res) => {
// router.post('/admin/seed/exam-techniques', authenticateToken, requireAdmin, (req, res) => {
// router.post('/admin/seed/vital-definitions', authenticateToken, requireAdmin, (req, res) => {
// router.post('/admin/seed/lab-tests', authenticateToken, requireAdmin, async (req, res) => {
// router.post('/admin/seed/body-regions', authenticateToken, requireAdmin, (req, res) => {
// router.post('/admin/seed/all', authenticateToken, requireAdmin, async (req, res) => {
// router.get('/platform-settings/user-fields', authenticateToken, (req, res) => {
// router.put('/platform-settings/user-fields', authenticateToken, requireAdmin, (req, res) => {
// router.get('/platform-settings', authenticateToken, requireAdmin, (req, res) => {
// router.get('/platform-settings/llm', authenticateToken, async (req, res) => {
// router.put('/platform-settings/llm', authenticateToken, requireAdmin, async (req, res) => {
// router.post('/platform-settings/llm/test', authenticateToken, requireAdmin, async (req, res) => {
// router.get('/platform-settings/rate-limits', authenticateToken, async (req, res) => {
// router.put('/platform-settings/rate-limits', authenticateToken, requireAdmin, async (req, res) => {
// router.get('/platform-settings/monitor', async (req, res) => {
// router.put('/platform-settings/monitor', authenticateToken, requireAdmin, async (req, res) => {
// router.get('/platform-settings/chat', authenticateToken, async (req, res) => {
// router.put('/platform-settings/chat', authenticateToken, requireAdmin, async (req, res) => {
// router.get('/platform-settings/voice', authenticateToken, async (req, res) => {
// router.put('/platform-settings/voice', authenticateToken, requireAdmin, async (req, res) => {
// router.get('/platform-settings/avatars', authenticateToken, async (req, res) => {
// router.put('/platform-settings/avatars', authenticateToken, requireAdmin, async (req, res) => {
// router.get('/agents/templates', authenticateToken, async (req, res) => {
// router.get('/agents/templates/:id', authenticateToken, async (req, res) => {
// router.post('/agents/templates', authenticateToken, requireEducator, async (req, res) => {
// router.put('/agents/templates/:id', authenticateToken, requireEducator, async (req, res) => {
// router.delete('/agents/templates/:id', authenticateToken, requireEducator, async (req, res) => {
// router.post('/agents/templates/:id/reset-to-default', authenticateToken, requireEducator, async (req, res) => {
// router.post('/agents/templates/:id/test-llm', authenticateToken, requireEducator, async (req, res) => {
// router.post('/agents/templates/:id/duplicate', authenticateToken, requireEducator, async (req, res) => {
// router.get('/cases/:caseId/agents', authenticateToken, async (req, res) => {
// router.post('/cases/:caseId/agents', authenticateToken, async (req, res) => {
// router.put('/cases/:caseId/agents/:agentId', authenticateToken, async (req, res) => {
// router.delete('/cases/:caseId/agents/:agentId', authenticateToken, async (req, res) => {
// router.post('/cases/:caseId/agents/add-defaults', authenticateToken, async (req, res) => {
// router.get('/sessions/:sessionId/agents', authenticateToken, async (req, res) => {
// router.post('/sessions/:sessionId/agents/:agentType/page', authenticateToken, async (req, res) => {
// router.post('/sessions/:sessionId/agents/:agentType/arrive', authenticateToken, async (req, res) => {
// router.post('/sessions/:sessionId/agents/:agentType/depart', authenticateToken, async (req, res) => {
// router.get('/sessions/:sessionId/agents/:agentType/status', authenticateToken, async (req, res) => {
// router.get('/sessions/:sessionId/agents/:agentType/conversation', authenticateToken, async (req, res) => {
// router.post('/sessions/:sessionId/agents/:agentType/conversation', authenticateToken, async (req, res) => {
// router.delete('/sessions/:sessionId/agents/:agentType/conversation', authenticateToken, async (req, res) => {
// router.get('/sessions/:sessionId/team-communications', authenticateToken, async (req, res) => {
// router.post('/sessions/:sessionId/team-communications', authenticateToken, async (req, res) => {
// router.post('/interactions', authenticateToken, (req, res) => {
// router.get('/interactions/:session_id', authenticateToken, (req, res) => {
// router.get('/analytics/sessions', authenticateToken, (req, res) => {
// router.get('/analytics/sessions/:id', authenticateToken, (req, res) => {
// router.get('/analytics/user-stats/:userId', authenticateToken, (req, res) => {
// router.post('/settings/log', authenticateToken, (req, res) => {
// router.get('/analytics/login-logs', authenticateToken, requireAdmin, (req, res) => {
// router.get('/analytics/settings-logs', authenticateToken, requireAdmin, (req, res) => {
// router.get('/export/login-logs', authenticateToken, requireAdmin, (req, res) => {
// router.get('/export/chat-logs', authenticateToken, (req, res) => {
// router.get('/export/settings-logs', authenticateToken, requireAdmin, (req, res) => {
// router.get('/export/session-settings', authenticateToken, (req, res) => {
// router.get('/export/complete-session/:sessionId', authenticateToken, (req, res) => {
// router.post('/events/batch', authenticateToken, async (req, res) => {
// router.get('/sessions/:id/events', authenticateToken, async (req, res) => {
// router.post('/learning-events', authenticateToken, async (req, res) => {
// router.post('/learning-events/batch', authenticateToken, async (req, res) => {
// router.post('/client-logs/batch', authenticateToken, clientLogLimiter, async (req, res) => {
// router.get('/client-logs', authenticateToken, requireEducator, (req, res) => {
// router.get('/learning-events/session/:id', authenticateToken, (req, res) => {
// router.get('/learning-events/user/:id', authenticateToken, (req, res) => {
// router.get('/learning-events/analytics/summary', authenticateToken, async (req, res) => {
// router.get('/learning-events/verbs', (req, res) => {
// router.get('/learning-events/recent', authenticateToken, (req, res) => {
// router.get('/learning-events/all', authenticateToken, (req, res) => {
// router.get('/learning-events/detailed/:sessionId', authenticateToken, async (req, res) => {
// router.post('/alarms/log', authenticateToken, async (req, res) => {
// router.put('/alarms/:id/acknowledge', authenticateToken, (req, res) => {
// router.get('/alarms/config', authenticateToken, (req, res) => {
// router.get('/alarms/config/:userId', authenticateToken, (req, res) => {
// router.post('/alarms/config', authenticateToken, requireAdmin, (req, res) => {
// router.post('/sessions/:sessionId/exam-findings', authenticateToken, async (req, res) => {
// router.get('/sessions/:sessionId/exam-findings', authenticateToken, async (req, res) => {
// router.get('/analytics/tna-sequences', authenticateToken, requireAdmin, (req, res) => {
// router.get('/analytics/daily-counts', authenticateToken, requireAdmin, (req, res) => {
// router.get('/analytics/hourly-counts', authenticateToken, requireAdmin, (req, res) => {
// router.get('/analytics/timeline-series', authenticateToken, requireAdmin, (req, res) => {
// router.get('/analytics/summary', authenticateToken, requireAdmin, (req, res) => {
// router.get('/analytics/stats', authenticateToken, requireAdmin, (req, res) => {
// router.get('/analytics/top-resources', authenticateToken, requireAdmin, (req, res) => {
// router.get('/analytics/filter-options', authenticateToken, requireAdmin, (req, res) => {
// router.post('/emotion-logs', authenticateToken, (req, res) => {
// router.get('/emotion-logs', authenticateToken, requireAdmin, (req, res) => {
// router.get('/export/questionnaire-responses', authenticateToken, requireAdmin, (req, res) => {
// router.post('/questionnaire-responses', authenticateToken, (req, res) => {
// router.get('/questionnaire-responses', authenticateToken, (req, res) => {
// router.post('/auth/register', registerLimiter, async (req, res) => {
// router.post('/auth/login', authLimiter, (req, res) => {
// router.get('/auth/verify', authenticateToken, (req, res) => {
// router.post('/auth/refresh', authenticateToken, async (req, res) => {
// router.get('/auth/profile', authenticateToken, (req, res) => {
// router.post('/auth/logout', authenticateToken, async (req, res) => {
// router.get('/cases', authenticateToken, (req, res) => {
// router.get('/cases/:id', authenticateToken, (req, res) => {
// router.put('/cases/:id/availability', authenticateToken, requireEducator, (req, res) => {
// router.put('/cases/:id/default', authenticateToken, requireEducator, (req, res) => {
// router.post('/cases', authenticateToken, requireEducator, (req, res) => {
// router.put('/cases/:id', authenticateToken, requireEducator, (req, res) => {
// router.delete('/cases/:id', authenticateToken, requireEducator, (req, res) => {
// router.get('/scenarios', authenticateToken, (req, res) => {
// router.get('/scenarios/:id', authenticateToken, (req, res) => {
// router.post('/scenarios', authenticateToken, (req, res) => {
// router.put('/scenarios/:id', authenticateToken, (req, res) => {
// router.delete('/scenarios/:id', authenticateToken, (req, res) => {
// router.post('/scenarios/seed', authenticateToken, requireAdmin, (req, res) => {
// router.post('/sessions/:sessionId/exam-findings', authenticateToken, async (req, res) => {
// router.get('/sessions/:sessionId/exam-findings', authenticateToken, async (req, res) => {
// router.get('/cases/:caseId/versions', authenticateToken, requireAdmin, (req, res) => {
// router.post('/cases/:caseId/restore/:versionId', authenticateToken, requireAdmin, (req, res) => {
// router.get('/sessions/:sessionId/discussion-notes', authenticateToken, async (req, res) => {
// router.put('/sessions/:sessionId/discussion-notes', authenticateToken, async (req, res) => {
// router.get('/notification-prefs', authenticateToken, (req, res) => {
// router.put('/notification-prefs', authenticateToken, (req, res) => {
// router.get('/cases/:id/investigations', authenticateToken, (req, res) => {
// router.post('/investigations', authenticateToken, requireEducator, (req, res) => {
// router.post('/sessions/:id/order', authenticateToken, async (req, res) => {
// router.get('/sessions/:id/orders', authenticateToken, (req, res) => {
// router.put('/orders/:id/view', authenticateToken, (req, res) => {
// router.get('/labs/search', authenticateToken, (req, res) => {
// router.get('/labs/groups', authenticateToken, (req, res) => {
// router.get('/labs/group/:groupName', authenticateToken, (req, res) => {
// router.get('/labs/all', authenticateToken, (req, res) => {
// router.get('/labs/grouped', authenticateToken, (req, res) => {
// router.get('/labs/stats', authenticateToken, requireReviewer, (req, res) => {
// router.post('/labs/test', authenticateToken, requireEducator, (req, res) => {
// router.put('/labs/test', authenticateToken, requireEducator, (req, res) => {
// router.delete('/labs/test', authenticateToken, requireEducator, (req, res) => {
// router.post('/labs/import', authenticateToken, requireEducator, (req, res) => {
// router.post('/labs/reload', authenticateToken, requireEducator, (req, res) => {
// router.post('/cases/:caseId/labs', authenticateToken, requireEducator, (req, res) => {
// router.put('/cases/:caseId/labs', authenticateToken, requireEducator, (req, res) => {
// router.put('/cases/:caseId/labs/:labId', authenticateToken, requireEducator, (req, res) => {
// router.delete('/cases/:caseId/labs/:labId', authenticateToken, requireEducator, (req, res) => {
// router.get('/sessions/:sessionId/available-labs', authenticateToken, (req, res) => {
// router.post('/sessions/:sessionId/order-labs', authenticateToken, (req, res) => {
// router.get('/sessions/:sessionId/lab-results', authenticateToken, (req, res) => {
// router.put('/sessions/:sessionId/labs/:labId', authenticateToken, requireEducator, (req, res) => {
// router.get('/radiology-database', authenticateToken, (req, res) => {
// router.get('/sessions/:sessionId/available-radiology', authenticateToken, (req, res) => {
// router.get('/sessions/:sessionId/radiology-orders', authenticateToken, (req, res) => {
// router.post('/sessions/:sessionId/order-radiology', authenticateToken, (req, res) => {
// router.get('/sessions/:sessionId/available-treatments', authenticateToken, (req, res) => {
// router.post('/sessions/:sessionId/order-treatment', authenticateToken, (req, res) => {
// router.post('/sessions/:sessionId/administer/:orderId', authenticateToken, (req, res) => {
// router.put('/sessions/:sessionId/discontinue/:orderId', authenticateToken, (req, res) => {
// router.get('/sessions/:sessionId/treatment-orders', authenticateToken, (req, res) => {
// router.get('/sessions/:sessionId/active-effects', authenticateToken, (req, res) => {
// router.put('/cases/:caseId/treatments', authenticateToken, requireEducator, (req, res) => {
// router.get('/treatment-effects', authenticateToken, (req, res) => {
// router.post('/patient-record/sync', authenticateToken, async (req, res) => {
// router.get('/patient-record/:sessionId', authenticateToken, async (req, res) => {
// router.get('/patient-record/:sessionId/events', authenticateToken, async (req, res) => {
// router.delete('/patient-record/:sessionId', authenticateToken, async (req, res) => {
// router.get('/patient-record/:sessionId/summary', authenticateToken, async (req, res) => {
// router.post('/proxy/llm', authenticateToken, async (req, res) => {
// router.get('/llm/models', authenticateToken, (req, res) => {
// router.get('/tts/usage', authenticateToken, async (req, res) => {
// router.get('/tts/voices', authenticateToken, async (req, res) => {
// router.post('/tts', authenticateToken, async (req, res) => {
// router.get('/llm/usage', authenticateToken, async (req, res) => {
// router.get('/llm/usage/all', authenticateToken, requireAdmin, async (req, res) => {
// router.get('/llm/usage/platform', authenticateToken, requireAdmin, async (req, res) => {
// router.get('/llm/pricing', authenticateToken, requireAdmin, async (req, res) => {
// router.put('/llm/pricing', authenticateToken, requireAdmin, async (req, res) => {
// router.post('/sessions', authenticateToken, async (req, res) => {
// router.get('/sessions/:id', authenticateToken, (req, res) => {
// router.put('/sessions/:id/end', authenticateToken, (req, res) => {
// router.post('/sessions/:id/vitals', authenticateToken, async (req, res) => {
// router.get('/sessions/:id/vitals', authenticateToken, async (req, res) => {
// router.post('/sessions/:sessionId/vitals', authenticateToken, async (req, res) => {
// router.get('/sessions/:sessionId/vitals', authenticateToken, async (req, res) => {
// router.post('/tenants', authenticateToken, requireAdmin, (req, res) => {
// router.post('/users/:id/tenant', authenticateToken, requireAdmin, (req, res) => {
// router.post('/upload', authenticateToken, upload.single('photo'), (req, res) => {
// router.post('/upload-body-image', authenticateToken, requireAdmin, uploadBodyImage.single('image'), (req, res) => {
// router.get('/bodymap-regions', (req, res) => {
// router.post('/bodymap-regions', authenticateToken, requireEducator, (req, res) => {
// router.post('/users/create', authenticateToken, requireAdmin, async (req, res) => {
// router.post('/users/batch', authenticateToken, requireAdmin, async (req, res) => {
// router.get('/users', authenticateToken, requireAdmin, (req, res) => {
// router.get('/users/preferences', authenticateToken, (req, res) => {
// router.put('/users/preferences', authenticateToken, (req, res) => {
// router.get('/users/:id', authenticateToken, requireAdmin, (req, res) => {
// router.put('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
// router.post('/users/:id/purge', authenticateToken, requireAdmin, async (req, res) => {
// router.delete('/users/:id', authenticateToken, requireAdmin, (req, res) => {
// router.get('/admin/audit-log', authenticateToken, requireAdmin, (req, res) => {
// router.get('/admin/audit/verify', authenticateToken, requireAdmin, async (req, res) => {
// router.get('/system-audit-log', authenticateToken, requireAdmin, handleSystemAuditLogRequest);
// router.get('/admin/active-sessions', authenticateToken, requireAdmin, (req, res) => {
// router.delete('/admin/active-sessions/:id', authenticateToken, requireAdmin, (req, res) => {
// router.get('/user/profile', authenticateToken, (req, res) => {
// router.put('/user/profile', authenticateToken, (req, res) => {
// router.put('/user/password', authenticateToken, async (req, res) => {

export default router;
