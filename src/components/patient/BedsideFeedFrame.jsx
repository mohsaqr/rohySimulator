// Viewfinder chrome for the patient portrait.
//
// The portrait already renders a live 3D avatar — it IS a camera, it was
// just framed as a photograph against nothing. Since the 3D room now puts
// the SAME resolved avatar on the bed, dressing this circle as a bedside
// feed makes the two screens read as one place: the circle is where you
// watch the patient, the room is where you go to them.
//
// Purely decorative and inert: no pointer events, hidden from assistive
// tech. Everything it indicates (who this is, whether they are speaking) is
// already conveyed by the caption and the avatar's own ring.
export default function BedsideFeedFrame({ speaking = false, label = 'BEDSIDE 01' }) {
    // Corner brackets, drawn as two borders each so they stay hairline-thin
    // at any size. Insets keep them off the circle itself.
    const bracket = 'absolute w-5 h-5 border-teal-400/45';
    return (
        <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
            <span className={`${bracket} left-1 top-1 border-l border-t rounded-tl-sm`} />
            <span className={`${bracket} right-1 top-1 border-r border-t rounded-tr-sm`} />
            <span className={`${bracket} left-1 bottom-1 border-l border-b rounded-bl-sm`} />
            <span className={`${bracket} right-1 bottom-1 border-r border-b rounded-br-sm`} />

            {/* Both labels sit on the BOTTOM row. The top corners of this
                panel already belong to real controls — the settings/language
                pill on the left, End & Debrief on the right — and a caption
                that hides behind a button is worse than no caption. The
                bottom row carries only the centred name pill, so the two
                outer thirds are free. */}
            <span className="absolute left-2.5 bottom-7 font-mono text-[9px] tracking-[0.18em] text-teal-300/70 select-none">
                {label}
            </span>

            <span className="absolute right-2.5 bottom-7 flex items-center gap-1.5 font-mono text-[9px] tracking-[0.18em] select-none">
                <span
                    className={`h-1.5 w-1.5 rounded-full transition-colors ${
                        speaking ? 'bg-rose-400 animate-pulse' : 'bg-teal-400/50'
                    }`}
                />
                <span className={speaking ? 'text-rose-300/80' : 'text-teal-300/60'}>LIVE</span>
            </span>
        </div>
    );
}
