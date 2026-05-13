import { FlaskConical, GraduationCap, MessageCircle, Scan, Stethoscope } from 'lucide-react';

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

export default function RoomNavigator({ currentRoom, onSelectRoom }) {
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
                    onClick={() => onSelectRoom(room.key)}
                />
            ))}
        </nav>
    );
}

function RoomButton({ room, active, onClick }) {
    const Icon = room.icon;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`relative flex-1 px-4 py-2.5 rounded-lg flex items-center justify-center gap-2.5 transition-colors group ${
                active
                    ? `${room.activeBg} ring-1 ${room.activeRing}`
                    : 'hover:bg-slate-900/60'
            }`}
        >
            <Icon className={`w-5 h-5 transition-colors ${
                active ? room.iconText : `${room.iconText} opacity-60 group-hover:opacity-100`
            }`} />
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
