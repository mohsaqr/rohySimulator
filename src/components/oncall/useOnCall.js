// Everything App needs for the on-call phone: the case's specialists (with
// live paging state) and whether the handset is open. App owns it so the
// "On call" button can live in the room navigator while the handset floats
// above every room, plugin rooms included.

import { useState } from 'react';
import { useOnCallTeam } from './useOnCallTeam';

export function useOnCall(sessionId) {
    const team = useOnCallTeam(sessionId);
    const [openFor, setOpenFor] = useState(null);
    // Open state belongs to one session: a new case starts with the phone shut.
    const open = Boolean(sessionId) && openFor === sessionId;
    // Every case session has the phone, specialists or not (OnCallButton).
    const available = Boolean(sessionId);
    return {
        team,
        available,
        open: open && available,
        toggle: () => setOpenFor(prev => (prev === sessionId ? null : sessionId)),
        close: () => setOpenFor(null),
    };
}
