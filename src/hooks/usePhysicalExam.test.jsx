import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import usePhysicalExam from './usePhysicalExam.js';
import { getDefaultFinding } from '../data/examRegions';

// Characterization tests: these pin ManikinPanel's original exam semantics,
// which this hook now owns for both the 2D examination room and the 3D room.
// The clause they exist to defend is the record vs log split — the patient
// record gets the raw finding, the log entry gets the named special test.

const examined = vi.fn();
const elicited = vi.fn();
vi.mock('../services/PatientRecord', () => ({
    usePatientRecord: () => ({ examined, elicited }),
}));

const CASE_EXAM = {
    chestAnterior: {
        auscultation: {
            finding: 'Widespread expiratory wheeze.',
            abnormal: true,
            heartAudio: '/uploads/wheeze.mp3',
            audioUrls: { mitral: '/uploads/mitral.mp3' },
        },
    },
};

function Harness({ physicalExam, call }) {
    const performExam = usePhysicalExam({ physicalExam });
    return (
        <button type="button" onClick={() => { Harness.result = performExam(...call); }}>
            perform
        </button>
    );
}

const perform = (physicalExam, ...call) => {
    const view = render(<Harness physicalExam={physicalExam} call={call} />);
    fireEvent.click(view.getByText('perform'));
    const { result } = Harness;
    view.unmount();
    return result;
};

describe('usePhysicalExam', () => {
    beforeEach(() => {
        examined.mockClear();
        elicited.mockClear();
    });

    it('returns the case-configured finding with its audio intact', () => {
        const entry = perform(CASE_EXAM, 'chestAnterior', 'auscultation');
        expect(entry).toMatchObject({
            regionId: 'chestAnterior',
            examType: 'auscultation',
            specialTest: null,
            finding: 'Widespread expiratory wheeze.',
            abnormal: true,
            heartAudio: '/uploads/wheeze.mp3',
        });
        expect(entry.audioUrls).toEqual({ mitral: '/uploads/mitral.mp3' });
    });

    it('falls back to the model default when the case configures nothing', () => {
        const entry = perform(CASE_EXAM, 'abdomen', 'palpation');
        expect(entry.finding).toBe(getDefaultFinding('abdomen', 'palpation'));
        expect(entry.abnormal).toBe(false);
        // A case with no exam config at all behaves the same way.
        expect(perform(null, 'abdomen', 'palpation').finding).toBe(entry.finding);
    });

    it('names the special test in the log entry but not in the record', () => {
        const entry = perform(CASE_EXAM, 'abdomen', 'special', "Murphy's sign");
        const base = getDefaultFinding('abdomen', 'special');
        expect(entry.specialTest).toBe("Murphy's sign");
        expect(entry.finding).toBe(`Murphy's sign: ${base}`);
        expect(entry.rawFinding).toBe(base);
        // The record keeps the clinical text, unprefixed — this is the
        // parity clause the 3D room's own copy used to get wrong.
        expect(examined).toHaveBeenCalledWith('abdomen', 'special', base);
        expect(elicited).toHaveBeenCalledWith('exam', base, false, {
            category: 'abdomen',
            significance: 'Normal finding',
        });
    });

    it('marks an abnormal finding as abnormal in the record', () => {
        perform(CASE_EXAM, 'chestAnterior', 'auscultation');
        expect(elicited).toHaveBeenCalledWith(
            'exam',
            'Widespread expiratory wheeze.',
            true,
            { category: 'chestAnterior', significance: 'Abnormal finding' },
        );
    });

    it('says "Not examined" for a region the model does not know', () => {
        const entry = perform(null, 'notARegion', 'palpation');
        expect(entry.finding).toBe('Not examined');
        expect(examined).toHaveBeenCalledWith('notARegion', 'palpation', 'Not examined');
        // Still recorded: the model answers rather than returning nothing,
        // so the guard below only skips a genuinely empty finding.
        expect(elicited).toHaveBeenCalledTimes(1);
    });
});
