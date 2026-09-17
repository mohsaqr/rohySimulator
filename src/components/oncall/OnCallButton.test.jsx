import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import OnCallButton from './OnCallButton';

const pathologist = { agent_type: 'pathologist', name: 'Dr. Ana Path', enabled: true, availability_type: 'on-call', status: 'absent' };
const cardiologist = { agent_type: 'cardiologist', name: 'Dr. Ben Heart', enabled: true, availability_type: 'on-call', status: 'present' };
const radiologistAway = { agent_type: 'radiologist', name: 'Dr. Cy Ray', enabled: true, availability_type: 'absent', status: 'absent' };
const nurse = { agent_type: 'nurse', name: 'Sarah', enabled: true, availability_type: 'present' };

describe('OnCallButton', () => {
    it('renders nothing when the case has no specialists', () => {
        const { container } = render(<OnCallButton sessionId={5} specialists={[nurse]} onClick={() => {}} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing without a session', () => {
        const { container } = render(<OnCallButton sessionId={null} specialists={[pathologist]} onClick={() => {}} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('badges the number of reachable specialists and opens on click', () => {
        const onClick = vi.fn();
        render(<OnCallButton sessionId={5} specialists={[pathologist, cardiologist, radiologistAway, nurse]} onClick={onClick} />);
        const button = screen.getByRole('button', { name: /on-call phone, 2 specialists reachable/i });
        expect(screen.getByTestId('oncall-badge')).toHaveTextContent('2');
        fireEvent.click(button);
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
