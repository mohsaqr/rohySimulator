import { manifest } from './manifest.js';
import Exam3DScreen from './Exam3DScreen.jsx';

/**
 * The 3D patient room, expressed as an RPS-1 plugin.
 *
 * This file is the whole adapter between the host context and the room
 * screen's own prop vocabulary. The screen keeps taking `activeCase`,
 * `sessionId`, `onOpenDrawer` and `conversation` — the names it was built
 * with — and this is where the generic context is renamed into them.
 *
 * Availability is total by construction: the room shows whatever patient the
 * case has, so the only thing that can make it unavailable is a case that
 * has not loaded at all.
 */
export default {
    manifest,
    component: Exam3DScreen,
    available: (ctx) => Boolean(ctx?.session?.caseId),
    props: (ctx) => ({
        activeCase: ctx.patientCase ?? null,
        sessionId: ctx.session.id,
        onOpenDrawer: ctx.capabilities.openDrawer ?? null,
        conversation: ctx.capabilities.conversation ?? null,
        // The narrowed logger and the live vitals getter (RPS-1 1.6): the
        // screen no longer imports the EventLogger singleton.
        log: ctx.log,
        vitals: ctx.capabilities.vitals ?? null,
    }),
};
