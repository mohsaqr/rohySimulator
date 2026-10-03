// Plugin switches. Turning a plugin off removes its room and all of its
// behavior; the core app is unchanged either way.
export const ROOM3D_ENABLED = true;

// The patient portrait circle. Off (the default) keeps the pre-3D portrait:
// the head avatar, face-on, exactly as before the 3D room existed. On, the
// circle becomes a camera on the 3D room's bed, framed by BEDSIDE_VIEW and
// BEDSIDE_HEAD_DIRECTION below. It only applies while ROOM3D_ENABLED.
export const BEDSIDE_PORTRAIT = false;

// How the bedside camera composes the patient when BEDSIDE_PORTRAIT is on.
// One of BEDSIDE_VIEWS: "three-quarter" (from above and toward the head),
// "profile" (side-on, 90° to the body), "head-up" (from the foot of the bed,
// head at the top of the frame), "overhead" (the same, steeper).
export const BEDSIDE_VIEWS = Object.freeze(['three-quarter', 'profile', 'head-up', 'overhead']);
export const BEDSIDE_VIEW = 'three-quarter';

// Which way the head runs across the side views: "right" or "left". The
// foot-of-bed views are symmetric and ignore it.
export const BEDSIDE_HEAD_DIRECTIONS = Object.freeze(['right', 'left']);
export const BEDSIDE_HEAD_DIRECTION = 'right';
