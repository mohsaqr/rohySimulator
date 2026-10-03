import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import Exam3DScreen from './Exam3DScreen.jsx';
import EventLogger from '../../services/eventLogger';

const controller = {
    update: vi.fn(),
    addTimelineEvent: vi.fn(),
    dispose: vi.fn(),
    setActiveTreatments: vi.fn(),
    setAvailableTreatments: vi.fn(),
    say: vi.fn(),
    ecg_canvas: null,
};

vi.mock('rohy-3d-patient-room', () => ({
    mountPatientRoom: vi.fn(() => controller),
}));

const stopEcgMirror = vi.fn();
vi.mock('./ecgMirror.js', () => ({
    startEcgMirror: vi.fn(() => stopEcgMirror),
}));

const { mountPatientRoom } = await import('rohy-3d-patient-room');
const { startEcgMirror } = await import('./ecgMirror.js');

const ACTIVE_CASE = {
    name: 'Breathless in Triage',
    patient_name: 'Daniel Moreau',
    patient_gender: 'Male',
    patient_age: 54,
    chief_complaint: 'Increasing shortness of breath',
    config: { avatar_id: 'avatarsdk.glb' },
};

describe('Exam3DScreen', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        controller.update.mockClear();
        controller.dispose.mockClear();
        mountPatientRoom.mockClear();
        startEcgMirror.mockClear();
        stopEcgMirror.mockClear();
        EventLogger.setCurrentVitals({ hr: 104, spo2: 91, rr: 26, bpSys: 150, bpDia: 88, temp: 37.4 });
    });

    afterEach(() => {
        vi.useRealTimers();
        EventLogger.setCurrentVitals(null);
    });

    it('mounts the room in bound mode with the mapped case patient and avatar', () => {
        render(<Exam3DScreen activeCase={ACTIVE_CASE} sessionId={7} />);
        expect(mountPatientRoom).toHaveBeenCalledTimes(1);
        const [host, options] = mountPatientRoom.mock.calls[0];
        expect(host).toBeInstanceOf(HTMLElement);
        expect(options.mode).toBe('bound');
        expect(options.waveform).toBe('host');
        expect(options.avatar_url).toBe('/avatars/heads/avatarsdk.glb');
        expect(startEcgMirror).toHaveBeenCalledWith(controller.ecg_canvas, expect.any(Function));
        expect(options.patient).toMatchObject({ name: 'Daniel Moreau', pronouns: 'he/him' });
        expect(options.records).toBeUndefined();
        expect(options.treatments).toBeUndefined();
    });

    it('routes 3D object clicks to Rohy own OrdersDrawer tabs', () => {
        const onOpenDrawer = vi.fn();
        render(<Exam3DScreen activeCase={ACTIVE_CASE} sessionId={7} onOpenDrawer={onOpenDrawer} />);
        const { on_event } = mountPatientRoom.mock.calls[0][1];
        on_event({ type: 'selection', id: 'chart', label: 'Open clinical chart' });
        expect(onOpenDrawer).toHaveBeenLastCalledWith('records');
        on_event({ type: 'selection', id: 'oxygen', label: 'Controlled oxygen' });
        expect(onOpenDrawer).toHaveBeenLastCalledWith('treatments');
        on_event({ type: 'selection', id: 'iv', label: 'IV equipment' });
        expect(onOpenDrawer).toHaveBeenLastCalledWith('treatments');
        on_event({ type: 'selection', id: 'patient', label: 'Assess' });
        expect(onOpenDrawer).toHaveBeenCalledTimes(3);
    });

    it('feeds EventLogger.currentVitals into the room once per second', () => {
        render(<Exam3DScreen activeCase={ACTIVE_CASE} sessionId={7} />);
        expect(controller.update).toHaveBeenCalledWith(
            expect.objectContaining({ heart_rate: 104, oxygen_saturation: 91, systolic: 150 }),
            null,
            0,
            { rhythm: null },
        );
        EventLogger.setCurrentVitals({ hr: 96, spo2: 95, rr: 18, bpSys: 132, bpDia: 80, temp: 37.0 });
        vi.advanceTimersByTime(1000);
        expect(controller.update).toHaveBeenLastCalledWith(
            expect.objectContaining({ heart_rate: 96, oxygen_saturation: 95 }),
            null,
            1,
            { rhythm: null },
        );
    });

    it('passes a named rhythm through to the monitor label', () => {
        EventLogger.setCurrentVitals({ hr: 132, spo2: 93, rr: 22, bpSys: 118, bpDia: 74, temp: 37.2, rhythm: 'AFib' });
        render(<Exam3DScreen activeCase={ACTIVE_CASE} sessionId={7} />);
        expect(controller.update).toHaveBeenLastCalledWith(
            expect.objectContaining({ heart_rate: 132 }),
            null,
            0,
            { rhythm: 'Atrial fibrillation' },
        );
    });

    it('skips updates while the feed is non-numeric and disposes on unmount', () => {
        render(<Exam3DScreen activeCase={ACTIVE_CASE} sessionId={7} />).unmount();
        expect(controller.dispose).toHaveBeenCalledTimes(1);
        expect(stopEcgMirror).toHaveBeenCalledTimes(1);

        EventLogger.setCurrentVitals({ hr: 0, spo2: '?', rr: 4, bpSys: '?', bpDia: '?', temp: 36.0 });
        controller.update.mockClear();
        const view = render(<Exam3DScreen activeCase={ACTIVE_CASE} sessionId={7} />);
        vi.advanceTimersByTime(2000);
        expect(controller.update).not.toHaveBeenCalled();
        view.unmount();
    });
});
