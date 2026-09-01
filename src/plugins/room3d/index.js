import { lazy } from 'react';
import { Bed } from 'lucide-react';

// The 3D patient room plugin: a sixth RoomNavigator room rendering the
// rohy-3d-patient-room package bound to live case data.
//
// Everything the plugin needs lives in this directory. The core touchpoints
// (all generic, none 3D-specific) are documented in README.md next to this
// file: the plugin registry consumed by App/RoomNavigator, OrdersDrawer's
// openRequest prop, vite's three dedupe, and the file:../3D dependency.
export const room3dPlugin = {
    key: 'exam3d',
    // Falls back to labelDefault when no locale ships the key, so the plugin
    // needs no core locale edits.
    labelKey: 'room_exam3d',
    labelDefault: '3D Room',
    subKey: 'room_exam3d_sub',
    subDefault: 'immersive exam',
    // Rendered over the chat layout, which App keeps mounted (hidden + inert)
    // as the live-physiology bridge.
    coversChat: true,
    navigatorDef: {
        key: 'exam3d',
        labelKey: 'room_exam3d',
        labelDefault: '3D Room',
        subKey: 'room_exam3d_sub',
        subDefault: 'immersive exam',
        icon: Bed,
        iconText: 'text-teal-300',
        activeText: 'text-teal-200',
        activeBg: 'bg-teal-500/15',
        activeRing: 'ring-teal-500/30',
        activeBar: 'bg-teal-400',
    },
    Screen: lazy(() => import('./Exam3DScreen.jsx')),
};
