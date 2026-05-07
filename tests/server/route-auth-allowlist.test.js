import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');

const ROUTE_FILES = [
    'server/routes.js',
    'server/routes/catalogue.js',
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
