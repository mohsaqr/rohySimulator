import React, { useMemo } from 'react';
import { Bell, CheckCircle, AlertTriangle, XCircle, Info } from 'lucide-react';
import { useNotifications } from '../useNotifications';
import { SURFACES, SEVERITY } from '../types';

const ICON = {
    [SEVERITY.SUCCESS]: CheckCircle,
    [SEVERITY.INFO]: Info,
    [SEVERITY.WARNING]: AlertTriangle,
    [SEVERITY.ERROR]: XCircle,
    [SEVERITY.CRITICAL]: AlertTriangle,
    [SEVERITY.DEBUG]: Info,
};

const COLOR = {
    [SEVERITY.SUCCESS]: 'text-green-400',
    [SEVERITY.INFO]: 'text-blue-400',
    [SEVERITY.WARNING]: 'text-yellow-400',
    [SEVERITY.ERROR]: 'text-red-400',
    [SEVERITY.CRITICAL]: 'text-red-300',
    [SEVERITY.DEBUG]: 'text-neutral-400',
};

// Surface that renders the full notification history. Embedded in the alarm
// tab and the notifications settings panel so a clinician can review what
// fired even after a "mute all" + "DND" combo.
export default function HistorySurface({ filter, limit = 50, showAcknowledged = true }) {
    const { history, acked } = useNotifications();

    const items = useMemo(() => {
        const acks = new Set(acked);
        const filtered = history
            .filter(n => Array.isArray(n.routedSurfaces) ? n.routedSurfaces.includes(SURFACES.HISTORY) : true)
            .filter(n => !filter || filter(n))
            .filter(n => showAcknowledged || !acks.has(n.key))
            .slice(-limit)
            .reverse();
        return filtered;
    }, [history, acked, filter, limit, showAcknowledged]);

    if (items.length === 0) {
        return <div className="text-sm text-neutral-500 italic">No notifications.</div>;
    }

    return (
        <div className="space-y-1.5">
            {items.map(n => {
                const Icon = ICON[n.severity] || Bell;
                const color = COLOR[n.severity] || 'text-neutral-400';
                const time = new Date(n.atTs || n.createdAt).toLocaleTimeString();
                return (
                    <div key={n.id} className="flex items-start gap-2 px-3 py-2 bg-neutral-900/60 border border-neutral-800 rounded text-xs">
                        <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${color}`} />
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <span className={`font-semibold uppercase tracking-wide ${color}`}>{n.severity}</span>
                                <span className="text-neutral-500">{n.source}</span>
                                <span className="text-neutral-600 ml-auto">{time}</span>
                            </div>
                            {n.title && <div className="text-neutral-200 font-medium mt-0.5">{n.title}</div>}
                            <div className="text-neutral-300 truncate">{n.message}</div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
