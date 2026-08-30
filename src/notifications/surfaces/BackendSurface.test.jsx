import { describe, expect, it, beforeEach, vi } from 'vitest';

// Mock the apiClient before BackendSurface imports it. We exercise the
// internal helpers directly via the module's exported telemetry surface.
vi.mock('../../services/apiClient', () => ({
    apiPost: vi.fn(),
    apiPut: vi.fn(),
}));

// getToken() returns null on purpose: under cookie auth there IS no
// localStorage token, and the regression test below locks that alarm
// logging still works in exactly that state.
vi.mock('../../services/authService', () => ({
    AuthService: {
        getToken: () => null,
        verifyToken: vi.fn(async () => null),
    },
}));

import React, { useEffect } from 'react';
import { act } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import { useNotifications } from '../useNotifications';
import { SOURCES, SEVERITY } from '../types';
import { apiPost } from '../../services/apiClient';
import BackendSurface, {
    getBackendTelemetry,
    _resetBackendTelemetryForTest,
} from './BackendSurface';

beforeEach(() => {
    _resetBackendTelemetryForTest();
    vi.clearAllMocks();
});

// Exercise sendClinical / sendTelemetry / sendAck via the module's behaviour
// We need to import the module's internal behaviour via observable side
// effects: drive failures through apiPost/apiPut rejections and read
// getBackendTelemetry().

// Helper that invokes the internal sendClinical behaviour by simulating
// what BackendSurface does: call apiPost('/alarms/log', body) directly,
// catch the rejection, and record failure. We test the recording by
// re-implementing the wrapper logic inline OR by triggering it through
// the actual exported flow.

describe('BackendSurface — backend telemetry counters (audit #20)', () => {
    it('starts at zero failures', () => {
        const t = getBackendTelemetry();
        expect(t.alarmLogFailures).toBe(0);
        expect(t.alarmAckFailures).toBe(0);
        expect(t.telemetryFailures).toBe(0);
        expect(t.recentFailures).toEqual([]);
    });

    it('exposes stable getter shape (key contract)', () => {
        const t = getBackendTelemetry();
        expect(t).toHaveProperty('alarmLogFailures');
        expect(t).toHaveProperty('alarmAckFailures');
        expect(t).toHaveProperty('telemetryFailures');
        expect(Array.isArray(t.recentFailures)).toBe(true);
    });

    it('getBackendTelemetry returns a defensive copy of recentFailures', () => {
        const t1 = getBackendTelemetry();
        t1.recentFailures.push({ kind: 'forged' });
        const t2 = getBackendTelemetry();
        expect(t2.recentFailures).toEqual([]);
    });

    it('_resetBackendTelemetryForTest clears all counters and the ring buffer', () => {
        // Smoke check: the helper exists and returns to a clean state.
        _resetBackendTelemetryForTest();
        const t = getBackendTelemetry();
        expect(t.alarmLogFailures).toBe(0);
        expect(t.recentFailures).toHaveLength(0);
    });
});

// Regression lock: clinical alarm logging was 100% dead under cookie auth.
// sendClinical/sendAck gated on AuthService.getToken() — the legacy
// localStorage token, null since the cookie flag-day — and returned before
// the try/catch, so /alarms/log was never POSTed and the alarmLogFailures
// telemetry read 0. The guards are deleted; this mounts the real surface
// with NO token anywhere and asserts the POST still fires.
describe('BackendSurface — alarm logging under cookie auth (no localStorage token)', () => {
    function ProbeAndFire({ onCtx }) {
        const ctx = useNotifications();
        useEffect(() => { onCtx(ctx); });
        return null;
    }

    it('POSTs clinical alarms to /alarms/log without a legacy token', async () => {
        apiPost.mockResolvedValue({ id: 42 });
        let ctx = null;
        renderWithProviders(
            <>
                <ProbeAndFire onCtx={(c) => { ctx = c; }} />
                <BackendSurface sessionId="sess-1" userId={7} caseId={3} />
            </>,
            { withToast: false, withVoice: false },
        );
        expect(ctx).not.toBeNull();

        // Batch size 1 → the notify below flushes immediately.
        act(() => { ctx.setPrefs({ telemetryBatchSize: 1 }); });
        act(() => {
            ctx.notify({
                source: SOURCES.CLINICAL,
                severity: SEVERITY.CRITICAL,
                key: 'vital:hr',
                message: 'HR critical',
                data: { vital: 'hr', actualValue: 180 },
            });
        });

        await act(async () => { await Promise.resolve(); });
        expect(apiPost).toHaveBeenCalledWith(
            '/alarms/log',
            expect.objectContaining({ vital_sign: 'hr', session_id: 'sess-1' }),
        );
        // And the failure counter did NOT tick — this was a success path.
        expect(getBackendTelemetry().alarmLogFailures).toBe(0);
    });
});
