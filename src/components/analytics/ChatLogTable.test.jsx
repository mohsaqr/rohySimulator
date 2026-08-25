// Tests for ChatLogTable — the admin "Logs → Chat log" feed table.
//
// Regression lock: virtual patient and consultant rows both rendered as
// bare role "assistant"; the persona (agent_type) was mapped only into the
// hidden-by-default `model` column and the never-rendered `extra` column
// (bug report 2.9.15 #20). The visible `speaker` column now derives:
//   agent/team rows  → extra (agent_type), e.g. "consultant"
//   interaction rows → assistant → "patient", user → "student"
//
// apiFetch is mocked (OyonDataLogs test pattern).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const { apiFetchMock, MockApiError } = vi.hoisted(() => {
    class MockApiError extends Error {
        constructor(message, { status = 0, code = null, body = null, url = null } = {}) {
            super(message);
            this.name = 'ApiError';
            this.status = status;
            this.code = code;
            this.body = body;
            this.url = url;
        }
    }
    return { apiFetchMock: vi.fn(), MockApiError };
});

vi.mock('../../services/apiClient', () => ({
    apiFetch: apiFetchMock,
    ApiError: MockApiError,
}));

import ChatLogTable from './ChatLogTable.jsx';

const row = (over = {}) => ({
    ts: '2026-08-01T09:00:00.000Z',
    user_id: 1,
    username: 'alice',
    case_id: 7,
    case_name: 'Chest pain',
    session_id: 42,
    source: 'interaction',
    role: 'user',
    content: 'hello',
    tokens_in: null,
    tokens_out: null,
    latency_ms: null,
    model: null,
    extra: null,
    ...over,
});

const EVENTS = [
    row({ role: 'user', content: 'Where does it hurt?' }),
    row({ role: 'assistant', content: 'My chest, doctor.' }),
    row({
        source: 'agent', role: 'assistant', content: 'ECG shows ST elevation.',
        model: 'consultant', extra: 'consultant',
    }),
];

beforeEach(() => {
    apiFetchMock.mockReset();
    window.localStorage.clear();
});

describe('ChatLogTable speaker column', () => {
    it('renders the persona for agent rows and patient/student for interactions', async () => {
        apiFetchMock.mockResolvedValue({ events: EVENTS, sources: { interaction: 2, agent: 1 } });
        render(<ChatLogTable />);

        // The visible speaker column exists…
        expect(await screen.findByText('speaker')).toBeInTheDocument();
        // …and the consultant row shows its persona, not a bare "assistant".
        expect(screen.getByText('consultant')).toBeInTheDocument();
        // Interaction rows derive patient (assistant) / student (user).
        expect(screen.getByText('patient')).toBeInTheDocument();
        expect(screen.getByText('student')).toBeInTheDocument();
    });

    // Regression lock: learning_events rows (source 'event') resolved to no
    // speaker at all, so a feed dominated by them was a wall of bare
    // "assistant" with a "—" speaker — reported as bug 5 of the 2.9.37 report
    // ("the log does not clearly indicate whether an AI-generated message came
    // from the virtual patient, the consultant, or others"). `model` carries
    // le.component, which separates the patient thread from the debrief.
    it('resolves a speaker for learning_event chat rows, split by component', async () => {
        apiFetchMock.mockResolvedValue({
            events: [
                row({ source: 'event', role: 'user', content: 'Any allergies?', model: 'ChatInterface', extra: 'SENT_MESSAGE' }),
                row({ source: 'event', role: 'assistant', content: 'None that I know of.', model: 'ChatInterface', extra: 'RECEIVED_MESSAGE' }),
                row({ source: 'event', role: 'assistant', content: 'Walk me through your reasoning.', model: 'DiscussionScreen', extra: 'RECEIVED_MESSAGE' }),
            ],
            sources: { event: 3 },
        });
        render(<ChatLogTable />);

        expect(await screen.findByText('speaker')).toBeInTheDocument();
        expect(screen.getByText('patient')).toBeInTheDocument();
        expect(screen.getByText('student')).toBeInTheDocument();
        // The debrief discussant is NOT the patient.
        expect(screen.getByText('discussant')).toBeInTheDocument();
    });

    // Non-chat verbs arrive with `role` = the verb itself (message_role is
    // NULL), and genuinely have no speaker — they must stay blank rather than
    // being swept into "patient".
    it('leaves non-chat event verbs without a speaker', async () => {
        apiFetchMock.mockResolvedValue({
            events: [
                row({ source: 'event', role: 'TTS_PLAYED', content: 'spoken', model: 'ChatInterface', extra: 'TTS_PLAYED' }),
            ],
            sources: { event: 1 },
        });
        render(<ChatLogTable />);

        expect(await screen.findByText('speaker')).toBeInTheDocument();
        expect(screen.queryByText('patient')).not.toBeInTheDocument();
        expect(screen.queryByText('student')).not.toBeInTheDocument();
    });
});
