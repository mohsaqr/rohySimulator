import { useEffect, useState } from 'react';
import { FlaskConical, GraduationCap, MessageCircle, Scan, Stethoscope } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';

// Bottom navigation bar shared across every in-session surface — main
// chat, PhysicalExamScreen, InvestigationsScreen, DiscussionScreen.
// Lets the user hop directly between rooms without going back to the
// chat first.
//
// `currentRoom` is one of: 'chat' | 'examination' | 'lab' |
// 'radiology' | 'consultant'. All five are peer rooms — visiting the
// Consultant doesn't end the session; that's a separate action wired
// up by the patient room's End & Debrief button.
//
// Visual treatment: each room carries its own accent so the active
// state reinforces "you're in the lab" / "you're in radiology" with a
// colour the user already associates with that room (purple lab, cyan
// imaging, amber debrief). At rest the buttons are quiet — the room
// icon shows the modality tint but the chrome stays neutral. Only the
// active room fills + underlines in its accent.
//
// `sessionId` opt-in: when present, the navigator polls lab + radiology
// orders for ready-but-unviewed counts and renders a small notification
// dot on the matching button. Replaces the floating "Ordered Tests"
// mini-window that used to clutter the patient screen (retired
// 2026-05-14). Skip the prop on test mounts that don't need the badge.
const ROOM_DEFS = [
    {
        key: 'chat',
        label: 'Patient',
        sub: 'chat',
        icon: MessageCircle,
        iconText: 'text-rose-300',
        activeText: 'text-rose-200',
        activeBg: 'bg-rose-500/15',
        activeRing: 'ring-rose-500/30',
        activeBar: 'bg-rose-400',
    },
    {
        key: 'examination',
        label: 'Examination',
        sub: 'physical exam',
        icon: Stethoscope,
        iconText: 'text-emerald-300',
        activeText: 'text-emerald-200',
        activeBg: 'bg-emerald-500/15',
        activeRing: 'ring-emerald-500/30',
        activeBar: 'bg-emerald-400',
    },
    {
        key: 'lab',
        label: 'Laboratory',
        sub: 'investigations',
        icon: FlaskConical,
        iconText: 'text-purple-300',
        activeText: 'text-purple-200',
        activeBg: 'bg-purple-500/15',
        activeRing: 'ring-purple-500/30',
        activeBar: 'bg-purple-400',
        badgeAccent: 'bg-emerald-500 text-emerald-50 ring-emerald-300/40',
    },
    {
        key: 'radiology',
        label: 'Radiology',
        sub: 'imaging',
        icon: Scan,
        iconText: 'text-cyan-300',
        activeText: 'text-cyan-200',
        activeBg: 'bg-cyan-500/15',
        activeRing: 'ring-cyan-500/30',
        activeBar: 'bg-cyan-400',
        badgeAccent: 'bg-emerald-500 text-emerald-50 ring-emerald-300/40',
    },
    {
        key: 'consultant',
        label: 'Consultant',
        sub: 'debrief',
        icon: GraduationCap,
        iconText: 'text-amber-300',
        activeText: 'text-amber-200',
        activeBg: 'bg-amber-500/15',
        activeRing: 'ring-amber-500/30',
        activeBar: 'bg-amber-400',
    },
];

// 10s cadence matches OrdersDrawer's polling cost-vs-staleness tradeoff
// closely enough that the badge feels live without doubling the request
// rate. Slightly off-phase from OrdersDrawer's 5s on purpose so two
// surfaces don't fire on the exact same tick.
const POLL_INTERVAL_MS = 10000;

function useReadyCounts(sessionId) {
    const [counts, setCounts] = useState({ lab: 0, radiology: 0 });

    useEffect(() => {
        // No session, no polling. Counts stay at whatever they were on
        // the previous session; the badge render gates on sessionId so
        // the stale value never shows. Avoids a setState-in-effect lint
        // warning (the rule discourages eager resets here).
        if (!sessionId) return undefined;
        let cancelled = false;
        const tick = async () => {
            try {
                const [labRes, radRes] = await Promise.all([
                    apiFetch(`/sessions/${sessionId}/orders`).catch(() => ({ orders: [] })),
                    apiFetch(`/sessions/${sessionId}/radiology-orders`).catch(() => ({ orders: [] })),
                ]);
                if (cancelled) return;
                const lab = (labRes?.orders || []).filter((o) => o.is_ready && !o.viewed_at).length;
                const radiology = (radRes?.orders || []).filter((o) => o.is_ready && !o.viewed_at).length;
                setCounts({ lab, radiology });
            } catch {
                // Swallow — transient fetch failures shouldn't blank the
                // badge; the next tick will refresh it.
            }
        };
        tick();
        const id = setInterval(tick, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(id); };
    }, [sessionId]);

    return counts;
}

export default function RoomNavigator({ currentRoom, onSelectRoom, sessionId = null }) {
    const counts = useReadyCounts(sessionId);
    return (
        <nav
            className="flex items-stretch gap-1 px-3 py-2 bg-slate-950/95 backdrop-blur border-t border-slate-800 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.6)]"
            aria-label="Room navigation"
        >
            {ROOM_DEFS.map((room) => (
                <RoomButton
                    key={room.key}
                    room={room}
                    active={currentRoom === room.key}
                    badge={room.key === 'lab' ? counts.lab : room.key === 'radiology' ? counts.radiology : 0}
                    onClick={() => onSelectRoom(room.key)}
                />
            ))}
        </nav>
    );
}

function RoomButton({ room, active, badge, onClick }) {
    const Icon = room.icon;
    // The badge accent is only declared on lab/radiology room defs, so
    // its absence doubles as the gate for "this room never shows a badge."
    const showBadge = badge > 0 && Boolean(room.badgeAccent);
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            aria-label={showBadge ? `${room.label} — ${badge} ready ${badge === 1 ? 'result' : 'results'}` : room.label}
            className={`relative flex-1 px-4 py-2.5 rounded-lg flex items-center justify-center gap-2.5 transition-colors group ${
                active
                    ? `${room.activeBg} ring-1 ${room.activeRing}`
                    : 'hover:bg-slate-900/60'
            }`}
        >
            <div className="relative">
                <Icon className={`w-5 h-5 transition-colors ${
                    active ? room.iconText : `${room.iconText} opacity-60 group-hover:opacity-100`
                }`} />
                {showBadge && (
                    <span
                        className={`absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold leading-4 text-center ring-2 ring-slate-950 ${room.badgeAccent}`}
                    >
                        {badge > 9 ? '9+' : badge}
                    </span>
                )}
            </div>
            <div className="flex flex-col items-start leading-tight">
                <span className={`text-sm font-semibold ${
                    active ? 'text-white' : 'text-slate-300 group-hover:text-white'
                }`}>
                    {room.label}
                </span>
                <span className={`text-[10px] uppercase tracking-wider ${
                    active ? room.activeText : 'text-slate-500'
                }`}>
                    {room.sub}
                </span>
            </div>
            {active && (
                <span className={`absolute left-3 right-3 -bottom-px h-0.5 rounded-full ${room.activeBar}`} />
            )}
        </button>
    );
}
