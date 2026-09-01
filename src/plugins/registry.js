import { ROOM3D_ENABLED } from './config.js';
import { room3dPlugin } from './room3d/index.js';

// Rooms contributed by plugins. App renders each plugin's Screen when
// currentRoom matches its key; RoomNavigator appends each navigatorDef.
// With every switch off this is an empty array and the app is stock.
export const PLUGIN_ROOMS = [
    ...(ROOM3D_ENABLED ? [room3dPlugin] : []),
];
