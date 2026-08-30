// Regression lock: the speaker caption never prints a GUESSED gender.
//
// Agents carry no stored gender, so ChatInterface guesses one from the name
// and role to route an avatar. That guess was rendered under the face: the
// seeded nurse appeared to the learner as "male" (2026-08-30 UI review, #35b).
// The guess may still pick a head; it may not caption a person.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../contexts/VoiceContext', () => ({
    useVoice: () => ({
        speaking: false,
        listening: false,
        visemes: {},
        voiceSettings: { avatar_type: 'none' },
        headManifest: null,      // keeps the lazy 3D head out of jsdom
        platformAvatars: {},
        activeParticipant: null,
    }),
}));
vi.mock('../oyon/useAoiPublisher', () => ({ useAoiPublisher: () => {} }));

import PatientVisual from './PatientVisual.jsx';

describe('PatientVisual — speaker caption', () => {
    // Regression lock: genderSource 'guessed' is not captioned.
    it('does not caption a guessed gender', () => {
        render(<PatientVisual participant={{
            name: 'Nancy', gender: 'male', genderSource: 'guessed', avatar_id: null,
        }} />);

        expect(screen.getByText('Nancy')).toBeInTheDocument();
        expect(screen.queryByText(/male/i)).toBeNull();
    });

    it('captions a declared gender and age', () => {
        render(<PatientVisual participant={{
            name: 'Alice', age: 61, gender: 'female', genderSource: 'declared', avatar_id: null,
        }} />);

        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText(/female/i)).toBeInTheDocument();
        expect(screen.getByText(/61/)).toBeInTheDocument();
    });

    it('still shows the age when the gender is only a guess', () => {
        render(<PatientVisual participant={{
            name: 'Nancy', age: 40, gender: 'male', genderSource: 'guessed', avatar_id: null,
        }} />);

        expect(screen.getByText(/40/)).toBeInTheDocument();
        expect(screen.queryByText(/male/i)).toBeNull();
    });

    // No genderSource at all (an older producer) keeps the previous behaviour:
    // only an explicitly guessed value is withheld.
    it('captions a gender that carries no source marker', () => {
        render(<PatientVisual participant={{ name: 'Bob', gender: 'male', avatar_id: null }} />);
        expect(screen.getByText(/male/i)).toBeInTheDocument();
    });
});
