// Single import point for e2e specs.
//
// Usage:
//   import { test, expect } from '../fixtures/index.js';
//
//   test('my spec', async ({ adminPage }) => {
//     await adminPage.goto('/');
//     await expect(adminPage.getByText('admin')).toBeVisible();
//   });
//
// Available fixtures:
//   - adminPage    Test-scoped Page already logged in as admin.
//   - studentPage  Test-scoped Page already logged in as student.
//
// The default `page`, `context`, `browser`, `request`, `baseURL` fixtures
// from @playwright/test are still available — adminPage/studentPage are
// additive, not a replacement.
//
// For seed/reset helpers see ./seed.js.

export { test, expect } from './auth.js';
export { apiAsAdmin, listCases, findCase, waitForSeed } from './seed.js';
