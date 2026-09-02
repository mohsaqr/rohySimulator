import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import FindingPanel from './FindingPanel.jsx';

// The regression this file exists to prevent: the 3D room once presented
// findings in its own flat card, which silently dropped Rohy's interactive
// auscultation surface (clickable chest/abdomen points, per-point audio,
// play/pause, volume). FindingPanel must render Rohy's REAL FindingDisplay,
// so auscultation always comes back with AuscultationPanel behind it.

const AUSCULTATION_ENTRY = {
    regionId: 'chestAnterior',
    examType: 'auscultation',
    specialTest: null,
    finding: 'Widespread expiratory wheeze.',
    abnormal: true,
    audioUrl: null,
    audioUrls: {},
    heartAudio: '/uploads/murmur.mp3',
    lungAudio: null,
};

const PALPATION_ENTRY = {
    ...AUSCULTATION_ENTRY,
    examType: 'palpation',
    finding: 'Tender in the right upper quadrant.',
    abnormal: false,
    heartAudio: null,
};

describe('FindingPanel', () => {
    beforeEach(() => {
        // jsdom has no media element playback.
        vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
        vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    });

    it('renders nothing without a finding', () => {
        const { container } = render(<FindingPanel entry={null} onClose={() => {}} />);
        expect(container.querySelector('aside')).toBeNull();
    });

    it('presents an auscultation finding with the interactive auscultation surface', () => {
        const { container, getByText } = render(
            <FindingPanel entry={AUSCULTATION_ENTRY} onClose={() => {}} />,
        );
        expect(getByText(/Widespread expiratory wheeze\./)).toBeDefined();
        // AuscultationPanel renders one clickable button per auscultation
        // point over its diagram — the surface the flat card had lost.
        const pointButtons = [...container.querySelectorAll('button[title]')];
        expect(pointButtons.length).toBeGreaterThanOrEqual(5);
        // Its audio element is the playback the regression removed.
        expect(container.querySelector('audio')).not.toBeNull();
    });

    it('presents a non-auscultation finding as text with the region and technique', () => {
        const { container, getByText } = render(
            <FindingPanel entry={PALPATION_ENTRY} onClose={() => {}} />,
        );
        expect(getByText(/Tender in the right upper quadrant\./)).toBeDefined();
        expect(container.querySelector('aside').textContent).toMatch(/chest/i);
    });

    it('toggles full screen with the square icon and closes on Escape', () => {
        const onClose = vi.fn();
        const { getByLabelText, container } = render(
            <FindingPanel entry={PALPATION_ENTRY} onClose={onClose} />,
        );
        const panel = () => container.querySelector('aside');
        expect(panel().className).toContain('absolute');

        fireEvent.click(getByLabelText('View full screen'));
        expect(panel().className).toContain('fixed');
        // Never runs under the host's fixed 72px RoomNavigator band.
        expect(panel().className).toContain('bottom-[88px]');
        expect(getByLabelText('Exit full screen').getAttribute('aria-pressed')).toBe('true');

        // Escape leaves full screen first, then closes.
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(panel().className).toContain('absolute');
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes from the close button', () => {
        const onClose = vi.fn();
        const { getByLabelText } = render(<FindingPanel entry={PALPATION_ENTRY} onClose={onClose} />);
        fireEvent.click(getByLabelText('Close finding'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('scrolls its finding body instead of clipping long text', () => {
        const long_entry = {
            ...PALPATION_ENTRY,
            finding: Array.from({ length: 12 }, () => 'Abdomen is soft and non-tender in all nine regions.').join(' '),
        };
        const { container } = render(<FindingPanel entry={long_entry} onClose={() => {}} />);
        const scroller = [...container.querySelectorAll('div')]
            .find((element) => element.className.includes('overflow-y-auto'));
        expect(scroller).toBeDefined();
        expect(scroller.className).toContain('flex-1');
    });
});
