import { useEffect, useRef } from 'react';
import { mountBedsideView } from 'rohy-3d-patient-room';
import EventLogger from '../../services/eventLogger';

// A camera on the bed, in the portrait circle.
//
// The portrait used to render a head against nothing, so the patient in the
// circle and the patient in the 3D room were two separate renderings that
// only happened to share a GLB. This mounts the room's OWN scene — the same
// bed, the same light, the same body — held on the "patient" camera preset.
// One place, seen from two distances.
//
// It is a picture and not a way in: the package mounts it with interaction
// off, so it never steals a click or lets the viewer drag the camera off
// the patient.
// `view` and `headDirection` are the package's own framing options (see
// plugins/config.js for the vocabulary); they are passed through untouched so
// the package, not this component, decides what a framing means.
export default function BedsideCamera({ avatarUrl, visemes, view = 'three-quarter', headDirection = 'right', onFailed = null }) {
    const hostRef = useRef(null);
    const viewRef = useRef(null);

    useEffect(() => {
        if (!avatarUrl || !hostRef.current) return undefined;
        let cancelled = false;
        mountBedsideView(hostRef.current, { avatar_url: avatarUrl, view, head_direction: headDirection })
            .then((view) => {
                // The scene loads three.js on demand, so the component may
                // already be gone by the time it arrives.
                if (cancelled) {
                    view.dispose();
                    return;
                }
                viewRef.current = view;
            })
            .catch((error) => {
                // Never fail silently to an empty circle: say why, and hand
                // the portrait back to the head avatar so the learner still
                // sees their patient.
                console.warn('[BedsideCamera] could not mount the bedside view:', error);
                if (!cancelled) onFailed?.(error);
            });
        return () => {
            cancelled = true;
            viewRef.current?.dispose();
            viewRef.current = null;
        };
    }, [avatarUrl, view, headDirection, onFailed]);

    // The mouth, from the same viseme stream that drives the room's avatar
    // and Rohy's own — one voice, every face.
    useEffect(() => {
        viewRef.current?.setVisemes(visemes ?? null);
    }, [visemes]);

    // The chest, from the live physiology. PatientMonitor owns the model;
    // this only reads the published vitals, exactly as the 3D room does.
    useEffect(() => {
        let elapsed = 0;
        const timer = setInterval(() => {
            const vitals = EventLogger.currentVitals;
            const rr = Number(vitals?.rr);
            if (!viewRef.current || !Number.isFinite(rr)) return;
            elapsed += 1;
            viewRef.current.update(null, { respiratory_rate: rr }, elapsed);
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Square by its own height rather than filling whatever box it is given:
    // the circle must stay a circle, and the room's framing is composed for
    // a square viewport.
    return (
        <div className="flex h-full w-full items-center justify-center">
            <div
                ref={hostRef}
                className="aspect-square h-full max-w-full overflow-hidden rounded-full bg-neutral-950"
            />
        </div>
    );
}
