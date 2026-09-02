// 3D examination regions for the supine patient, in the room package's
// patient space. Ids are Rohy's own BODY_REGIONS ids, so a click reports a
// region the exam data model already understands.
//
// Orientation: the patient lies head toward -z, face up; the patient's
// anatomical LEFT is +x (standing glTF avatars face +z with the left hand at
// +x, and the supine pose rotates about x only).
//
// Regions not reachable on a supine anterior view (back, buttocks, …) stay
// available through the panel's full region list — nothing is lost.
export const SUPINE_REGIONS_3D = [
    { id: 'head', label: 'Head', center: [0, 1.62, -1.45], size: [0.42, 0.4, 0.5] },
    { id: 'neck', label: 'Neck', center: [0, 1.52, -1.12], size: [0.3, 0.28, 0.24] },
    { id: 'chestAnterior', label: 'Anterior chest', center: [0, 1.52, -0.6], size: [0.85, 0.42, 0.7] },
    // Slightly taller than the chest so its footprint wins the raycast.
    { id: 'heart', label: 'Precordium', center: [0.12, 1.56, -0.55], size: [0.3, 0.42, 0.35] },
    { id: 'abdomen', label: 'Abdomen', center: [0, 1.46, 0.15], size: [0.8, 0.36, 0.75] },
    { id: 'pelvis', label: 'Pelvis', center: [0, 1.44, 0.8], size: [0.8, 0.34, 0.5] },
    { id: 'upperArmLeft', label: 'Left upper arm', center: [0.6, 1.44, -0.6], size: [0.26, 0.3, 0.7] },
    { id: 'upperArmRight', label: 'Right upper arm', center: [-0.6, 1.44, -0.6], size: [0.26, 0.3, 0.7] },
    { id: 'forearmLeft', label: 'Left forearm', center: [0.68, 1.42, 0.1], size: [0.26, 0.28, 0.7] },
    { id: 'forearmRight', label: 'Right forearm', center: [-0.68, 1.42, 0.1], size: [0.26, 0.28, 0.7] },
    { id: 'handLeft', label: 'Left hand', center: [0.72, 1.4, 0.6], size: [0.26, 0.24, 0.4] },
    { id: 'handRight', label: 'Right hand', center: [-0.72, 1.4, 0.6], size: [0.26, 0.24, 0.4] },
    { id: 'thighLeft', label: 'Left thigh', center: [0.28, 1.44, 1.3], size: [0.4, 0.32, 0.75] },
    { id: 'thighRight', label: 'Right thigh', center: [-0.28, 1.44, 1.3], size: [0.4, 0.32, 0.75] },
    { id: 'lowerLegLeft', label: 'Left lower leg', center: [0.3, 1.4, 1.85], size: [0.36, 0.3, 0.5] },
    { id: 'lowerLegRight', label: 'Right lower leg', center: [-0.3, 1.4, 1.85], size: [0.36, 0.3, 0.5] },
    { id: 'footLeft', label: 'Left foot', center: [0.32, 1.38, 2.15], size: [0.34, 0.28, 0.4] },
    { id: 'footRight', label: 'Right foot', center: [-0.32, 1.38, 2.15], size: [0.34, 0.28, 0.4] },
];
