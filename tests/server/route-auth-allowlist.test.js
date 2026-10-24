import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');

const ROUTE_FILES = [
    'server/routes.js',
    'server/routes/catalogue.js',
    'server/routes/health-routes.js',
];

const AUTH_MIDDLEWARE = [
    'authenticateToken',
    'requireAuth',
    'requireAdmin',
    'requireEducator',
    'requireReviewer',
];

const PUBLIC_ROUTE_ALLOWLIST = new Set([
    'server/routes.js GET /bodymap-regions',
    'server/routes.js GET /learning-events/verbs',
    'server/routes.js GET /master/body-regions',
    'server/routes.js GET /master/exam-techniques',
    'server/routes.js GET /master/body-map-coordinates',
    'server/routes.js GET /master/scenario-templates',
    'server/routes.js GET /master/scenario-templates/:id',
    'server/routes.js GET /master/lab-tests',
    'server/routes.js GET /master/lab-tests/groups',
    'server/routes.js GET /master/lab-panels',
    'server/routes.js GET /master/medications',
    'server/routes.js GET /master/investigation-templates',
    'server/routes.js GET /master/vital-sign-definitions',
    'server/routes.js GET /master/diagnoses',
    'server/routes.js GET /master/search-aliases',
    'server/routes.js GET /platform-settings/monitor',
    'server/routes.js POST /auth/register',
    'server/routes.js POST /auth/login',
    // Liveness + readiness probes — public by design so external monitoring
    // (nginx, systemd, uptime checks) can probe without credentials.
    'server/routes/health-routes.js GET /health',
    'server/routes/health-routes.js GET /ready',
    // Plugin content-origin probe (RPS-1 §7a.1) — public so the deploy hub's
    // POST_VERIFY can gate a deploy on it without credentials; it reports
    // reachable / content version only and never echoes the origin URL.
    'server/routes/health-routes.js GET /health/plugins',
]);

function routeDeclarations(file) {
    const src = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    const matches = Array.from(src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]([^\n]*)/g));
    return matches.map((m) => {
        const method = m[1].toUpperCase();
        const routePath = m[2];
        const args = m[3];
        const key = `${file} ${method} ${routePath}`;
        return {
            file,
            method,
            path: routePath,
            key,
            hasAuth: AUTH_MIDDLEWARE.some((name) => args.includes(name)),
            hasLimiter: args.includes('authLimiter') || args.includes('registerLimiter'),
        };
    });
}

describe('server route auth allowlist', () => {
    it('keeps every unauthenticated route explicitly allowlisted', () => {
        const routes = ROUTE_FILES.flatMap(routeDeclarations);
        expect(routes.length).toBeGreaterThan(200);

        const unprotected = routes
            .filter((route) => !route.hasAuth)
            .map((route) => route.key)
            .sort();

        expect(unprotected).toEqual(Array.from(PUBLIC_ROUTE_ALLOWLIST).sort());
    });

    it('keeps auth endpoints rate limited even though they are public', () => {
        const routes = ROUTE_FILES.flatMap(routeDeclarations);
        const publicAuthRoutes = routes.filter((route) =>
            route.key === 'server/routes.js POST /auth/register' ||
            route.key === 'server/routes.js POST /auth/login'
        );

        expect(publicAuthRoutes).toHaveLength(2);
        expect(publicAuthRoutes.every((route) => route.hasLimiter)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Every route module, not just the mount file's manifest comment.
//
// Regression lock: the allowlist above only ever read server/routes.js (whose
// "routes" are a hand-kept comment block), catalogue.js and health-routes.js,
// so an unauthenticated route added to any of the ~30 other modules shipped
// unnoticed (security audit 2026-10-24, #12). This scan reads every
// server/routes/*.js, finds every `<router>.<verb>('/path', ...)` declared on
// an `express.Router()` of that file, and requires authenticateToken (or
// requireAuth) among the middleware before the handler — or an explicit entry
// below. Adding a public route means adding it here, in review.
// ---------------------------------------------------------------------------

const ROUTES_DIR = path.join(repoRoot, 'server/routes');
const AUTHENTICATING_MIDDLEWARE = /\b(authenticateToken|requireAuth)\b/;
// Where the middleware list ends and the handler begins.
const HANDLER_START = /\basync\b|\bfunction\b|\(\s*_?req\b|\b_?req\s*=>|\(\s*\)\s*=>/;

const MODULE_PUBLIC_ROUTE_ALLOWLIST = new Set([
    // Read-only master catalogues (no tenant data); paged + LIKE-escaped (#7).
    'admin-routes.js GET /master/body-regions',
    'admin-routes.js GET /master/exam-techniques',
    'admin-routes.js GET /master/body-map-coordinates',
    'admin-routes.js GET /master/scenario-templates',
    'admin-routes.js GET /master/scenario-templates/:id',
    'admin-routes.js GET /master/lab-tests',
    'admin-routes.js GET /master/lab-tests/groups',
    'admin-routes.js GET /master/lab-panels',
    'admin-routes.js GET /master/medications',
    'admin-routes.js GET /master/investigation-templates',
    'admin-routes.js GET /master/vital-sign-definitions',
    'admin-routes.js GET /master/diagnoses',
    'admin-routes.js GET /master/search-aliases',
    // The login page needs the default language before there is a token.
    'admin-routes.js GET /platform-settings/language',
    'admin-routes.js GET /platform-settings/monitor',
    // Pre-login auth surface; each carries its own rate limiter.
    'auth-routes.js GET /auth/registration-policy',
    'auth-routes.js POST /auth/register',
    'auth-routes.js POST /auth/login',
    'registration-routes.js GET /auth/invite/:token',
    'terms-routes.js GET /terms',
    // Liveness / readiness / plugin-origin probes for external monitoring.
    'health-routes.js GET /health',
    'health-routes.js GET /ready',
    'health-routes.js GET /health/plugins',
    // Static body-map region list used by the exam room before data loads.
    'uploads-routes.js GET /bodymap-regions',
]);

/** Every route declared on an express.Router() in `src`, with whether it authenticates. */
function scanRouteModule(file, src) {
    const routerNames = new Set(
        Array.from(src.matchAll(/\b(?:const|let|var|export\s+const)\s+([A-Za-z_$][\w$]*)\s*=\s*express\.Router\(/g))
            .map((m) => m[1])
    );
    const routes = [];
    const re = /\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|all)\(\s*(['"`])([^'"`]+)\3/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (!routerNames.has(m[1])) continue;
        const lineStart = src.lastIndexOf('\n', m.index) + 1;
        if (src.slice(lineStart, m.index).trim().startsWith('//')) continue; // commented out
        const rest = src.slice(re.lastIndex, re.lastIndex + 2000);
        const end = rest.search(HANDLER_START);
        const middleware = end < 0 ? rest : rest.slice(0, end);
        routes.push({
            key: `${file} ${m[2].toUpperCase()} ${m[4]}`,
            authenticated: AUTHENTICATING_MIDDLEWARE.test(middleware),
        });
    }
    return routes;
}

function scanAllRouteModules() {
    return fs.readdirSync(ROUTES_DIR)
        .filter((f) => f.endsWith('.js'))
        .sort()
        .flatMap((f) => scanRouteModule(f, fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8')));
}

describe('every server/routes module authenticates its routes', () => {
    it('finds the whole route surface (guards against a scanner that silently matches nothing)', () => {
        const routes = scanAllRouteModules();
        expect(routes.length).toBeGreaterThan(400);
        // Spot-check modules the old scan never read.
        expect(routes.some((r) => r.key === 'tenants-routes.js POST /tenants' && r.authenticated)).toBe(true);
        expect(routes.some((r) => r.key.startsWith('orders-routes.js '))).toBe(true);
        expect(routes.some((r) => r.key.startsWith('catalogue.js ') && r.key.includes(' /:id/items'))).toBe(true);
    });

    it('allows only the explicitly listed public routes to skip authenticateToken', () => {
        const unauthenticated = scanAllRouteModules()
            .filter((r) => !r.authenticated)
            .map((r) => r.key)
            .sort();
        expect(unauthenticated).toEqual(Array.from(MODULE_PUBLIC_ROUTE_ALLOWLIST).sort());
    });

    it('flags a new unauthenticated route (scanner self-test)', () => {
        const src = [
            "const router = express.Router();",
            "router.get('/ok', authenticateToken, requireAdmin, (req, res) => {});",
            "router.post('/multi',",
            "    authenticateToken,",
            "    async (req, res) => {});",
            "router.delete('/leak', requireAdmin, async (req, res) => {});",
            "router.get('/open', (req, res) => {});",
            "// router.get('/commented', (req, res) => {});",
            "notARouter.get('/x', (req, res) => {});",
        ].join('\n');
        const routes = scanRouteModule('fake.js', src);
        expect(routes.map((r) => r.key)).toEqual([
            'fake.js GET /ok', 'fake.js POST /multi', 'fake.js DELETE /leak', 'fake.js GET /open',
        ]);
        expect(routes.filter((r) => !r.authenticated).map((r) => r.key)).toEqual(['fake.js DELETE /leak', 'fake.js GET /open']);
    });
});
