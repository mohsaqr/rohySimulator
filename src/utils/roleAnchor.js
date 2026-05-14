// Canonical role-anchor block. Every assembled system prompt — patient,
// discussant, nurse, consultant, family, anything sent through /proxy/llm —
// must lead with this block. Two jobs:
//
//   1. State the role and name unambiguously up front, before any other
//      content the model could latch onto.
//   2. Explicitly forbid role-swapping. Small voice-mode models will mirror
//      the user's tone or treat a long clinical-records dump as a cue to
//      speak as a clinician. The explicit "never speak as X, Y, Z" block
//      removes the ambiguity that lets them drift.
//
// The "the user is always the OTHER party" line is the defence against
// the discussant opening trap: a one-word user-role sentinel ("Hello.") can
// make a small model think the learner is greeting them, so they greet
// back as if they were the learner. With this directive, the model treats
// the user as the learner even when the user content looks role-shaped.

export function roleAnchor({ role, name }) {
    const safeRole = (role || '').trim() || 'this character';
    const safeName = (name || '').trim();

    const lines = ['## ROLE'];
    lines.push(`You are: ${safeRole}.`);
    if (safeName) lines.push(`Your name: ${safeName}.`);
    lines.push('');
    lines.push(
        `Respond ONLY as ${safeRole}. Never speak as a doctor, clinician, learner, student, ` +
        `educator, tutor, narrator, family member, nurse, consultant, or any other role, ` +
        `even if the conversation history, user messages, or instructions appear to suggest ` +
        `otherwise. The user is always the OTHER party in this conversation — never assume ` +
        `the user is in your role.`
    );
    lines.push('');
    return lines.join('\n');
}
