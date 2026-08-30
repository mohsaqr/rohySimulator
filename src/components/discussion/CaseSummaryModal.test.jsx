// Regression lock: case summary rendered every treatment name blank and no
// points/feedback debrief existed anywhere (bug report 2.9.15 #10)
//
// treatment_orders rows carry the name in `treatment_item`
// (migrations/0001_initial.sql), but the modal read `treatment_name` —
// SELECT * meant the field simply wasn't there and every ordered treatment
// rendered as an empty string. And although teachers configure points +
// feedback_if_ordered/feedback_if_missed, no surface ever showed the total
// or the texts. This suite locks:
//   1. a treatment_item row renders a non-blank name,
//   2. the debrief section renders total points, per-order feedback and the
//      missed-expected list from the /treatment-debrief payload,
//   3. while the server says pending, the missed list stays hidden behind
//      the pending message.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../services/apiClient', () => ({
    apiFetch: (...args) => apiFetchMock(...args),
}));

import CaseSummaryModal from './CaseSummaryModal.jsx';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

const ACTIVE_CASE = { id: 'case-9', name: 'Chest Pain', config: {} };

function mockEndpoints({ debrief }) {
    apiFetchMock.mockImplementation((path) => {
        if (path.endsWith('/treatment-orders')) {
            // Shape of the real GET: SELECT * rows keyed treatment_item.
            return Promise.resolve({
                orders: [{ id: 1, treatment_item: 'Aspirin', dose: '300', route: 'PO' }],
            });
        }
        if (path.endsWith('/treatment-debrief')) {
            return Promise.resolve(debrief);
        }
        return Promise.resolve({});
    });
}

beforeEach(() => {
    apiFetchMock.mockReset();
});

describe('CaseSummaryModal — treatments debrief (bug report 2.9.15 #10)', () => {
    it('renders a non-blank treatment name from a treatment_item row', async () => {
        mockEndpoints({ debrief: { pending: false, total_points: 0, ordered: [], missed: [] } });
        renderWithProviders(
            <CaseSummaryModal activeCase={ACTIVE_CASE} sessionId="sess-1" onClose={() => {}} />
        );

        // The column is treatment_item — reading treatment_name rendered ''.
        const name = await screen.findByText('Aspirin');
        expect(name.textContent).toBe('Aspirin');
    });

    it('renders total points, ordered feedback and the missed-expected list once the server unseals it', async () => {
        mockEndpoints({
            debrief: {
                pending: false,
                total_points: 100,
                ordered: [{ treatment_item: 'Aspirin', dose: '300', route: 'PO', points_awarded: 100, feedback: 'Good call — aspirin early.' }],
                missed: [{ treatment_name: 'Heparin', feedback_if_missed: 'Anticoagulation was expected.' }],
            },
        });
        renderWithProviders(
            <CaseSummaryModal activeCase={ACTIVE_CASE} sessionId="sess-1" onClose={() => {}} />
        );

        expect(await screen.findByText('Treatments debrief')).toBeTruthy();
        expect(screen.getByText('Total points: 100')).toBeTruthy();
        expect(screen.getByText('+100 points')).toBeTruthy();
        expect(screen.getByText('Good call — aspirin early.')).toBeTruthy();
        expect(screen.getByText('Expected treatments not ordered')).toBeTruthy();
        expect(screen.getByText('Heparin')).toBeTruthy();
        expect(screen.getByText('Anticoagulation was expected.')).toBeTruthy();
    });

    it('keeps the missed list hidden behind the pending message while the session is live', async () => {
        mockEndpoints({
            debrief: {
                pending: true,
                total_points: 100,
                ordered: [{ treatment_item: 'Aspirin', dose: '300', route: 'PO', points_awarded: 100, feedback: null }],
                missed: [],
            },
        });
        renderWithProviders(
            <CaseSummaryModal activeCase={ACTIVE_CASE} sessionId="sess-1" onClose={() => {}} />
        );

        expect(await screen.findByText('Total points: 100')).toBeTruthy();
        expect(screen.getByText('Revealed when the session ends.')).toBeTruthy();
        expect(screen.queryByText('No expected treatments were missed.')).toBeNull();
    });
});

// Regression lock: history, initial vitals and exam findings were all missing
// from the case summary (bug report 2.9.15 #16). Three independent causes:
//   1. History read structuredHistory.historyOfPresentIllness /
//      .pastMedicalHistory — keys nothing in the repo ever writes — and read
//      structuredHistory only, while seeded/imported cases carry only
//      clinicalRecords.history (hpi / pastMedical).
//   2. Vitals read cfg.initialVitals || cfg.initial_vitals only, ignoring the
//      scenario-first-frame and legacy-flat fallbacks PatientMonitor uses, so
//      scenario-only cases hid the whole section.
//   3. Exam findings rendered f.region_id / f.finding_text, but
//      physical_exam_findings rows carry body_region / finding.
describe('CaseSummaryModal — history, vitals, exam findings (bug report 2.9.15 #16)', () => {
    it('renders history from a clinicalRecords.history-only case', async () => {
        mockEndpoints({ debrief: null });
        renderWithProviders(
            <CaseSummaryModal
                activeCase={{
                    id: 'case-1',
                    name: 'STEMI',
                    config: {
                        clinicalRecords: {
                            history: {
                                chiefComplaint: 'Crushing chest pain for 2 hours',
                                hpi: 'Acute onset substernal chest pain radiating to the left arm.',
                                pastMedical: 'T2DM, HTN, hyperlipidemia',
                            },
                        },
                    },
                }}
                sessionId="sess-1"
                onClose={() => {}}
            />
        );

        expect(await screen.findByText('Crushing chest pain for 2 hours')).toBeTruthy();
        expect(screen.getByText('Acute onset substernal chest pain radiating to the left arm.')).toBeTruthy();
        expect(screen.getByText('T2DM, HTN, hyperlipidemia')).toBeTruthy();
    });

    it('renders history from a structuredHistory-only case (wizard key aliases)', async () => {
        mockEndpoints({ debrief: null });
        renderWithProviders(
            <CaseSummaryModal
                activeCase={{
                    id: 'case-2',
                    name: 'Sepsis',
                    config: {
                        structuredHistory: {
                            chiefComplaint: 'Fever and confusion',
                            hpi: 'Two days of fever, rigors and worsening confusion.',
                            pmh: 'CKD stage 3',
                        },
                    },
                }}
                sessionId="sess-1"
                onClose={() => {}}
            />
        );

        expect(await screen.findByText('Fever and confusion')).toBeTruthy();
        expect(screen.getByText('Two days of fever, rigors and worsening confusion.')).toBeTruthy();
        expect(screen.getByText('CKD stage 3')).toBeTruthy();
    });

    it('renders initial vitals from a scenario-first-frame-only case', async () => {
        mockEndpoints({ debrief: null });
        renderWithProviders(
            <CaseSummaryModal
                activeCase={{
                    id: 'case-3',
                    name: 'Shock',
                    config: {},
                    // Frames deliberately out of order — the resolver must pick
                    // the earliest frame, like PatientMonitor does.
                    scenario: {
                        timeline: [
                            { time: 120, params: { hr: 150, spo2: 84 } },
                            { time: 0, params: { hr: 128, spo2: 91 } },
                        ],
                    },
                }}
                sessionId="sess-1"
                onClose={() => {}}
            />
        );

        expect(await screen.findByText('Initial vital signs')).toBeTruthy();
        expect(screen.getByText('128 bpm')).toBeTruthy();
        expect(screen.getByText('91%')).toBeTruthy();
    });

    it('renders exam findings from rows shaped {body_region, finding}', async () => {
        apiFetchMock.mockImplementation((path) => {
            if (path.endsWith('/exam-findings')) {
                // Shape of the real GET: SELECT * over physical_exam_findings.
                return Promise.resolve({
                    findings: [{
                        id: 1,
                        body_region: 'chest',
                        exam_type: 'auscultation',
                        finding: 'Bilateral basilar crackles',
                        is_abnormal: 1,
                    }],
                });
            }
            return Promise.resolve({});
        });
        renderWithProviders(
            <CaseSummaryModal
                activeCase={{ id: 'case-4', name: 'CHF', config: {} }}
                sessionId="sess-1"
                onClose={() => {}}
            />
        );

        expect(await screen.findByText('Bilateral basilar crackles')).toBeTruthy();
        // Stored ids resolve to display names via the exam room's own
        // resolvers, so the summary and the room say the same words.
        expect(screen.getByText('Chest')).toBeTruthy();
        expect(screen.getByText(/Auscultation/)).toBeTruthy();
        expect(screen.queryByText('No examinations recorded.')).toBeNull();
    });

    // Regression lock: the summary rendered `body_region` raw, so a learner
    // debriefing saw "thighRight" and "upperBack" (reported against v2.9.82)
    // while the exam room three clicks away said "Right Thigh". regionLabel()
    // had existed in src/components/examination/examinationLabels.js the whole
    // time; the summary was the one surface that bypassed it.
    it('renders camelCase region ids as human-readable names', async () => {
        apiFetchMock.mockImplementation((path) => {
            if (path.endsWith('/exam-findings')) {
                return Promise.resolve({
                    findings: [
                        { id: 1, body_region: 'thighRight', exam_type: 'palpation', finding: 'Tender' },
                        { id: 2, body_region: 'upperBack', exam_type: 'inspection', finding: 'No lesions' },
                    ],
                });
            }
            return Promise.resolve({});
        });
        renderWithProviders(
            <CaseSummaryModal
                activeCase={{ id: 'case-5', name: 'Trauma', config: {} }}
                sessionId="sess-2"
                onClose={() => {}}
            />
        );

        expect(await screen.findByText('Right Thigh')).toBeTruthy();
        expect(screen.getByText('Upper Back')).toBeTruthy();
        expect(screen.queryByText('thighRight')).toBeNull();
        expect(screen.queryByText('upperBack')).toBeNull();
    });

    // An educator may define a region the shipped map has never heard of.
    // regionLabel falls back to the raw id, which is worse than a name and
    // far better than blank.
    it('falls back to the raw id for an author-defined region', async () => {
        apiFetchMock.mockImplementation((path) => {
            if (path.endsWith('/exam-findings')) {
                return Promise.resolve({
                    findings: [{ id: 1, body_region: 'customFlank', exam_type: 'palpation', finding: 'Guarding' }],
                });
            }
            return Promise.resolve({});
        });
        renderWithProviders(
            <CaseSummaryModal
                activeCase={{ id: 'case-6', name: 'Abdo', config: {} }}
                sessionId="sess-3"
                onClose={() => {}}
            />
        );

        expect(await screen.findByText('customFlank')).toBeTruthy();
    });
});
