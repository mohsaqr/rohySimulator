// Component contract for PhysicalExamScreen.jsx — the full-page physical
// examination screen that replaced the old modal mount in App.jsx.
//
// What we verify here:
//   1. Topbar shows the case title + Notes button — no Back button. The
//      always-visible bottom RoomNavigator is the canonical exit; a
//      duplicate topbar Back was retired when the nav went in.
//   2. ManikinPanel is mounted with `embedded` true (drops the modal chrome)
//      and receives the physicalExam / patientGender / onExamPerformed props.
//   3. Notes drawer starts hidden; clicking the Notes button opens it.
//   4. EventLogger.examPanelOpened() fires on mount and examPanelClosed()
//      on unmount — preserves the old logging contract from the modal.
//
// ManikinPanel is stubbed because its internals (BodyMap + ExamTypeSelector +
// FindingDisplay + ExamLog) bring in usePatientRecord, useToast and a lot of
// real exam data. The contract we care about here is "the screen passes the
// right props down to whatever exam workspace lives inside" — the workspace
// itself is tested separately.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// PhysicalExamScreen calls useAuth() to pick the student-safe vs authoring
// case label (Bug 9). These topbar tests mount the screen in isolation
// (no AuthProvider) and assert the authoring title — i.e. the privileged-
// viewer view — so mock a privileged user. The role gate itself is locked
// separately in src/utils/caseDisplayLabel.test.js.
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ user: { role: 'admin' }, isAdmin: () => true }),
    AuthProvider: ({ children }) => children,
}));

// --- Mock the embedded exam workspace + side-notes drawer ------------------
vi.mock('../examination/ManikinPanel', () => ({
    default: function ManikinPanelStub(props) {
        return (
            <div
                data-testid="manikin-panel-stub"
                data-embedded={String(!!props.embedded)}
                data-has-physical-exam={String(props.physicalExam != null)}
                data-patient-gender={props.patientGender ?? ''}
                data-has-on-exam-performed={String(typeof props.onExamPerformed === 'function')}
            />
        );
    },
}));

vi.mock('./ExamNotesDrawer', () => ({
    default: function ExamNotesDrawerStub({ open, sessionId, onClose }) {
        if (!open) return null;
        return (
            <div
                data-testid="exam-notes-drawer"
                data-session-id={sessionId ?? ''}
            >
                <button type="button" onClick={onClose}>close-stub</button>
            </div>
        );
    },
}));

// --- Mock EventLogger so we can assert lifecycle hooks ---------------------
const examPanelOpened = vi.fn();
const examPanelClosed = vi.fn();
const componentOpened = vi.fn();
const componentClosed = vi.fn();
vi.mock('../../services/eventLogger', () => ({
    default: {
        examPanelOpened: (...a) => examPanelOpened(...a),
        examPanelClosed: (...a) => examPanelClosed(...a),
        componentOpened: (...a) => componentOpened(...a),
        componentClosed: (...a) => componentClosed(...a),
    },
    COMPONENTS: { MANIKIN_PANEL: 'ManikinPanel' },
}));

import PhysicalExamScreen from './PhysicalExamScreen';

const baseCase = {
    id: 1,
    name: 'Acute Chest Pain - STEMI',
    config: {
        patient_name: 'John Q. Patient',
        demographics: { age: 55, gender: 'male' },
        physical_exam: { chest: { auscultation: { finding: 'clear', abnormal: false } } },
    },
};

function renderScreen(overrides = {}) {
    const onExamPerformed = overrides.onExamPerformed ?? vi.fn();
    const utils = render(
        <PhysicalExamScreen
            activeCase={overrides.activeCase ?? baseCase}
            sessionId={overrides.sessionId ?? 'sess-1'}
            physicalExam={overrides.physicalExam ?? baseCase.config.physical_exam}
            patientGender={overrides.patientGender ?? 'male'}
            onExamPerformed={onExamPerformed}
        />
    );
    return { ...utils, onExamPerformed };
}

beforeEach(() => {
    examPanelOpened.mockClear();
    examPanelClosed.mockClear();
    componentOpened.mockClear();
    componentClosed.mockClear();
});
afterEach(() => cleanup());

describe('PhysicalExamScreen — topbar', () => {
    it('renders the screen title and case name', () => {
        renderScreen();
        expect(screen.getByText('Physical Examination')).toBeTruthy();
        // Case name appears after the dot separator.
        expect(screen.getByText(/Acute Chest Pain - STEMI/)).toBeTruthy();
    });

    it('falls back to patient_name when activeCase.name is empty', () => {
        renderScreen({
            activeCase: { id: 2, config: { patient_name: 'Jane Doe', demographics: {} } },
        });
        expect(screen.getByText(/Jane Doe/)).toBeTruthy();
    });

    it('falls back to "Patient" when both name and patient_name are missing', () => {
        renderScreen({ activeCase: { id: 3, config: {} } });
        expect(screen.getByText(/· Patient$/)).toBeTruthy();
    });
});

describe('PhysicalExamScreen — embedded ManikinPanel', () => {
    it('mounts ManikinPanel with embedded=true', () => {
        renderScreen();
        const panel = screen.getByTestId('manikin-panel-stub');
        expect(panel.getAttribute('data-embedded')).toBe('true');
    });

    it('forwards physicalExam / patientGender / onExamPerformed to ManikinPanel', () => {
        renderScreen({ patientGender: 'female' });
        const panel = screen.getByTestId('manikin-panel-stub');
        expect(panel.getAttribute('data-has-physical-exam')).toBe('true');
        expect(panel.getAttribute('data-patient-gender')).toBe('female');
        expect(panel.getAttribute('data-has-on-exam-performed')).toBe('true');
    });
});

describe('PhysicalExamScreen — notes drawer', () => {
    it('does not render the notes drawer initially', () => {
        renderScreen();
        expect(screen.queryByTestId('exam-notes-drawer')).toBeNull();
    });

    it('opens the notes drawer when the Notes button is clicked', () => {
        renderScreen({ sessionId: 'sess-42' });
        const notesBtn = screen.getByRole('button', { name: /^Notes$/i });
        fireEvent.click(notesBtn);
        const drawer = screen.getByTestId('exam-notes-drawer');
        expect(drawer).toBeTruthy();
        expect(drawer.getAttribute('data-session-id')).toBe('sess-42');
    });

    it('the drawer can close itself via the onClose it receives', () => {
        renderScreen();
        fireEvent.click(screen.getByRole('button', { name: /^Notes$/i }));
        expect(screen.getByTestId('exam-notes-drawer')).toBeTruthy();
        fireEvent.click(screen.getByText('close-stub'));
        expect(screen.queryByTestId('exam-notes-drawer')).toBeNull();
    });
});

describe('PhysicalExamScreen — no topbar Back + lifecycle logging', () => {
    it('does not render a topbar Back button (RoomNavigator owns exit)', () => {
        renderScreen();
        expect(screen.queryByRole('button', { name: /^Back$/i })).toBeNull();
    });

    it('fires examPanelOpened on mount and examPanelClosed on unmount', () => {
        const { unmount } = renderScreen();
        expect(examPanelOpened).toHaveBeenCalledTimes(1);
        expect(examPanelClosed).not.toHaveBeenCalled();
        unmount();
        expect(examPanelClosed).toHaveBeenCalledTimes(1);
    });
});
