import { describe, expect, it, vi } from 'vitest';
import PatientRecord from './PatientRecord';

describe('PatientRecord core event stream', () => {
  it('records clinical verbs, updates event count, and tracks pending sync', () => {
    vi.setSystemTime(new Date('2026-05-06T12:00:00Z'));
    const record = new PatientRecord('session-1', 'case-1', {
      name: 'Alex Patient',
      age: 54,
      gender: 'male',
      chief_complaint: 'chest pain',
    });

    const history = record.obtained('hpi', 'Pain started one hour ago');
    const order = record.ordered('lab', 'Troponin', { urgency: 'stat' });
    const finding = record.elicited('lab', 'Troponin elevated', true, {
      test_name: 'Troponin',
      value: '120',
      unit: 'ng/L',
    });

    expect(history).toMatchObject({ verb: 'OBTAINED', category: 'hpi' });
    expect(order).toMatchObject({ verb: 'ORDERED', item: 'Troponin', status: 'pending' });
    expect(finding).toMatchObject({ verb: 'ELICITED', abnormal: true, unit: 'ng/L' });
    expect(record.getEventCount()).toBe(3);
    expect(record.getPendingSync()).toHaveLength(3);

    record.clearPendingSync();
    expect(record.getPendingSync()).toEqual([]);
    vi.useRealTimers();
  });

  it('updates current vitals and records direction on vital changes', () => {
    const record = new PatientRecord('session-1', 'case-1', { name: 'Alex Patient' });

    const hr = record.changed('vital', 'hr', 80, 112, 'scenario_progression', 'bpm');
    const spo2 = record.changed('vital', 'spo2', 96, 88, 'scenario_progression', '%');

    expect(hr).toMatchObject({ direction: 'increased', from: '80', to: '112' });
    expect(spo2).toMatchObject({ direction: 'decreased', from: '96', to: '88' });
    expect(record.getCurrentState().vitals).toMatchObject({ hr: 112, spo2: 88 });
  });

  it('generates usable timeline, summary, and context narratives', () => {
    const record = new PatientRecord('session-1', 'case-1', {
      name: 'Alex Patient',
      age: 54,
      gender: 'male',
      chief_complaint: 'chest pain',
    });
    record.obtained('hpi', 'Crushing central chest pain', 'patient');
    record.examined('cardiac', 'auscultation');
    record.elicited('exam', 'Diaphoretic and pale', true);
    record.ordered('lab', 'Troponin');
    record.administered('medication', 'Aspirin', '300 mg', 'PO');

    expect(record.toNarrative('timeline')).toContain('0 min -');
    expect(record.toNarrative('summary')).toContain('CHIEF COMPLAINT: chest pain');
    expect(record.toNarrative('summary')).toContain('LABS/STUDIES');
    expect(record.toNarrative('context')).toContain('Patient: Alex Patient');
    expect(record.toNarrative('context')).toContain('Crushing central chest pain');
  });

  it('loads existing events for resumed sessions without marking them pending', () => {
    const record = new PatientRecord('session-1', 'case-1', { name: 'Alex Patient' });
    record.obtained('hpi', 'Original event');
    record.clearPendingSync();

    record.loadEvents([{ id: 'event-1', verb: 'ORDERED', time: 3, item: 'CBC' }]);

    expect(record.getEvents()).toEqual([{ id: 'event-1', verb: 'ORDERED', time: 3, item: 'CBC' }]);
    expect(record.getPendingSync()).toEqual([]);
    expect(record.getSummary()).toMatchObject({
      total_events: 1,
      events_by_verb: { ORDERED: 1 },
    });
  });
});
