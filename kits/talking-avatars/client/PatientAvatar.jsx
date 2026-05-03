import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { baseUrl } from './config.js';
import { resolveAvatarId } from './resolveAvatar.js';
import { resolveCamera } from './avatarFraming.js';
import { VISEME_KEYS } from './visemes.js';

function CameraAim({ pos, lookY }) {
    const { camera } = useThree();
    const [px, py, pz] = pos;
    useEffect(() => {
        camera.position.set(px, py, pz);
        camera.lookAt(0, lookY, 0);
        camera.updateProjectionMatrix();
    }, [camera, px, py, pz, lookY]);
    return null;
}

function HeadMesh({ url, visemesRef, blinkRef }) {
    const { scene: original } = useGLTF(url);
    // Clone so multiple avatars sharing this URL don't fight over morph state.
    const scene = useMemo(() => original.clone(true), [original]);

    const morphTargets = useRef([]);

    useEffect(() => {
        const targets = [];
        scene.traverse((obj) => {
            if (obj.morphTargetDictionary && obj.morphTargetInfluences) {
                targets.push(obj);
            }
        });
        morphTargets.current = targets;
    }, [scene]);

    // Three.js requires us to mutate the morphTargetInfluences array in-place;
    // the WebGL renderer reads it by reference each frame.
    /* eslint-disable react-hooks/immutability */
    useFrame((_, delta) => {
        const targets = morphTargets.current;
        if (targets.length === 0) return;

        const target = visemesRef.current || {};
        const blink = blinkRef.current ? 1 : 0;

        const decay = 8 * delta;
        const rise = 12 * delta;

        for (const mesh of targets) {
            const dict = mesh.morphTargetDictionary;
            const infl = mesh.morphTargetInfluences;
            if (!dict || !infl) continue;

            for (const key of VISEME_KEYS) {
                const idx = dict[key];
                if (idx == null) continue;
                const want = target[key] || 0;
                const cur = infl[idx];
                infl[idx] = want > cur
                    ? Math.min(want, cur + rise)
                    : Math.max(want, cur - decay);
            }

            const lIdx = dict.eyeBlinkLeft ?? dict.eyesClosed;
            const rIdx = dict.eyeBlinkRight ?? dict.eyesClosed;
            if (lIdx != null) infl[lIdx] = blink;
            if (rIdx != null && rIdx !== lIdx) infl[rIdx] = blink;
        }
    });
    /* eslint-enable react-hooks/immutability */

    return <primitive object={scene} />;
}

function pickHeadFile(patient, manifest) {
    if (!manifest) return null;
    const age = Number(patient?.age);
    const safeAge = Number.isFinite(age) ? age : 35;
    const gender = /^f/i.test(patient?.gender || '') ? 'female' : 'male';
    const bucket = safeAge < 13 ? 'child' : safeAge < 40 ? 'young' : safeAge < 65 ? 'middle' : 'elderly';

    let pool = [];
    if (bucket === 'child') {
        pool = manifest.child || [];
    } else {
        pool = manifest[gender]?.[bucket] || [];
    }
    if (pool.length === 0) pool = manifest.fallback || [];
    if (pool.length === 0) return null;

    const seed = String(patient?.id ?? patient?.name ?? '');
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
        h = ((h << 5) - h) + seed.charCodeAt(i);
        h |= 0;
    }
    const idx = Math.abs(h) % pool.length;
    return pool[idx];
}

export default function PatientAvatar({
    patient,
    speaking = false,
    listening = false,
    visemes = null,
    avatarType,
    headManifest,
    avatarId = null,
    cameraOverride = null,
    platformAvatars = null
}) {
    // Per-frame state held in refs so prop churn doesn't re-trigger useFrame.
    const visemesRef = useRef({ viseme_sil: 1 });
    const blinkRef = useRef(false);
    const [_blinkTick, setBlinkTick] = useState(0);

    useEffect(() => {
        if (visemes) visemesRef.current = visemes;
    }, [visemes]);

    useEffect(() => {
        let cancelled = false;
        let timeoutId;
        const schedule = () => {
            const wait = 3500 + Math.random() * 2000;
            timeoutId = setTimeout(() => {
                if (cancelled) return;
                blinkRef.current = true;
                setBlinkTick(t => t + 1);
                setTimeout(() => {
                    if (cancelled) return;
                    blinkRef.current = false;
                    schedule();
                }, 130);
            }, wait);
        };
        schedule();
        return () => {
            cancelled = true;
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, []);

    if (avatarType === 'none' || avatarType == null) return null;
    if (!headManifest) return null;

    const filename = resolveAvatarId({
        avatarId,
        gender: patient?.gender,
        manifest: headManifest,
        platformAvatars,
        demographicPicker: pickHeadFile,
        patient
    });
    if (!filename) {
        // Manifest is loaded but has no entries yet — show a neutral placeholder.
        return (
            <div className="w-full h-full rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-500 text-xs">
                no avatar configured
            </div>
        );
    }

    const url = baseUrl(`/avatars/heads/${filename}`);
    const ringColor = listening ? '#22c55e' : speaking ? '#3b82f6' : 'transparent';
    const cam = resolveCamera(headManifest, filename, cameraOverride);

    return (
        <div
            className="w-full h-full rounded-full overflow-hidden bg-neutral-900 border border-neutral-700"
            style={{
                boxShadow: ringColor !== 'transparent'
                    ? `0 0 0 4px ${ringColor}, 0 0 24px ${ringColor}`
                    : 'none',
                transition: 'box-shadow 200ms'
            }}
        >
            <Canvas camera={{ position: cam.pos, fov: cam.fov }}>
                <CameraAim pos={cam.pos} lookY={cam.lookY} />
                <ambientLight intensity={1.0} />
                <directionalLight position={[2, 3, 2]} intensity={1.2} />
                <Suspense fallback={null}>
                    <HeadMesh
                        key={url}
                        url={url}
                        visemesRef={visemesRef}
                        blinkRef={blinkRef}
                    />
                </Suspense>
            </Canvas>
        </div>
    );
}
