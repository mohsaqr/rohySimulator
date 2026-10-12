// The lint rule that keeps client addresses on the base path (eslint.config.js).
// A hand-written '/api/…' address works at '/' and is a 404 on an install
// served at '/rohy/' — every slide was, until rc.44.
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();
const flags = async (code, filePath = 'src/components/Example.jsx') => {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').length;
};

describe('lint: client addresses carry the base path', () => {
    it('flags a hand-written /api/ or /uploads/ address, as a string or a template', async () => {
        // Regression lock: resolveRemoteRef built `/api/plugins/...` and every slide 404'd under /rohy/
        expect(await flags("export const a = fetch('/api/cases');")).toBe(1);
        expect(await flags('export const b = (id) => `/api/plugins/x/${id}`;')).toBe(1);
        expect(await flags("export const c = '/uploads/x.png';")).toBe(1);
        // Regression lock: Oyon's element and asset base were written as '/oyon/…' and capture was dead under /rohy/
        expect(await flags("export const d = '/oyon/standalone';")).toBe(1);
    });

    it('accepts the helpers, relative paths and imports', async () => {
        expect(await flags("import { apiUrl, baseUrl } from '../config/api';\nexport const a = apiUrl('/cases');\nexport const b = (id) => baseUrl(`/api/plugins/x/${id}`);")).toBe(0);
        expect(await flags("export const c = './uploads/x.png';")).toBe(0);
        expect(await flags("import { coursesApi } from './api/courses';\nexport default coursesApi;")).toBe(0);
    });

    it('leaves tests and the config module alone', async () => {
        expect(await flags("export const a = '/api/cases';", 'src/components/Example.test.jsx')).toBe(0);
        expect(await flags("export const a = '/api/cases';", 'src/config/api.js')).toBe(0);
    });
});
