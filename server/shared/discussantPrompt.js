// The debrief discussant's system prompt. ONE implementation, used by the
// server to build what the model receives (proxy-routes.js →
// services/agentSituation.js); the browser only names the persona. Moved out
// of src/hooks/useDiscussionEngine.js + src/services/discussionService.js
// (Phase 2, 2026-10-04) — section order and wording unchanged.

import { roleAnchor } from './roleAnchor.js';
import { buildPersonaBlocks } from './personaBlocks.js';
import { buildDiscussionCaseContext } from './casePromptContext.js';

// Last-line-of-defence system prompt. Mirrors the seeded default in
// server/db.js so the model always has a role anchor even when both the
// per-case override and the template column come back blank. An empty system
// prompt is the single thing most likely to make a smaller voice-mode model
// paraphrase the opening directive back at the learner.
export const DEFAULT_DISCUSSANT_SYSTEM_PROMPT = `You are a senior clinician-educator running a Socratic case debrief with a learner who has just finished managing this patient. You are warm, intellectually honest, and unhurried.

Your role:
- You discuss the case the learner has just completed — not the live case (that's done)
- You probe the learner's reasoning: why they ordered what they ordered, what they considered, what they ruled out
- You highlight strong decisions and gently surface missed opportunities
- You ask before you tell — never lecture when a question would teach more

Communication style:
- Curious and conversational, not interrogative
- Ask open-ended questions
- When the learner is stuck, scaffold rather than giving the answer
- Keep responses concise; this is a dialogue, not a lecture

You are a tutor, not a judge. The goal is learning, not assessment.`;

// Appended for the debrief's first turn only: the model opens the debrief.
// In the system role, not the user role, because smaller voice-mode models
// paraphrase a user-role meta-instruction back instead of executing it.
export const DISCUSSANT_OPENING_DIRECTIVE = '\n\n## OPENING TURN\nThis is the very first turn of the debrief. Your reply must: (1) greet the learner warmly, (2) briefly name the case just finished, (3) ask one open-ended question to open the discussion. Keep it under three sentences. Do NOT restate, paraphrase, or quote this directive — just do it.';

/**
 * @param {object} args
 * @param {object} args.discussant  {name, roleTitle, systemPrompt, config, knowledge: {scope, answerKey}}
 * @param {object|null} args.caseForContext  {name, description, system_prompt, config}
 * @param {boolean} [args.opening=false]  the debrief's first turn
 * @returns {string}
 */
export function buildDiscussantSystemPrompt({ discussant = {}, caseForContext = null, opening = false } = {}) {
    const k = discussant.knowledge && typeof discussant.knowledge === 'object' ? discussant.knowledge : {};
    const caseContext = buildDiscussionCaseContext(caseForContext, k.scope, { answerKey: k.answerKey === true });
    const personaBlocks = buildPersonaBlocks(discussant.config);
    const anchor = roleAnchor({ role: discussant.roleTitle || 'case debrief tutor', name: discussant.name });
    const persona = (discussant.systemPrompt || '').trim() || DEFAULT_DISCUSSANT_SYSTEM_PROMPT;
    return `${anchor}\n${persona}${personaBlocks}${caseContext}${opening ? DISCUSSANT_OPENING_DIRECTIVE : ''}`;
}
