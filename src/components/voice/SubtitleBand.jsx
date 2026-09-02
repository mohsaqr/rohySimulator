/**
 * The spoken caption.
 *
 * Extracted verbatim from ChatInterface (and previously copied into
 * DiscussionScreen) so every room shows one subtitle, not three that drift.
 * The visual mechanism is unchanged: a feathered ellipse of dim + blur that
 * sits only behind the text and fades to fully transparent at the edges —
 * never a full-screen scrim — with the whole strip click-through except the
 * caption itself.
 *
 * @param {string|null} line The text to show; nothing renders without one.
 * @param {boolean} [listening] The line is the learner's own recognised
 *   speech rather than the patient's — shown in italics.
 * @param {string} [speaker] Optional small label above the line. The chat
 *   room passes none, by prior request.
 * @param {number} [maxLines] Clamp the line to this many rows (a long
 *   opening line must not grow down over whatever sits below the strip).
 * @param {string} [anchor] CSS `top` for the strip; each room anchors to its
 *   own layout (the chat glues it under the resp waveform).
 * @param {() => void} [onClick] Click anywhere on the haze — the chat uses
 *   this to bring the transcript back.
 * @param {string} [label] Accessible name for that click target.
 */
export default function SubtitleBand({
    line,
    listening = false,
    maxLines = null,
    speaker = null,
    anchor = 'calc(29rem + 1cm)',
    onClick = null,
    label = null,
}) {
    if (!line) return null;

    // Haze: a feathered ellipse of dim+blur sitting only behind the caption,
    // fading to fully transparent at the edges. Mask-image is the mechanism.
    const hazeMask = 'radial-gradient(ellipse 50% 60% at 50% 50%, rgba(0,0,0,1) 25%, rgba(0,0,0,0) 90%)';
    const Strip = onClick ? 'button' : 'div';

    return (
        <Strip
            {...(onClick ? { type: 'button', onClick, 'aria-label': label ?? undefined } : {})}
            // pointer-events-none on the full-width strip so it never swallows
            // taps meant for the controls behind it; only the caption block
            // re-enables them to stay dismissable.
            className="fixed inset-x-0 z-40 flex justify-center items-center px-6 py-8 text-center group pointer-events-none"
            style={{ top: anchor, background: 'transparent' }}
        >
            <div
                aria-hidden
                className="absolute inset-0 backdrop-blur-sm"
                style={{
                    backgroundColor: 'rgba(0,0,0,0.30)',
                    WebkitMaskImage: hazeMask,
                    maskImage: hazeMask,
                }}
            />
            <div
                className={`relative max-w-2xl ${onClick ? 'pointer-events-auto cursor-pointer' : ''}`}
                style={{ textShadow: '0 2px 8px rgba(0,0,0,0.95), 0 0 18px rgba(0,0,0,0.75)' }}
            >
                {speaker && (
                    <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-teal-300">
                        {speaker}
                    </p>
                )}
                <p
                    style={maxLines ? {
                        display: '-webkit-box',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: maxLines,
                        overflow: 'hidden',
                    } : undefined}
                    className={`text-xl md:text-2xl font-medium leading-snug whitespace-pre-wrap break-words ${
                        listening ? 'italic text-white/70' : 'text-white'
                    }`}
                >
                    {line}
                </p>
            </div>
        </Strip>
    );
}
