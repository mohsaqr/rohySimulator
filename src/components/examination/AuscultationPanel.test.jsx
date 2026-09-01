import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import AuscultationPanel from './AuscultationPanel.jsx';

// The `figure` prop is ADDITIVE: 'diagram' (the default, used by the 2D
// examination room) must keep the schematic background exactly as it was,
// while 'manikin' swaps in the shared examination figure with anatomical
// point placement for the 3D room.

const baseProps = {
    finding: 'Vesicular breath sounds throughout.',
    isAbnormal: false,
    selectedRegion: 'chestAnterior',
    regionName: 'Chest',
};

// The figure is Cardoyon's ink-coverage mask painted through an SVG mask,
// so its presence is an <image> inside a mask, not an <img> tag.
const figureMask = (container) => container.querySelector('mask image');

describe('AuscultationPanel figure', () => {
    beforeEach(() => {
        vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
        vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    });

    it('defaults to the schematic diagram with no body figure', () => {
        const { container } = render(<AuscultationPanel {...baseProps} />);
        expect(figureMask(container)).toBeNull();
        // The auscultation points themselves are unaffected by the default.
        expect(container.querySelectorAll('button[title]').length).toBeGreaterThanOrEqual(5);
    });

    it('draws the examination manikin when asked, keeping every point', () => {
        const diagram = render(<AuscultationPanel {...baseProps} />);
        const diagramPoints = diagram.container.querySelectorAll('button[title]').length;
        diagram.unmount();

        const { container } = render(<AuscultationPanel {...baseProps} figure="manikin" />);
        const image = figureMask(container);
        expect(image).not.toBeNull();
        // Cardoyon's figure travels as an inline ink-coverage mask.
        expect(image.getAttribute('href')).toMatch(/^data:image\/png;base64,/);
        expect(container.querySelectorAll('button[title]').length).toBe(diagramPoints);
    });

    it('names the intercostal spaces the way a clinician would', () => {
        const { container } = render(<AuscultationPanel {...baseProps} figure="manikin" />);
        const labels = [...container.querySelectorAll('svg text')].map((node) => node.textContent);
        expect(labels).toContain('4th');
        expect(labels).toContain('5th');
        // Dashed landmarks, not solid rules — they orient, they do not shout.
        expect(container.querySelector('svg line').getAttribute('stroke-dasharray')).toBeTruthy();
    });

    it('places cardiac points on the correct side: aortic right of sternum, apex left', () => {
        const { container } = render(<AuscultationPanel {...baseProps} figure="manikin" />);
        const byTitle = (fragment) => [...container.querySelectorAll('button[title]')]
            .find((button) => button.getAttribute('title').toLowerCase().includes(fragment));
        const left = (button) => parseFloat(button.style.left);
        // Anterior view: the patient's right is the viewer's left, so the
        // aortic area sits left of the midline and the apex well right of it.
        expect(left(byTitle('aortic'))).toBeLessThan(left(byTitle('pulmonic')));
        expect(left(byTitle('mitral'))).toBeGreaterThan(left(byTitle('tricuspid')));
        // Every point stays inside the viewport.
        [...container.querySelectorAll('button[title]')].forEach((button) => {
            expect(parseFloat(button.style.left)).toBeGreaterThan(0);
            expect(parseFloat(button.style.left)).toBeLessThan(100);
            expect(parseFloat(button.style.top)).toBeGreaterThan(0);
            expect(parseFloat(button.style.top)).toBeLessThan(100);
        });
    });

    it('places abdominal points around the umbilicus for the abdomen profile', () => {
        const { container } = render(
            <AuscultationPanel
                {...baseProps}
                selectedRegion="abdomen"
                auscultationProfile="abdomen"
                regionName="Abdomen"
                figure="manikin"
            />,
        );
        expect(figureMask(container)).not.toBeNull();
        const byTitle = (fragment) => [...container.querySelectorAll('button[title]')]
            .find((button) => button.getAttribute('title').toLowerCase().includes(fragment));
        // Upper quadrants sit above the lower ones.
        expect(parseFloat(byTitle('ruq').style.top)).toBeLessThan(parseFloat(byTitle('rlq').style.top));
        // The patient's right quadrant is on the viewer's left.
        expect(parseFloat(byTitle('ruq').style.left)).toBeLessThan(parseFloat(byTitle('luq').style.left));
    });
});

describe('AuscultationPanel transport and verdict', () => {
    beforeEach(() => {
        vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
        vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    });

    it('labels a normal finding by default and withholds that verdict on request', () => {
        const withLabel = render(<AuscultationPanel {...baseProps} />);
        expect(withLabel.queryAllByText(/normal/i).length).toBeGreaterThan(0);
        withLabel.unmount();

        const { container } = render(<AuscultationPanel {...baseProps} normalLabel={false} />);
        // The finding text may still say "normal"; the verdict BADGE must not.
        const badges = [...container.querySelectorAll('span')]
            .filter((node) => /bg-emerald-900/.test(node.className));
        expect(badges).toHaveLength(0);
    });

    it('offers a real seek control in the compact transport', () => {
        const { container, getByLabelText } = render(
            <AuscultationPanel {...baseProps} transport="compact" />,
        );
        const seek = getByLabelText('Seek');
        expect(seek.getAttribute('type')).toBe('range');
        // Seeking moves the audio element, not just the slider.
        const audio = container.querySelector('audio');
        Object.defineProperty(audio, 'duration', { value: 12, configurable: true });
        fireEvent.loadedMetadata(audio);
        fireEvent.change(seek, { target: { value: '6' } });
        expect(audio.currentTime).toBe(6);
        expect(getByLabelText('Play')).toBeDefined();
    });

    it('drives the default progress bar from real playback, not a fixed width', () => {
        const { container } = render(<AuscultationPanel {...baseProps} />);
        const audio = container.querySelector('audio');
        const bar = () => container.querySelector('.bg-cyan-500');
        expect(bar().style.width).toBe('0%');
        Object.defineProperty(audio, 'duration', { value: 10, configurable: true });
        fireEvent.loadedMetadata(audio);
        Object.defineProperty(audio, 'currentTime', { value: 5, configurable: true, writable: true });
        fireEvent.timeUpdate(audio);
        expect(bar().style.width).toBe('50%');
    });
});

describe('AuscultationPanel stacked order', () => {
    beforeEach(() => {
        vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
        vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    });

    // Stacked panels read top-down: body, then the controls for the site
    // clicked on it, then the finding. The player must not land after the
    // paragraph, where it is a scroll away from the figure it belongs to.
    it('puts the player directly under the figure, above the finding text', () => {
        const { container } = render(
            <AuscultationPanel {...baseProps} figure="manikin" layout="stack" transport="compact" />,
        );
        const seek = container.querySelector('input[type="range"]');
        const findingText = [...container.querySelectorAll('div')]
            .find((node) => node.textContent.trim().startsWith('Vesicular breath sounds')
                && node.children.length === 0);
        const figure = container.querySelector('svg mask').closest('div');
        expect(seek).not.toBeNull();
        expect(findingText).toBeDefined();
        const order = (node) => [...container.querySelectorAll('*')].indexOf(node);
        expect(order(figure)).toBeLessThan(order(seek));
        expect(order(seek)).toBeLessThan(order(findingText));
    });

    it('keeps the finding above the player when there is room side by side', () => {
        const { container } = render(
            <AuscultationPanel {...baseProps} figure="manikin" layout="row" transport="compact" />,
        );
        const seek = container.querySelector('input[type="range"]');
        const findingText = [...container.querySelectorAll('div')]
            .find((node) => node.textContent.trim().startsWith('Vesicular breath sounds')
                && node.children.length === 0);
        const order = (node) => [...container.querySelectorAll('*')].indexOf(node);
        expect(order(findingText)).toBeLessThan(order(seek));
    });
});

describe('AuscultationPanel chrome', () => {
    beforeEach(() => {
        vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
        vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    });

    it('keeps its own card and header by default', () => {
        const { container, getByText } = render(<AuscultationPanel {...baseProps} />);
        expect(container.firstChild.className).toMatch(/rounded-lg border/);
        expect(getByText(/Auscultation/)).toBeDefined();
    });

    it('drops the frame and the duplicated header when the host owns them', () => {
        const { container } = render(<AuscultationPanel {...baseProps} chrome="bare" />);
        expect(container.firstChild.className).not.toMatch(/rounded-lg border/);
        // The region/technique heading is the host's job in bare mode.
        const heading = [...container.querySelectorAll('div')]
            .find((node) => /items-center justify-between mb-3/.test(node.className));
        expect(heading.className).toMatch(/hidden/);
        // The clinical content itself is untouched.
        expect(container.querySelectorAll('button[title]').length).toBeGreaterThanOrEqual(5);
    });
});
