// Regression lock: performing a physical exam never persisted the finding
// (bug report 2.9.15 #16, cause 3).
//
// The server has carried POST /sessions/:id/exam-findings and the
// physical_exam_findings table since day one, but no client code ever called
// the endpoint — findings lived only in the in-memory examLog /
// PatientRecord, so the case-summary modal's GET always returned an empty
// list. ManikinPanel now fires a best-effort apiPost (matching the vitals
// persistence pattern in PatientMonitor) whenever an exam is performed and a
// sessionId is present. This suite locks:
//   1. performing an exam POSTs the exact body the endpoint requires
//      (body_region / exam_type / finding / is_abnormal),
//   2. no POST is attempted without a sessionId,
//   3. a rejected POST does not break the interaction.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiPostMock = vi.fn();
const apiFetchMock = vi.fn(() => Promise.resolve({ findings: [] }));
vi.mock('../../services/apiClient', () => ({
    apiPost: (...args) => apiPostMock(...args),
    apiFetch: (...args) => apiFetchMock(...args),
}));

// The exam workspace children are heavy (SVG body map, audio playback).
// Stub the two interaction surfaces with minimal buttons that drive the
// same callbacks, and blank the display-only children.
vi.mock('./BodyMap', () => ({
    default: ({ onRegionClick }) => (
        <button type="button" onClick={() => onRegionClick('chest')}>select-region-chest</button>
    ),
}));
vi.mock('./ExamTypeSelector', () => ({
    default: ({ onExamTypeSelect }) => (
        <button type="button" onClick={() => onExamTypeSelect('auscultation')}>perform-auscultation</button>
    ),
}));
vi.mock('./FindingDisplay', () => ({ default: () => null }));
vi.mock('./ExamLog', () => ({
    default: ({ examLog = [] }) => <div data-testid="exam-log">{examLog.map((e) => `${e.regionId}:${e.examType}:${e.finding}`).join('|')}</div>,
}));

import ManikinPanel from './ManikinPanel.jsx';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

const PHYSICAL_EXAM = {
    chest: {
        auscultation: { finding: 'Bilateral basilar crackles', abnormal: true },
    },
};

async function performChestAuscultation(user) {
    await user.click(screen.getByText('select-region-chest'));
    await user.click(screen.getByText('perform-auscultation'));
}

beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({ findings: [] });
    apiPostMock.mockReset();
    apiPostMock.mockResolvedValue({ id: 1, already_recorded: false });
});

describe('ManikinPanel — exam finding persistence (bug report 2.9.15 #16)', () => {
    it('POSTs the finding to /sessions/:id/exam-findings when an exam is performed', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <ManikinPanel embedded sessionId="sess-7" physicalExam={PHYSICAL_EXAM} />
        );

        await performChestAuscultation(user);

        await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(1));
        expect(apiPostMock).toHaveBeenCalledWith('/sessions/sess-7/exam-findings', {
            body_region: 'chest',
            exam_type: 'auscultation',
            finding: 'Bilateral basilar crackles',
            is_abnormal: true,
        });
    });

    it('does not POST when no sessionId is provided', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <ManikinPanel embedded physicalExam={PHYSICAL_EXAM} />
        );

        await performChestAuscultation(user);

        expect(apiPostMock).not.toHaveBeenCalled();
    });

    it('survives a rejected POST (best-effort persistence)', async () => {
        apiPostMock.mockRejectedValue(new Error('network down'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const user = userEvent.setup();
        renderWithProviders(
            <ManikinPanel embedded sessionId="sess-7" physicalExam={PHYSICAL_EXAM} />
        );

        await performChestAuscultation(user);

        await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(1));
        // The exam interaction itself must still work — a second exam is
        // still performable (the component did not crash).
        await user.click(screen.getByText('perform-auscultation'));
        warnSpy.mockRestore();
    });
});

describe('ManikinPanel — exam log survives a reload (PRV-8)', () => {
    // Regression lock: the exam log lived only in component state, so a reload or room switch showed an empty log over a session whose findings were all persisted (QA PRV-8)
    it('rebuilds the log from the session\'s persisted findings on mount', async () => {
        apiFetchMock.mockResolvedValue({
            findings: [
                { body_region: 'chest', exam_type: 'auscultation', finding: 'Bilateral basilar crackles', is_abnormal: 1, timestamp: '2026-10-04 10:00:00' },
                { body_region: 'abdomen', exam_type: 'special', finding: "Murphy's sign: Negative", is_abnormal: 0, timestamp: '2026-10-04 10:01:00' },
            ],
        });
        renderWithProviders(<ManikinPanel embedded sessionId="sess-9" physicalExam={PHYSICAL_EXAM} />);
        await waitFor(() => expect(screen.getByTestId('exam-log').textContent).toContain('chest:auscultation:Bilateral basilar crackles'));
        expect(screen.getByTestId('exam-log').textContent).toContain("abdomen:special:Murphy's sign: Negative");
        expect(apiFetchMock).toHaveBeenCalledWith('/sessions/sess-9/exam-findings');
    });

    it('does not duplicate an exam re-performed after the restore', async () => {
        apiFetchMock.mockResolvedValue({
            findings: [{ body_region: 'chest', exam_type: 'auscultation', finding: 'Bilateral basilar crackles', is_abnormal: 1 }],
        });
        const user = userEvent.setup();
        renderWithProviders(<ManikinPanel embedded sessionId="sess-9" physicalExam={PHYSICAL_EXAM} />);
        await waitFor(() => expect(screen.getByTestId('exam-log').textContent).toContain('chest:auscultation'));
        await performChestAuscultation(user);
        const entries = screen.getByTestId('exam-log').textContent.split('|').filter((x) => x.startsWith('chest:auscultation'));
        expect(entries).toHaveLength(1);
    });

    it('asks for nothing without a session', () => {
        renderWithProviders(<ManikinPanel embedded physicalExam={PHYSICAL_EXAM} />);
        // (The provider stack's own /notification-prefs read is not ours.)
        expect(apiFetchMock.mock.calls.map((c) => c[0]).filter((u) => u.includes('exam-findings'))).toEqual([]);
    });
});

