import { useEffect, useState } from 'react';

/**
 * Hold the caption until the audio has a head start.
 *
 * True word-boundary timing is not available across all four TTS providers,
 * so the caption waits out ~30% of the estimated speech length (capped at
 * 4s) rather than appearing complete while the voice is still on its first
 * word. Extracted from the identical copies in ChatInterface and
 * DiscussionScreen.
 *
 * @param {boolean} speaking Whether speech is currently playing.
 * @param {string} text The line that will be spoken, for length estimation.
 * @return {boolean} Whether the caption may be shown.
 */
export function useSubtitleReveal(speaking, text) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!speaking) return undefined;
        const estimatedMs = Math.max(1000, ((text || '').length / 15) * 1000);
        const lagMs = Math.min(estimatedMs * 0.30, 4000);
        const timer = setTimeout(() => setReady(true), lagMs);
        // Reset on the way out rather than in the effect body, so the gate
        // never sets state synchronously during a render pass.
        return () => {
            clearTimeout(timer);
            setReady(false);
        };
        // Deliberately not depending on `text`: the gate opens once per
        // utterance, not on every token that lands mid-stream.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [speaking]);

    // Gated on `speaking` too: a stale `true` can never outlive the voice.
    return speaking && ready;
}
