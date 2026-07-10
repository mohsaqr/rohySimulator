// Markdown residue removal for LLM patient/agent replies. The server bans
// markdown at the source (PLAIN_SPEECH_RULES in systemPromptAssembly.js),
// but models still leak it — and chat bubbles render msg.content verbatim
// while TTS speaks the same string, so `**`, `##` and list markers would be
// shown and read aloud. This is the client-side safety net.
//
// Philosophy mirrors stageDirections.js: only fully-closed pairs are
// unwrapped, so an in-flight stream that has emitted `**bold` but not yet
// `**` is left alone until the closing marker arrives. Single-asterisk pairs
// are NOT handled here — they are stage directions (`*nods*`) and are
// DELETED by stripStageDirections, which sanitizeResponseText runs after
// the markdown unwrap (order matters: running stage directions first would
// mangle `**bold**` into a stray `**`). Single underscores are left alone
// (false-positive risk on names_like_this).

import { stripStageDirections } from './stageDirections';

/**
 * Remove markdown markup, keeping the human-readable text.
 * @param {string} text  Raw LLM output (possibly mid-stream).
 * @returns {string} The text with markdown markers removed; non-strings
 *   pass through untouched.
 */
export function stripMarkdown(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/^```[^\n]*$/gm, '')                  // code-fence lines
        .replace(/`([^`\n]+)`/g, '$1')                 // inline code
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')      // images → alt text
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')       // links → link text
        .replace(/\*\*([^*\n]+)\*\*/g, '$1')           // **bold**
        .replace(/__([^_\n]+)__/g, '$1')               // __bold__
        .replace(/^#{1,6}\s+/gm, '')                   // # headings
        .replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, '')  // horizontal rules
        .replace(/^\s*[-*+]\s+/gm, '')                 // bullet markers
        .replace(/^\s*\d+[.)]\s+/gm, '')               // numbered-list markers
        .replace(/^\s*>\s?/gm, '')                     // blockquote markers
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Full response sanitizer for anything displayed in a chat bubble or fed to
 * TTS: markdown unwrapped first, then `*stage directions*` deleted.
 * @param {string} text  Raw LLM output (possibly mid-stream).
 * @returns {string}
 */
export function sanitizeResponseText(text) {
    return stripStageDirections(stripMarkdown(text));
}
