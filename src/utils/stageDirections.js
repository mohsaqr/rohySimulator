// Strip "*action*" stage directions / asterisk-wrapped roleplay descriptors
// from LLM patient output. Patients sometimes emit them (`*nods*`, `*clutches
// chest*`) despite the system prompt telling them not to — these should never
// be displayed to the trainee or spoken aloud by TTS.
//
// Only fully-closed pairs are stripped, so an in-flight stream that has
// emitted `*clutches` but not yet `chest*` is left alone until the closing
// asterisk arrives. Underscore-wrapped variants (`_action_`) are left alone
// because they're rare and risk false positives on legitimate emphasis.

export function stripStageDirections(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/\*[^*\n]+\*/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([.,!?;:])/g, '$1')
        .trim();
}
