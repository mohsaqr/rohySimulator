// Server-side system-prompt assembly. Pulled into its own helper so the
// ordering invariant is unit-testable in isolation, without spinning up
// the full /proxy/llm route (auth, DB, fetch, audit chain, …).
//
// Ordering invariant (changed 2026-05):
//   1. Case-specific `system_prompt` (assembled by the client — ChatInterface
//      builds persona, instructions, case design context, vitals, etc.) leads.
//   2. Platform-wide `systemPromptTemplate`, if an admin has set one
//      explicitly, trails as a behavioral reminder.
//
// Prior to this change the platform template was *prepended*, which shadowed
// the case persona and was the root cause of "the model ignores my case"
// reports. The shipped default systemPromptTemplate is now empty.

const SEPARATOR = '\n\n---\n\n';

// Coerce route-body inputs to a trimmed string. system_prompt and
// systemPromptTemplate can technically arrive as anything (object, number,
// null) from req.body if a buggy client / test sends them that way — fall
// back to '' rather than crashing in .trim().
function toTrimmedString(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    return String(value).trim();
}

/**
 * Assemble the final system prompt sent to the LLM.
 *
 * @param {object} parts
 * @param {string} [parts.system_prompt]         The case-built prompt (leads).
 * @param {string} [parts.systemPromptTemplate]  Optional platform reminder (trails).
 * @returns {string}
 */
export function assembleSystemPrompt({ system_prompt = '', systemPromptTemplate = '' } = {}) {
    const leading = toTrimmedString(system_prompt);
    const trailing = toTrimmedString(systemPromptTemplate);
    if (leading && trailing) return `${leading}${SEPARATOR}${trailing}`;
    if (leading) return leading;
    if (trailing) return trailing;
    return '';
}
