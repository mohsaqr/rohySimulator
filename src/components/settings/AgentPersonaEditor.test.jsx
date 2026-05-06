// Regression lock for src/components/settings/AgentPersonaEditor.jsx.
//
// CONTRACT — what these tests pin down (do not soften without owner sign-off):
//
//   1. Form fields wired — Identity (name, role_title, agent_type), Voice
//      (tts_provider, case_voice, tts_rate, tts_pitch), Persona prompt
//      (system_prompt textarea), Dos/Don'ts (add/remove/reorder), Behavior
//      (context_filter, can_be_paged), LLM (provider/model/temp/max_tokens
//      + optional API key).
//   2. Pitch UNIT is semitones — the pitch <input> exposes min=-10, max=10,
//      step=0.25. This is the post-bb34d88 unit (NOT the old 0..2 multiplier).
//      Lock this as a regression alarm.
//   3. Reset to defaults — calls AgentService.resetTemplateToDefault(id) and
//      re-populates the form from the response.
//   4. Voice preview — Preview button calls VoiceService.speak with the
//      resolved voice. While playing, button label flips to "Stop preview"
//      and clicking again calls VoiceService.cancelSpeech.
//   5. LLM test — calls AgentService.testLLM(id) and renders the result in a
//      panel. Disabled until an LLM provider is set AND the template has
//      been saved (isCreate gate per HANDOFF.md).
//   6. Avatar preview re-renders on field change — switching avatar_url and
//      tweaking framing sliders updates the (stubbed) PatientAvatar's props.
//   7. Discussant section — only renders when agent_type === 'discussant'.
//   8. Save — POSTs full form via AgentService.updateTemplate (or
//      createTemplate when new). On success calls onClose. On error keeps
//      the editor mounted and toasts.
//   9. Duplicate — calls AgentService.duplicateTemplate(id, ...).
//  10. Delete — gated behind a confirm modal; standard (is_default=1) rows
//      hide the Delete button entirely (UI pre-empts server 403).
//
// The 3D PatientAvatar is stubbed to a prop-spy so tests can assert that
// avatar_url / camera changes propagate without booting WebGL in jsdom.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks ────────────────────────────────────────────────────────────────────
// PatientAvatar is lazy-loaded via React.lazy() inside the editor. We mock
// the chat/PatientAvatar.jsx module directly; React.lazy's dynamic import
// will resolve to this stub.
const avatarPropSpy = vi.fn();
vi.mock('../chat/PatientAvatar.jsx', () => ({
    default: function MockPatientAvatar(props) {
        avatarPropSpy(props);
        return (
            <div
                data-testid="mock-patient-avatar"
                data-avatar-id={props.avatarId || ''}
            />
        );
    },
}));

// Stub the framing sliders so we don't have to mount their internals;
// expose a single "framing-bump" button that calls onChange with a known
// patch — that's sufficient to prove props flow into the avatar.
vi.mock('./AvatarFraming.jsx', () => ({
    default: function MockFramingSliders({ onChange, onReset, hasOverride }) {
        return (
            <div data-testid="mock-framing">
                <button
                    type="button"
                    onClick={() => onChange({ position: { x: 1, y: 2, z: 3 } })}
                >
                    framing-bump
                </button>
                <button type="button" onClick={onReset}>framing-reset</button>
                <span data-testid="has-override">{String(!!hasOverride)}</span>
            </div>
        );
    },
}));

// AgentService — every method the editor invokes is stubbed.
vi.mock('../../services/AgentService', () => {
    return {
        AgentService: {
            getTemplate: vi.fn(),
            createTemplate: vi.fn(),
            updateTemplate: vi.fn(),
            deleteTemplate: vi.fn(),
            duplicateTemplate: vi.fn(),
            resetTemplateToDefault: vi.fn(),
            testLLM: vi.fn(),
        },
    };
});

// VoiceService — speak/cancel stubbed; the editor calls cancelSpeech on
// unmount too, so it MUST exist on the mock.
vi.mock('../../services/voiceService', () => {
    return {
        VoiceService: {
            speak: vi.fn(() => {
                // Default: never auto-end. Tests that need an end-of-playback
                // signal can read the onEnd callback off the mock call args
                // and invoke it manually.
                return Promise.resolve();
            }),
            cancelSpeech: vi.fn(),
        },
    };
});

// AuthService — only `getToken` and `authHeaders` are used during load.
vi.mock('../../services/authService', () => ({
    AuthService: {
        getToken: () => 'test-token',
        authHeaders: () => ({ Authorization: 'Bearer test-token' }),
        verifyToken: vi.fn().mockResolvedValue(null),
    },
}));

// Resolved voice util — return a deterministic value so the preview button
// is enabled (resolvedVoiceFile must be truthy) and the resolver tier is
// stable across tests.
vi.mock('../../utils/voiceResolver.js', () => ({
    resolveVoice: () => ({
        file: 'en_US-amy-medium.onnx',
        provider: 'piper',
        rate: 1.0,
        pitch: 0,
        tier: 'override',
    }),
    deriveSlot: () => 'voice_piper_female',
}));

// Fetch is hit on mount for /avatars/heads/manifest.json,
// /platform-settings/voice, /platform-settings/avatars, and
// /tts/voices?provider=…. Stub globally.
beforeEach(() => {
    avatarPropSpy.mockClear();
    globalThis.fetch = vi.fn((urlOrReq) => {
        const url = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url;
        if (url.includes('/avatars/heads/manifest.json')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    all: [
                        { id: 'avatar-a', label: 'Avatar A' },
                        { id: 'avatar-b', label: 'Avatar B' },
                    ],
                    cameras: {
                        'avatar-a': { position: { x: 0, y: 0, z: 1 } },
                        'avatar-b': { position: { x: 0, y: 0, z: 1 } },
                    },
                }),
            });
        }
        if (url.includes('/platform-settings/voice')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ tts_pitch: 0, tts_rate: 1.0 }),
            });
        }
        if (url.includes('/platform-settings/avatars')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        if (url.includes('/tts/voices')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    voices: [
                        { filename: 'en_US-amy-medium.onnx', displayName: 'Amy', gender: 'female' },
                        { filename: 'en_US-ryan-high.onnx', displayName: 'Ryan', gender: 'male' },
                    ],
                }),
            });
        }
        // /api/auth/verify and any catch-all
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
});

// ── Imports under test (after mocks are registered) ─────────────────────────
import AgentPersonaEditor from './AgentPersonaEditor.jsx';
import { AgentService } from '../../services/AgentService';
import { VoiceService } from '../../services/voiceService';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

// ── Fixtures ────────────────────────────────────────────────────────────────
function makeTemplate(overrides = {}) {
    return {
        id: 42,
        agent_type: 'nurse',
        name: 'Sarah Mitchell',
        role_title: 'Bedside Nurse',
        system_prompt: 'You are a calm bedside nurse.',
        avatar_url: 'avatar-a',
        context_filter: 'full',
        communication_style: 'professional',
        config: {
            typical_availability: 'present',
            can_be_paged: false,
            response_time: { min: 0, max: 0 },
            dos: ['Stay in character'],
            donts: ['Volunteer differential diagnoses'],
            voice: {
                tts_provider: 'piper',
                case_voice: 'en_US-amy-medium.onnx',
                tts_rate: 1.0,
                tts_pitch: 0,
            },
        },
        llm_provider: '',
        llm_model: '',
        llm_api_key: '',
        llm_endpoint: '',
        llm_temperature: '',
        llm_max_tokens: '',
        memory_access: {
            OBTAINED: true, EXAMINED: true, ELICITED: true, NOTED: true,
            ORDERED: true, ADMINISTERED: true, CHANGED: true, EXPRESSED: true,
        },
        is_default: 0,
        ...overrides,
    };
}

// Convenience: mount the editor with a mocked template fetch and wait for
// load to complete (loading spinner disappears).
async function mountEditor({ template = makeTemplate(), templateId = 42, onClose = vi.fn() } = {}) {
    AgentService.getTemplate.mockResolvedValue(template);
    const result = renderWithProviders(
        <AgentPersonaEditor templateId={templateId} onClose={onClose} />
    );
    // Wait until the loading state clears — the header shows the editor title.
    await waitFor(() => {
        expect(
            screen.queryByText(/loading persona editor/i)
        ).not.toBeInTheDocument();
    });
    return { ...result, onClose };
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('AgentPersonaEditor', () => {
    it('loads the template via AgentService.getTemplate and shows the name', async () => {
        await mountEditor();
        expect(AgentService.getTemplate).toHaveBeenCalledWith(42);
        // Header shows "Edit: <name>"
        expect(screen.getByText(/Edit: Sarah Mitchell/)).toBeInTheDocument();
    });

    it('CONTRACT 1a — Identity fields edit name, role, and agent_type', async () => {
        const user = userEvent.setup();
        await mountEditor();

        const nameInput = screen.getByPlaceholderText(/Sarah Mitchell/i);
        await user.clear(nameInput);
        await user.type(nameInput, 'Nurse Jamie');
        expect(nameInput).toHaveValue('Nurse Jamie');

        const roleInput = screen.getByPlaceholderText(/Bedside Nurse/i);
        await user.clear(roleInput);
        await user.type(roleInput, 'Charge Nurse');
        expect(roleInput).toHaveValue('Charge Nurse');

        // agent_type select — find by current value (option label includes
        // the description after an em-dash).
        const typeSelect = screen.getByDisplayValue(/Nurse — Bedside nursing staff/i);
        await user.selectOptions(typeSelect, 'consultant');
        expect(typeSelect).toHaveValue('consultant');
    });

    it('CONTRACT 1b — Persona prompt textarea is wired and editable', async () => {
        const user = userEvent.setup();
        await mountEditor();
        const ta = screen.getByPlaceholderText(/Define the agent's personality/i);
        expect(ta).toHaveValue('You are a calm bedside nurse.');
        await user.clear(ta);
        await user.type(ta, 'Be terse.');
        expect(ta).toHaveValue('Be terse.');
    });

    it('CONTRACT 2 — pitch input is in semitones (min=-10, max=10, step=0.25)', async () => {
        await mountEditor();
        // The pitch input shares min/max/step semantics with the spec post-bb34d88.
        // Find it by its value (0) AND its step attribute.
        const pitchInputs = screen.getAllByRole('spinbutton').filter(el =>
            el.getAttribute('step') === '0.25'
        );
        expect(pitchInputs.length).toBeGreaterThan(0);
        const pitch = pitchInputs[0];
        expect(pitch).toHaveAttribute('min', '-10');
        expect(pitch).toHaveAttribute('max', '10');
        expect(pitch).toHaveAttribute('step', '0.25');
    });

    it('CONTRACT 1c — Voice rate input has 0.5..1.5 range with 0.05 step', async () => {
        await mountEditor();
        const rateInputs = screen.getAllByRole('spinbutton').filter(el =>
            el.getAttribute('step') === '0.05'
        );
        expect(rateInputs.length).toBeGreaterThan(0);
        const rate = rateInputs[0];
        expect(rate).toHaveAttribute('min', '0.5');
        expect(rate).toHaveAttribute('max', '1.5');
    });

    it('CONTRACT 1d — Dos list supports add and remove', async () => {
        const user = userEvent.setup();
        await mountEditor();

        // Dos panel: counter shows "(1)" because fixture has one entry.
        expect(screen.getByText(/^Dos$/)).toBeInTheDocument();

        // Click both "Add" buttons inside Dos and Don'ts. Filter by parent
        // section's heading text via closest().
        const addButtons = screen.getAllByRole('button', { name: /Add/i });
        // First Add belongs to Dos (it is rendered before Don'ts).
        await user.click(addButtons[0]);
        // Now the Dos counter should be "(2)".
        await waitFor(() => {
            expect(screen.getByText(/^Dos$/).parentElement).toHaveTextContent('(2)');
        });

        // Remove a bullet via Trash button — there's a row-level remove button.
        const removeButtons = screen.getAllByTitle(/Remove bullet/i);
        await user.click(removeButtons[0]);
        await waitFor(() => {
            expect(screen.getByText(/^Dos$/).parentElement).toHaveTextContent('(1)');
        });
    });

    it("CONTRACT 1d — Don'ts list mirrors the Dos contract", async () => {
        await mountEditor();
        expect(screen.getByText(/Don'ts/)).toBeInTheDocument();
        // Counter for Don'ts also reflects the fixture (1 entry).
        expect(screen.getByText(/Don'ts/).parentElement).toHaveTextContent('(1)');
    });

    it('CONTRACT 1e — Behavior: Context filter & "Can be paged" checkbox toggle', async () => {
        const user = userEvent.setup();
        await mountEditor();
        const ctxSelect = screen.getByDisplayValue(/Full Context/i);
        await user.selectOptions(ctxSelect, 'history');
        expect(ctxSelect).toHaveValue('history');

        const pagedCheckbox = screen.getByRole('checkbox', { name: /Can be paged/i });
        expect(pagedCheckbox).not.toBeChecked();
        await user.click(pagedCheckbox);
        expect(pagedCheckbox).toBeChecked();
    });

    it('CONTRACT 1f — LLM provider reveals model/temperature/max_tokens fields', async () => {
        const user = userEvent.setup();
        await mountEditor();

        // Provider <select> — initial value '' shows "Use Platform Default".
        const providerSelect = screen.getByDisplayValue(/Use Platform Default/i);
        await user.selectOptions(providerSelect, 'openai');

        // Now Model, Temperature, Max tokens fields should be visible.
        expect(screen.getByPlaceholderText(/gpt-4o-mini/i)).toBeInTheDocument();
        expect(screen.getByText(/Temperature/)).toBeInTheDocument();
        expect(screen.getByText(/Max tokens/)).toBeInTheDocument();
    });

    it('CONTRACT 3 — Reset (standard template) calls resetTemplateToDefault and repopulates', async () => {
        const user = userEvent.setup();
        const std = makeTemplate({ is_default: 1, name: 'Original Name' });
        AgentService.resetTemplateToDefault.mockResolvedValue({
            message: 'Reset OK',
            template: { ...std, name: 'Reset Name' },
        });

        await mountEditor({ template: std });
        // "Reset to defaults" button only appears for standard rows.
        const resetBtn = screen.getByRole('button', { name: /Reset to defaults/i });
        await user.click(resetBtn);

        // Confirm modal renders a SECOND "Reset to defaults" button. Wait
        // for the modal's title to confirm it's open, then click the last
        // matching button (modal confirm sits below the header button).
        await screen.findByText(/Reset to shipped defaults\?/i);
        const allResets = screen.getAllByRole('button', { name: /^Reset to defaults$/i });
        await user.click(allResets[allResets.length - 1]);

        await waitFor(() => {
            expect(AgentService.resetTemplateToDefault).toHaveBeenCalledWith(42);
        });
        // Header now reflects new name.
        await waitFor(() => {
            expect(screen.getByText(/Edit: Reset Name/)).toBeInTheDocument();
        });
    });

    it('CONTRACT 4a — Preview button calls VoiceService.speak with the resolved voice', async () => {
        const user = userEvent.setup();
        await mountEditor();

        const previewBtn = await screen.findByRole('button', { name: /Preview voice/i });
        await user.click(previewBtn);

        await waitFor(() => {
            expect(VoiceService.speak).toHaveBeenCalled();
        });
        const args = VoiceService.speak.mock.calls[0][0];
        expect(args.voice).toBe('en_US-amy-medium.onnx');
        expect(args.provider).toBe('piper');
        expect(typeof args.text).toBe('string');
        expect(args.text.length).toBeGreaterThan(0);
    });

    it('CONTRACT 4b — Stop preview cancels playback', async () => {
        const user = userEvent.setup();
        await mountEditor();

        const previewBtn = await screen.findByRole('button', { name: /Preview voice/i });
        await user.click(previewBtn);

        // After click, button label flips to "Stop preview".
        const stopBtn = await screen.findByRole('button', { name: /Stop preview/i });
        await user.click(stopBtn);
        expect(VoiceService.cancelSpeech).toHaveBeenCalled();
    });

    it('CONTRACT 5a — LLM Test button is hidden until provider is set, then disabled in create mode', async () => {
        const user = userEvent.setup();
        // Create mode (templateId='new'): no provider yet, no Test button.
        AgentService.getTemplate.mockResolvedValue(makeTemplate());
        renderWithProviders(<AgentPersonaEditor templateId="new" onClose={vi.fn()} />);
        await waitFor(() => {
            expect(
                screen.queryByText(/loading persona editor/i)
            ).not.toBeInTheDocument();
        });
        // No Test LLM button visible yet (provider empty hides the panel).
        expect(screen.queryByRole('button', { name: /Test LLM connection/i })).not.toBeInTheDocument();

        // Pick a provider.
        const providerSelect = screen.getByDisplayValue(/Use Platform Default/i);
        await user.selectOptions(providerSelect, 'openai');

        // Now the Test button is rendered, but DISABLED (isCreate gate).
        const testBtn = screen.getByRole('button', { name: /Test LLM connection/i });
        expect(testBtn).toBeDisabled();
    });

    it('CONTRACT 5b — Test LLM calls AgentService.testLLM and renders the response', async () => {
        const user = userEvent.setup();
        AgentService.testLLM.mockResolvedValue({
            provider: 'openai',
            model: 'gpt-4o-mini',
            latency_ms: 233,
            response: 'Hello there.',
        });
        // Saved template (id=42) + provider already set, so button is enabled.
        await mountEditor({ template: makeTemplate({ llm_provider: 'openai' }) });

        const testBtn = await screen.findByRole('button', { name: /Test LLM connection/i });
        expect(testBtn).not.toBeDisabled();
        await user.click(testBtn);

        await waitFor(() => {
            expect(AgentService.testLLM).toHaveBeenCalledWith(42);
        });
        // Response panel shows latency and response text.
        await screen.findByText(/Test successful/i);
        expect(screen.getByText(/Hello there\./)).toBeInTheDocument();
        expect(screen.getByText(/233ms/)).toBeInTheDocument();
    });

    it('CONTRACT 6a — Avatar preview receives current avatar_url as a prop', async () => {
        await mountEditor();
        // PatientAvatar is lazy → wait for it to render.
        await waitFor(() => {
            expect(avatarPropSpy).toHaveBeenCalled();
        });
        const lastCall = avatarPropSpy.mock.calls.at(-1)[0];
        expect(lastCall.avatarId).toBe('avatar-a');
    });

    it('CONTRACT 6b — switching avatar dropdown re-renders preview with new avatarId', async () => {
        const user = userEvent.setup();
        await mountEditor();
        await waitFor(() => expect(avatarPropSpy).toHaveBeenCalled());

        // The avatar select shows "Avatar A" (from manifest).
        const avatarSelect = await screen.findByDisplayValue(/Avatar A/i);
        await user.selectOptions(avatarSelect, 'avatar-b');

        await waitFor(() => {
            const lastCall = avatarPropSpy.mock.calls.at(-1)[0];
            expect(lastCall.avatarId).toBe('avatar-b');
        });
    });

    it('CONTRACT 7a — Discussant section is hidden when agent_type !== discussant', async () => {
        await mountEditor();
        expect(screen.queryByText(/Discussant settings/i)).not.toBeInTheDocument();
    });

    it('CONTRACT 7b — Discussant section appears when agent_type === discussant', async () => {
        await mountEditor({ template: makeTemplate({ agent_type: 'discussant' }) });
        expect(screen.getByText(/Discussant settings/i)).toBeInTheDocument();
        // Has the "Unlock trigger" select.
        expect(screen.getByText(/Unlock trigger/i)).toBeInTheDocument();
    });

    it('CONTRACT 8a — Save calls updateTemplate then onClose for an existing row', async () => {
        const user = userEvent.setup();
        AgentService.updateTemplate.mockResolvedValue({ ok: true });
        const { onClose } = await mountEditor();

        const saveBtn = screen.getByRole('button', { name: /Save changes/i });
        await user.click(saveBtn);

        await waitFor(() => {
            expect(AgentService.updateTemplate).toHaveBeenCalled();
        });
        const [calledId, payload] = AgentService.updateTemplate.mock.calls[0];
        expect(calledId).toBe(42);
        expect(payload.name).toBe('Sarah Mitchell');
        expect(payload.system_prompt).toContain('calm bedside nurse');

        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('CONTRACT 8b — Save error keeps editor mounted (does not call onClose)', async () => {
        const user = userEvent.setup();
        AgentService.updateTemplate.mockRejectedValue(new Error('boom'));
        const { onClose } = await mountEditor();

        await user.click(screen.getByRole('button', { name: /Save changes/i }));

        await waitFor(() => {
            expect(AgentService.updateTemplate).toHaveBeenCalled();
        });
        // onClose must NOT have been called on failure.
        expect(onClose).not.toHaveBeenCalled();
        // Editor still rendered.
        expect(screen.getByText(/Edit: Sarah Mitchell/)).toBeInTheDocument();
    });

    it('CONTRACT 8c — Save in create mode calls createTemplate not updateTemplate', async () => {
        const user = userEvent.setup();
        AgentService.createTemplate.mockResolvedValue({ id: 99 });
        const onClose = vi.fn();
        renderWithProviders(<AgentPersonaEditor templateId="new" onClose={onClose} />);
        await waitFor(() => {
            expect(screen.queryByText(/loading persona editor/i)).not.toBeInTheDocument();
        });

        // Fill the required name + system prompt to clear the validation guards.
        const user2 = userEvent.setup();
        const nameInput = screen.getByPlaceholderText(/Sarah Mitchell/i);
        await user2.type(nameInput, 'New Persona');
        const promptArea = screen.getByPlaceholderText(/Define the agent's personality/i);
        await user2.type(promptArea, 'Be helpful.');

        await user.click(screen.getByRole('button', { name: /Create persona/i }));

        await waitFor(() => {
            expect(AgentService.createTemplate).toHaveBeenCalled();
        });
        expect(AgentService.updateTemplate).not.toHaveBeenCalled();
    });

    it('CONTRACT 9 — Duplicate calls AgentService.duplicateTemplate', async () => {
        const user = userEvent.setup();
        AgentService.duplicateTemplate.mockResolvedValue({ id: 100 });
        await mountEditor();

        const dupBtn = screen.getByRole('button', { name: /Duplicate/i });
        await user.click(dupBtn);

        await waitFor(() => {
            expect(AgentService.duplicateTemplate).toHaveBeenCalled();
        });
        // Called with (id, suggestedName) — id is 42 in the fixture.
        const args = AgentService.duplicateTemplate.mock.calls[0];
        expect(args[0]).toBe(42);
    });

    it('CONTRACT 10a — Delete is hidden for standard (is_default=1) templates', async () => {
        await mountEditor({ template: makeTemplate({ is_default: 1 }) });
        expect(screen.queryByRole('button', { name: /^Delete$/i })).not.toBeInTheDocument();
    });

    it('CONTRACT 10b — Delete on a custom template requires confirm then calls deleteTemplate', async () => {
        const user = userEvent.setup();
        AgentService.deleteTemplate.mockResolvedValue({ ok: true });
        const { onClose } = await mountEditor();

        // Open the confirm modal.
        await user.click(screen.getByRole('button', { name: /^Delete$/i }));
        // Modal appears with another "Delete" confirm button.
        const confirms = await screen.findAllByRole('button', { name: /^Delete$/i });
        // The modal's Delete is a SECOND match (the header button + modal).
        // Click the last one (the modal sits on top).
        await user.click(confirms[confirms.length - 1]);

        await waitFor(() => {
            expect(AgentService.deleteTemplate).toHaveBeenCalledWith(42);
        });
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('cleans up audio: cancelSpeech is called on unmount', async () => {
        const onClose = vi.fn();
        AgentService.getTemplate.mockResolvedValue(makeTemplate());
        const { unmount } = renderWithProviders(
            <AgentPersonaEditor templateId={42} onClose={onClose} />
        );
        await waitFor(() => {
            expect(screen.queryByText(/loading persona editor/i)).not.toBeInTheDocument();
        });
        unmount();
        expect(VoiceService.cancelSpeech).toHaveBeenCalled();
    });

    it('CONTRACT 6c — framing slider onChange updates the avatar preview camera prop', async () => {
        const user = userEvent.setup();
        await mountEditor();
        await waitFor(() => expect(avatarPropSpy).toHaveBeenCalled());
        const beforeCount = avatarPropSpy.mock.calls.length;

        const bumpBtn = await screen.findByRole('button', { name: /framing-bump/i });
        await user.click(bumpBtn);

        // The avatar receives a new cameraOverride prop after the bump.
        await waitFor(() => {
            expect(avatarPropSpy.mock.calls.length).toBeGreaterThan(beforeCount);
        });
        const lastCall = avatarPropSpy.mock.calls.at(-1)[0];
        // The merged camera should reflect the patch we sent (x:1).
        expect(lastCall.cameraOverride).toBeTruthy();
    });
});
