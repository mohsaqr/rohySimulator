// The case wizard's Rooms step: switching a room off writes config.rooms, the
// patient room cannot be switched off, material is kept, and the author is told
// which specialists will not answer and what End & Debrief does without the
// debrief room. The examination room and the 3D bedside are ONE radio group:
// a case has one examination room (server/shared/caseRooms.js).

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
    it('lists every other room on by default, with the patient room locked on', () => {
        render(<Harness initialConfig={{}} />);
        expect(screen.queryByTestId('room-toggle-chat')).toBeNull();
        expect(screen.getByText('Always on')).toBeInTheDocument();
        for (const key of ['lab', 'radiology', 'consultant']) {
            expect(screen.getByTestId(`room-toggle-${key}`)).toHaveAttribute('aria-checked', 'true');
        }
    });

    describe('the examination room', () => {
        const choice = (value) => screen.getByTestId(`room-exam-${value}`);

        it('is one radio group, not two switches, and defaults to the physical examination', () => {
            render(<Harness initialConfig={{}} />);
            // Regression lock: the examination room and the bedside were two
            // independent switches, so a case could offer both.
            expect(screen.queryByTestId('room-toggle-examination')).toBeNull();
            expect(screen.queryByTestId('room-toggle-room3d')).toBeNull();
            expect(screen.getByRole('group', { name: 'Examination room' })).toBeInTheDocument();
            expect(screen.getByRole('radio', { name: 'Physical examination (default)' })).toBeChecked();
            expect(screen.getByRole('radio', { name: '3D Bedside' })).not.toBeChecked();
            expect(screen.getByRole('radio', { name: 'None' })).not.toBeChecked();
            expect(screen.getByTestId('room-exam-choice')).toHaveAttribute('data-choice', 'examination');
        });

        it('choosing the 3D bedside removes the examination room; choosing the physical examination clears the bedside to no setting', () => {
            render(<Harness initialConfig={{ patient_name: 'Ada' }} />);
            fireEvent.click(choice('room3d'));
            expect(latest.config.rooms).toEqual({ enabled: ['room3d'] });
            expect(choice('room3d')).toBeChecked();
            expect(choice('examination')).not.toBeChecked();
            expect(screen.getByTestId('room-exam-choice')).toHaveAttribute('data-choice', 'room3d');

            fireEvent.click(choice('examination'));
            // Back at the defaults: no setting stored at all.
            expect(latest.config).not.toHaveProperty('rooms');
            expect(latest.config.patient_name).toBe('Ada');
        });

        it('reads an old bedside config as the bedside alone', () => {
            render(<Harness initialConfig={{ rooms: { enabled: ['room3d'] } }} />);
            expect(choice('room3d')).toBeChecked();
            expect(choice('examination')).not.toBeChecked();
        });

        it('None switches the examination room off and keeps the bedside off, keeping other rooms', () => {
            render(<Harness initialConfig={{ rooms: { enabled: ['room3d'], disabled: ['lab'] } }} />);
            fireEvent.click(choice('none'));
            expect(latest.config.rooms).toEqual({ disabled: ['examination', 'lab'] });
            expect(choice('none')).toBeChecked();
            expect(screen.getByTestId('room-exam-note')).toHaveTextContent('learners cannot examine the patient');
            fireEvent.click(choice('examination'));
            expect(latest.config.rooms).toEqual({ disabled: ['lab'] });
        });

        it('says examination material is kept when the case has no examination room', () => {
            render(<Harness initialConfig={{ physical_exam: { chest: { auscultation: { finding: 'clear' } } }, rooms: { disabled: ['examination'] } }} />);
            expect(screen.getByTestId('room-exam-note')).toHaveTextContent('Material configured for this room is kept');
        });
    });

    it('switches a room off into config.rooms.disabled, and back on to no setting at all', () => {
        render(<Harness initialConfig={{ patient_name: 'Ada' }} />);
        fireEvent.click(screen.getByTestId('room-toggle-lab'));
        fireEvent.click(screen.getByTestId('room-toggle-radiology'));
        expect(latest.config.rooms).toEqual({ disabled: ['lab', 'radiology'] });
        expect(latest.config.patient_name).toBe('Ada');
        expect(screen.getByTestId('room-toggle-lab')).toHaveAttribute('aria-checked', 'false');

        fireEvent.click(screen.getByTestId('room-toggle-lab'));
        fireEvent.click(screen.getByTestId('room-toggle-radiology'));
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

    // Regression lock: the admin light theme (.rohy-admin-light in index.css)
    // repaints every bg-neutral-* / bg-white to the white card surface, so an
    // OFF switch drawn with those classes was white on white — invisible.
    it('colours the switch without classes the admin light theme repaints', () => {
        render(<Harness initialConfig={{ rooms: { disabled: ['lab'] } }} />);
        for (const key of ['lab', 'radiology']) {
            const toggle = screen.getByTestId(`room-toggle-${key}`);
            for (const el of [toggle, ...toggle.querySelectorAll('*')]) {
                expect(el.className).not.toMatch(/\bbg-(neutral|white|gray|slate)/);
                expect(el.style.background).not.toBe('');
            }
        }
    });
});
