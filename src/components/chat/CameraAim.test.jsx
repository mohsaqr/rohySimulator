// Regression lock for Bug 12 (16.5.2026 report): the avatar-config FOV
// slider didn't affect the preview. R3F applies camera={{fov}} only at
// initial Canvas mount; CameraAim updated position/lookAt on change but
// never camera.fov, so later slider moves never reached the live camera.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const fakeCamera = {
    position: { set: vi.fn() },
    lookAt: vi.fn(),
    updateProjectionMatrix: vi.fn(),
    fov: 30, // initial mount value
};

vi.mock('@react-three/fiber', () => ({
    useThree: () => ({ camera: fakeCamera }),
}));

import { CameraAim } from './PatientAvatar.jsx';

beforeEach(() => {
    fakeCamera.fov = 30;
    fakeCamera.position.set.mockClear();
    fakeCamera.lookAt.mockClear();
    fakeCamera.updateProjectionMatrix.mockClear();
});
afterEach(cleanup);

describe('CameraAim FOV application (Bug 12)', () => {
    it('writes the fov prop onto the live camera and recomputes the projection', () => {
        render(<CameraAim pos={[0, 1, 2]} lookY={1} fov={55} />);
        expect(fakeCamera.fov).toBe(55);
        expect(fakeCamera.updateProjectionMatrix).toHaveBeenCalled();
    });

    it('tracks subsequent FOV changes (slider moves after mount)', () => {
        const { rerender } = render(<CameraAim pos={[0, 1, 2]} lookY={1} fov={40} />);
        expect(fakeCamera.fov).toBe(40);
        rerender(<CameraAim pos={[0, 1, 2]} lookY={1} fov={70} />);
        expect(fakeCamera.fov).toBe(70);
        expect(fakeCamera.updateProjectionMatrix).toHaveBeenCalledTimes(2);
    });

    it('is a no-op for fov when not provided (back-compat)', () => {
        render(<CameraAim pos={[0, 0, 3]} lookY={0} />);
        expect(fakeCamera.fov).toBe(30); // unchanged
        expect(fakeCamera.updateProjectionMatrix).toHaveBeenCalled();
    });
});
