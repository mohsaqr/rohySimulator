// Bottom room navigator — copied from rohySimulator-oyonv2
// src/components/common/RoomNavigator.jsx. Two data-contract adaptations:
//   • rohy's fixed clinical ROOM_DEFS (Patient/Examination/Lab/Radiology/
//     Consultant) become a `rooms` prop — chatoyon's rooms are the class's
//     lessons plus the Tutor chat room, so the list is data, not a constant.
//     Each room keeps rohy's exact shape: { key, label, sub, icon, iconText,
//     activeText, activeBg, activeRing, activeBar, badgeAccent? }.
//   • rohy's useReadyCounts polling (lab/radiology order readiness) has no
//     chatoyon analog; the badge slot stays and is driven by a `badges` map
//     ({ [roomKey]: count }) — e.g. unvisited lessons.
// RoomButton and the nav markup are rohy's, verbatim.

// Visual treatment (rohy's): each room carries its own accent so the active
// state reinforces "you're in this room" with a colour the user associates
// with it. At rest the buttons are quiet — the room icon shows the tint but
// the chrome stays neutral. Only the active room fills + underlines.
export default function RoomNavigator({ rooms, currentRoom, onSelectRoom, badges = {} }) {
    return (
        <nav
            className="flex items-stretch gap-1 px-3 py-2 bg-slate-950/95 backdrop-blur border-t border-slate-800 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.6)]"
            aria-label="Room navigation"
        >
            {rooms.map((room) => (
                <RoomButton
                    key={room.key}
                    room={room}
                    active={currentRoom === room.key}
                    badge={badges[room.key] ?? 0}
                    onClick={() => onSelectRoom(room.key)}
                />
            ))}
        </nav>
    );
}

function RoomButton({ room, active, badge, onClick }) {
    const Icon = room.icon;
    // The badge accent is only declared on room defs that can show one, so
    // its absence doubles as the gate for "this room never shows a badge."
    const showBadge = badge > 0 && Boolean(room.badgeAccent);
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            aria-label={showBadge ? `${room.label} — ${badge} new` : room.label}
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
