// Lane B handoff (security audit 2026-10-26, F-02): platform-scope treatments
// are writable only by an administrator of the platform tenant; the Edit
// affordance must match what the server will accept.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({}) }));

const { canEditRow } = await import('./TreatmentsLibraryManager.jsx');

const platformRow = { id: 1, scope: 'platform', tenant_id: 1 };
const tenant2Row = { id: 2, scope: 'tenant', tenant_id: 2 };

describe('platform treatment rows', () => {
    // Regression lock: a tenant-2 admin was offered Edit on platform rows and then got a 403.
    it('are not editable by an admin of another tenant', () => {
        const tenantAdmin = { id: 9, role: 'admin', tenant_id: 2 };
        expect(canEditRow(tenantAdmin, platformRow)).toBe(false);
        expect(canEditRow(tenantAdmin, tenant2Row)).toBe(true);
    });

    it('are editable by a platform-tenant admin (tenant_id absent counts as 1, as on the server)', () => {
        expect(canEditRow({ id: 1, role: 'admin', tenant_id: 1 }, platformRow)).toBe(true);
        expect(canEditRow({ id: 1, role: 'admin' }, platformRow)).toBe(true);
        expect(canEditRow({ id: 3, role: 'educator', tenant_id: 1 }, platformRow)).toBe(false);
    });
});
