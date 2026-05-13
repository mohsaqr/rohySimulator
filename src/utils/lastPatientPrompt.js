// Module-level cache of the most recently assembled patient system prompt
// (the exact string ChatInterface.buildPatientSystemPrompt produced and
// shipped to LLMService). Mirrors the lastTtsRequest pattern in voiceService.
//
// Purpose: give the DiagnosticBar a "show me what the model actually saw"
// button so admins/educators can stop guessing why a case is behaving oddly.
// Per the project's "never assume what a function returns" rule, inspecting
// the actual assembled prompt beats reasoning about it.

let lastPrompt = null;

export function setLastPatientPrompt(payload) {
    if (!payload || typeof payload.prompt !== 'string') {
        lastPrompt = null;
        return;
    }
    lastPrompt = {
        prompt: payload.prompt,
        caseId: payload.caseId ?? null,
        caseName: payload.caseName ?? null,
        sessionId: payload.sessionId ?? null,
        timestamp: new Date().toISOString(),
    };
}

export function getLastPatientPrompt() {
    return lastPrompt;
}

export function clearLastPatientPrompt() {
    lastPrompt = null;
}
