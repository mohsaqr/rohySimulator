// Procedural head — a deliberately stylized cartoon face that doesn't depend on
// any GLB asset. Used when avatar_type='procedural' in voice settings, or as
// a fallback when no GLB manifest is configured.
//
// Each viseme maps to a (mouthOpenY, mouthWideX, lipPurse) tuple; we ease toward
// the target shape each frame so mouth motion stays smooth.

import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const VISEME_SHAPES = {
    viseme_sil: { open: 0.05, wide: 1.00, purse: 0.0 },
    viseme_PP:  { open: 0.05, wide: 0.70, purse: 0.2 },
    viseme_FF:  { open: 0.10, wide: 0.90, purse: 0.0 },
    viseme_TH:  { open: 0.20, wide: 1.00, purse: 0.1 },
    viseme_DD:  { open: 0.25, wide: 1.00, purse: 0.0 },
    viseme_kk:  { open: 0.30, wide: 1.00, purse: 0.0 },
    viseme_CH:  { open: 0.20, wide: 0.80, purse: 0.2 },
    viseme_SS:  { open: 0.10, wide: 1.10, purse: 0.0 },
    viseme_nn:  { open: 0.15, wide: 1.00, purse: 0.0 },
    viseme_RR:  { open: 0.20, wide: 0.80, purse: 0.1 },
    viseme_aa:  { open: 0.85, wide: 1.00, purse: 0.0 },
    viseme_E:   { open: 0.40, wide: 1.20, purse: 0.0 },
    viseme_I:   { open: 0.30, wide: 1.30, purse: 0.0 },
    viseme_O:   { open: 0.50, wide: 0.50, purse: 0.3 },
    viseme_U:   { open: 0.35, wide: 0.40, purse: 0.4 }
};

const REST_SHAPE = VISEME_SHAPES.viseme_sil;

function pickDominantShape(visemes) {
    if (!visemes) return REST_SHAPE;
    let bestKey = 'viseme_sil';
    let bestVal = 0;
    for (const [k, v] of Object.entries(visemes)) {
        if (v > bestVal && VISEME_SHAPES[k]) {
            bestVal = v;
            bestKey = k;
        }
    }
    return VISEME_SHAPES[bestKey] || REST_SHAPE;
}

function HeadScene({ visemesRef, blinkRef, skinColor }) {
    const headRef = useRef();
    const mouthRef = useRef();
    const lipsRef = useRef();
    const lEyeLidRef = useRef();
    const rEyeLidRef = useRef();
    const stateRef = useRef({ open: 0.05, wide: 1.0, purse: 0.0 });

    useFrame((_, delta) => {
        // Subtle idle breathing — vertical bob, ~0.5 Hz.
        const t = performance.now() / 1000;
        if (headRef.current) {
            headRef.current.position.y = Math.sin(t * 1.6) * 0.01;
        }

        const target = pickDominantShape(visemesRef.current);
        const cur = stateRef.current;
        const k = Math.min(1, delta * 14);
        cur.open  += (target.open  - cur.open)  * k;
        cur.wide  += (target.wide  - cur.wide)  * k;
        cur.purse += (target.purse - cur.purse) * k;

        if (mouthRef.current) {
            mouthRef.current.scale.y = 0.05 + cur.open * 1.0;
            mouthRef.current.scale.x = 0.7 * cur.wide;
            mouthRef.current.position.z = 0.97 + cur.purse * 0.05;
        }
        if (lipsRef.current) {
            lipsRef.current.scale.y = 0.07 + cur.open * 1.05;
            lipsRef.current.scale.x = 0.78 * cur.wide;
            lipsRef.current.position.z = 0.965 + cur.purse * 0.05;
        }

        const blink = blinkRef.current ? 1 : 0;
        if (lEyeLidRef.current) lEyeLidRef.current.scale.y = blink;
        if (rEyeLidRef.current) rEyeLidRef.current.scale.y = blink;
    });

    return (
        <group ref={headRef}>
            {/* Skull */}
            <mesh>
                <sphereGeometry args={[1, 48, 48]} />
                <meshStandardMaterial color={skinColor} roughness={0.7} />
            </mesh>

            {/* Whites of eyes */}
            <mesh position={[-0.32, 0.25, 0.85]}>
                <sphereGeometry args={[0.18, 24, 24]} />
                <meshStandardMaterial color="#ffffff" roughness={0.4} />
            </mesh>
            <mesh position={[0.32, 0.25, 0.85]}>
                <sphereGeometry args={[0.18, 24, 24]} />
                <meshStandardMaterial color="#ffffff" roughness={0.4} />
            </mesh>

            {/* Pupils */}
            <mesh position={[-0.32, 0.25, 1.0]}>
                <sphereGeometry args={[0.07, 16, 16]} />
                <meshStandardMaterial color="#1f2937" />
            </mesh>
            <mesh position={[0.32, 0.25, 1.0]}>
                <sphereGeometry args={[0.07, 16, 16]} />
                <meshStandardMaterial color="#1f2937" />
            </mesh>

            {/* Eyelids — scale to 1 closes the eye */}
            <mesh ref={lEyeLidRef} position={[-0.32, 0.25, 1.0]} scale={[1, 0, 1]}>
                <sphereGeometry args={[0.185, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshStandardMaterial color={skinColor} roughness={0.7} />
            </mesh>
            <mesh ref={rEyeLidRef} position={[0.32, 0.25, 1.0]} scale={[1, 0, 1]}>
                <sphereGeometry args={[0.185, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshStandardMaterial color={skinColor} roughness={0.7} />
            </mesh>

            {/* Lips (slightly larger ring around the mouth opening) */}
            <mesh ref={lipsRef} position={[0, -0.30, 0.965]} scale={[0.78, 0.07, 1]}>
                <circleGeometry args={[0.4, 36]} />
                <meshStandardMaterial color="#a3261b" roughness={0.5} />
            </mesh>
            {/* Mouth opening (dark inside) */}
            <mesh ref={mouthRef} position={[0, -0.30, 0.97]} scale={[0.7, 0.05, 1]}>
                <circleGeometry args={[0.36, 36]} />
                <meshStandardMaterial color="#1a1a1a" />
            </mesh>

            {/* Nose dot */}
            <mesh position={[0, -0.05, 0.99]}>
                <sphereGeometry args={[0.05, 12, 12]} />
                <meshStandardMaterial color="#c87a6a" />
            </mesh>
        </group>
    );
}

export default function ProceduralHead({ visemes, listening, speaking, patient }) {
    const visemesRef = useRef({ viseme_sil: 1 });
    const blinkRef = useRef(false);
    const [, forceTick] = useState(0);

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
                forceTick(t => t + 1);
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

    // Skin tone seeded by patient id for visual diversity across cases.
    const skinColor = (() => {
        const palette = ['#f3c7a4', '#d4a17a', '#a87454', '#7a5040', '#5e3a2c'];
        const seed = String(patient?.id ?? patient?.name ?? 'x');
        let h = 0;
        for (let i = 0; i < seed.length; i++) h = ((h << 5) - h) + seed.charCodeAt(i);
        return palette[Math.abs(h) % palette.length];
    })();

    const ringColor = listening ? '#22c55e' : speaking ? '#3b82f6' : 'transparent';

    return (
        <div
            className="rounded-full overflow-hidden bg-neutral-900 border border-neutral-700"
            style={{
                width: 200,
                height: 200,
                boxShadow: ringColor !== 'transparent'
                    ? `0 0 0 4px ${ringColor}, 0 0 24px ${ringColor}`
                    : 'none',
                transition: 'box-shadow 200ms'
            }}
        >
            <Canvas camera={{ position: [0, 0.05, 2.5], fov: 32 }}>
                <ambientLight intensity={0.7} />
                <directionalLight position={[2, 3, 4]} intensity={1.0} />
                <directionalLight position={[-2, 1, 2]} intensity={0.4} color="#a8c0ff" />
                <Suspense fallback={null}>
                    <HeadScene
                        visemesRef={visemesRef}
                        blinkRef={blinkRef}
                        skinColor={skinColor}
                    />
                </Suspense>
            </Canvas>
        </div>
    );
}
