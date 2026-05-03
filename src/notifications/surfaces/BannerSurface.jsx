import React, { useMemo } from 'react';
import { AlertTriangle, Bell } from 'lucide-react';
import { useNotifications } from '../useNotifications';
import { SURFACES, SEVERITY } from '../types';

// Top banner. Used for clinical critical/error/warning that the user must
// see even if they're looking at a different panel. Stacks vertically.
export default function BannerSurface() {
    const { active, ack, snooze } = useNotifications();

    const banners = useMemo(() => {
        return active.filter(n => Array.isArray(n.routedSurfaces) && n.routedSurfaces.includes(SURFACES.BANNER));
    }, [active]);

    if (banners.length === 0) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-[9998] flex flex-col gap-1 pointer-events-none">
            {banners.map(n => <BannerCard key={n.id} n={n} onAck={() => ack(n.key)} onSnooze={() => snooze(n.key)} />)}
        </div>
    );
}

function BannerCard({ n, onAck, onSnooze }) {
    const isCritical = n.severity === SEVERITY.CRITICAL;
    const palette = isCritical
        ? 'bg-red-900/95 border-red-500 text-red-50'
        : n.severity === SEVERITY.ERROR
            ? 'bg-red-900/85 border-red-600 text-red-100'
            : 'bg-yellow-900/85 border-yellow-600 text-yellow-100';
    return (
        <div className={`pointer-events-auto px-4 py-2 border-b shadow-lg backdrop-blur-sm flex items-center gap-3 ${palette} ${isCritical ? 'animate-pulse' : ''}`}>
            {isCritical ? <AlertTriangle className="w-5 h-5 flex-shrink-0" /> : <Bell className="w-5 h-5 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
                <span className="font-bold uppercase text-xs tracking-wider mr-2">{n.severity}</span>
                {n.title && <span className="font-semibold mr-2">{n.title}</span>}
                <span className="text-sm">{n.message}</span>
                {n.count > 1 && <span className="ml-2 px-1.5 py-0.5 rounded bg-black/30 text-xs">×{n.count}</span>}
            </div>
            <button
                onClick={onSnooze}
                className="text-xs px-2 py-1 rounded bg-yellow-700/50 hover:bg-yellow-600/60 text-white"
                title="Snooze"
            >
                Snooze
            </button>
            <button
                onClick={onAck}
                className="text-xs px-2 py-1 rounded bg-green-700/60 hover:bg-green-600/70 text-white font-semibold"
                title="Acknowledge"
            >
                Acknowledge
            </button>
        </div>
    );
}
