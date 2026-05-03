// Camera framing helpers — pure functions shared by every place that wires
// avatar previews / runtime rendering (case picker, settings tab, chat
// panel). No JSX so Vite HMR can update them cleanly.

export const DEFAULT_CAMERA = { pos: [0, 1.62, 1.05], lookY: 1.62, fov: 22 };

// Resolution priority: explicit override → manifest entry's `camera` → defaults.
export function resolveCamera(manifest, avatarId, override) {
    if (override && Array.isArray(override.pos)) return override;
    const entry = manifest?.all?.find(a => a.id === avatarId);
    if (entry?.camera) return entry.camera;
    return DEFAULT_CAMERA;
}

// Merge a partial slider patch (posY / posZ / lookY / fov) onto a base camera.
export function mergeCameraPatch(base, patch) {
    const next = {
        pos: [...(base?.pos || DEFAULT_CAMERA.pos)],
        lookY: base?.lookY ?? DEFAULT_CAMERA.lookY,
        fov: base?.fov ?? DEFAULT_CAMERA.fov
    };
    if (patch.posY !== undefined) next.pos[1] = patch.posY;
    if (patch.posZ !== undefined) next.pos[2] = patch.posZ;
    if (patch.lookY !== undefined) next.lookY = patch.lookY;
    if (patch.fov !== undefined) next.fov = patch.fov;
    return next;
}
