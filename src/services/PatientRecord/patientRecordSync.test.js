import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/api', () => ({
  apiUrl: (path) => `http://api.test${path}`,
}));

import {
  deletePatientRecord,
  getPatientRecordEvents,
  getPatientRecordEventsByVerb,
  loadPatientRecord,
  syncPatientRecord,
} from './patientRecordSync';

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('patientRecordSync', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('sends bearer auth on all protected patient-record endpoints', async () => {
    localStorage.setItem('token', 'record-token');
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ document: { ok: true }, events: [] }));

    await loadPatientRecord(42);
    await getPatientRecordEvents(42);
    await getPatientRecordEventsByVerb(42, 'ORDERED');
    await deletePatientRecord(42);

    expect(global.fetch).toHaveBeenCalledTimes(4);
    for (const [, init] of global.fetch.mock.calls) {
      expect(init.headers.Authorization).toBe('Bearer record-token');
    }
  });

  it('syncs pending events with auth and the full record payload', async () => {
    localStorage.setItem('token', 'record-token');
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ success: true }));

    const patientRecord = {
      getSessionId: () => 7,
      getRecordId: () => 'rec-1',
      getPendingSync: () => [{ verb: 'ORDERED', item: 'CBC' }],
      getRecord: () => ({ record_id: 'rec-1' }),
      getPatientInfo: () => ({ name: 'A Patient' }),
      getCurrentState: () => ({ vitals: {} }),
      getEventCount: () => 1,
    };

    await expect(syncPatientRecord(patientRecord)).resolves.toEqual({ success: true });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://api.test/patient-record/sync');
    expect(init.headers.Authorization).toBe('Bearer record-token');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toMatchObject({
      session_id: 7,
      record_id: 'rec-1',
      events_count: 1,
    });
  });
});
