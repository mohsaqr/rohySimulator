# Medkit App Module Audit

Files reviewed:
- `medkit-app/package.json`
- `medkit-app/src/*`
- `medkit-app/backend/server.py`
- `medkit-app/scripts/test/*`

Enterprise assessment:
- Nested app is a separate React/Three/LiveKit package using TypeScript and its own build/test scripts.
- Existing tests focus on custom tools and loop commands rather than runtime UI, voice, game, or backend behavior.

Findings:
- High: Medkit has very limited product/runtime tests relative to its complexity. Major UI flows, voice conversation state, agent calls, game state, and backend token handling need coverage before enterprise use.
- Medium: comments note TODO verification for agent/event wire shapes. Contract drift between agent, backend, and UI is a realistic integration risk.
- Medium: localStorage is used for conversation/onboarding/music state. User scoping and cleanup policy should be documented if used on shared devices.

Recommended next tests:
- Add TypeScript unit tests for `voice/conversation.ts`, `voice/conversationStore.ts`, `agents/customTools.ts`, and `agents/managedAgent.ts`.
- Add component tests for mode selection, encounter, debrief, end confirmation, and voice panel flows.
- Add backend tests for `/voice/token` and any patient/agent streaming proxy endpoints.

Status:
- No code change made in this module during this pass.
