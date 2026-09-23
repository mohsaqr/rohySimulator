// The case wizard's Rooms step: switching a room off writes config.rooms, the
// patient room cannot be switched off, material is kept, and the author is told
// which specialists will not answer and what End & Debrief does without the
// debrief room.

import { describe, it, expect, afterEach } from 'vitest';
import { useEffect, useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CaseRoomsStep } from './CaseRoomsStep';

let latest = null;
const remember = (caseData) => { latest = caseData; };

function Harness({ initialConfig }) {
    const [caseData, setCaseData] = useState({ id: 5, config: initialConfig });
    useEffect(() => remember(caseData), [caseData]);
    return <CaseRoomsStep caseData={caseData} setCaseData={setCaseData} />;
}

afterEach(() => {
    cleanup();
    latest = null;
});

describe('CaseRoomsStep', () => {
    it('lists every room on by default, with the patient room locked on', () => {
        render(<Harness initialConfig={{}} />);
        expect(screen.queryByTestId('room-toggle-chat')).toBeNull();
        expect(screen.getByText('Always on')).toBeInTheDocument();
        for (const key of ['examination', 'lab', 'radiology', 'consultant']) {
            expect(screen.getByTestId(`room-toggle-${key}`)).toHaveAttribute('aria-checked', 'true');
        }
    });

    it('switches a room off into config.rooms.disabled, and back on to no setting at all', () => {
        render(<Harness initialConfig={{ patient_name: 'Ada' }} />);
        fireEvent.click(screen.getByTestId('room-toggle-lab'));
        fireEvent.click(screen.getByTestId('room-toggle-examination'));
        expect(latest.config.rooms).toEqual({ disabled: ['examination', 'lab'] });
        expect(latest.config.patient_name).toBe('Ada');
        expect(screen.getByTestId('room-toggle-lab')).toHaveAttribute('aria-checked', 'false');

        fireEvent.click(screen.getByTestId('room-toggle-lab'));
        fireEvent.click(screen.getByTestId('room-toggle-examination'));
        expect(latest.config).not.toHaveProperty('rooms');
    });

    it('says material is kept for a switched-off room that has some', () => {
        render(<Harness initialConfig={{ investigations: { labs: [{ test_name: 'Hb' }] }, rooms: { disabled: ['lab'] } }} />);
        expect(screen.getByText('Material configured for this room is kept, hidden from learners.')).toBeInTheDocument();
    });

    it('names the specialists who will not answer, and what ending does without the debrief', () => {
        render(<Harness initialConfig={{ rooms: { disabled: ['lab', 'consultant'] } }} />);
        expect(screen.getByTestId('rooms-silent-specialists')).toHaveTextContent('Laboratory');
        expect(screen.getByTestId('rooms-silent-specialists')).not.toHaveTextContent('Radiology');
        expect(screen.getByText(/End & Debrief ends the case and shows the case summary/)).toBeInTheDocument();
    });
});
