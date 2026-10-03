import { useEffect, useRef } from 'react';
import { mountPatientRoom } from 'rohy-3d-patient-room';
import EventLogger from '../../services/eventLogger';
import { avatarUrl, casePatient, mapVitals, rhythmLabel } from './caseBinding.js';
import { startEcgMirror } from './ecgMirror.js';

// The exam3d room surface: a full-screen 3D patient room bound to live Rohy
// data. The active case supplies the patient record and avatar; the monitor
// mirrors EventLogger.currentVitals and the real ECG generator; the 3D
// objects open Rohy's own surfaces — the chart opens the OrdersDrawer
// records tab, the IV pole and oxygen station its treatments tab — via
// onOpenDrawer. No clinical UI is re-implemented here.
//
// z-order contract: this surface sits at z-30, BELOW the fixed RoomNavigator
// (z-40, the exit affordance — there is no Back button, matching the other
// rooms) and the OrdersDrawer (z-50), whose backdrop dims the room.
//
// Vitals bridge: Rohy's physiology runs client-side inside PatientMonitor,
// which lives in the chat layout. App keeps that layout mounted (hidden and
// inert) underneath this surface so EventLogger.currentVitals stays live.
// Room stamping is App's existing roomChanged effect on currentRoom — this
// component does not stamp rooms itself.
export default function Exam3DScreen({ activeCase, sessionId, onOpenDrawer }) {
    const hostRef = useRef(null);
    // App passes an inline callback; route it through a ref so a new function
    // identity per App render never remounts (and re-loads) the whole room.
    const openDrawerRef = useRef(onOpenDrawer);
    useEffect(() => {
        openDrawerRef.current = onOpenDrawer;
    });

    useEffect(() => {
        let room = null;
        room = mountPatientRoom(hostRef.current, {
            mode: 'bound',
            waveform: 'host',
            chrome: 'room',
            patient: casePatient(activeCase),
            avatar_url: avatarUrl(activeCase),
            on_event: (event) => {
                if (event.type === 'selection') {
                    EventLogger.buttonClicked(`room3d:${event.id}`, 'Room3D', { label: event.label });
                    if (event.id === 'chart') openDrawerRef.current?.('records');
                    if (event.id === 'iv' || event.id === 'oxygen') openDrawerRef.current?.('treatments');
                }
                if (event.type === 'status') {
                    room?.addTimelineEvent(`Patient status: ${event.status}.`);
                }
            },
        });

        // The room's ECG canvas carries the monitor's real signal — the same
        // generator PatientMonitor draws with, driven by the live hr + rhythm.
        const stopEcg = startEcgMirror(room.ecg_canvas, () => EventLogger.currentVitals);

        const pushVitals = (elapsed_seconds) => {
            const vitals = mapVitals(EventLogger.currentVitals);
            if (!vitals) return;
            // null clears the label override, so a conversion back to sinus
            // returns the monitor to its heart-rate-derived rhythm text.
            const rhythm = rhythmLabel(EventLogger.currentVitals?.rhythm);
            room.update(vitals, null, elapsed_seconds, { rhythm });
        };
        let elapsed_seconds = 0;
        pushVitals(0);
        const vitals_timer = setInterval(() => {
            elapsed_seconds += 1;
            pushVitals(elapsed_seconds);
        }, 1000);

        return () => {
            clearInterval(vitals_timer);
            stopEcg();
            room.dispose();
        };
    }, [activeCase, sessionId]);

    return (
        <div className="fixed inset-0 z-30 bg-black">
            {/* The mount host ends 72px above the viewport bottom so the room
                (whose canvas sizing reads clientHeight) never renders under
                the fixed RoomNavigator band. */}
            <div ref={hostRef} className="absolute inset-x-0 top-0 bottom-[72px]" />
        </div>
    );
}
