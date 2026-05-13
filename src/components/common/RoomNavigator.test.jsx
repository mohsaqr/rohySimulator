// Contract for RoomNavigator — the bottom nav shared across every
// in-session surface (chat, exam, investigations, consultant). It must:
//   1. Render all five room buttons as peers (no special end action).
//   2. Mark the active room (aria-pressed=true) and only that one.
//   3. Invoke onSelectRoom(key) when a room is clicked.
// The actual session-end action lives on the patient room's
// End & Debrief button, not in this nav.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import RoomNavigator from './RoomNavigator';

function renderNav(overrides = {}) {
    const onSelectRoom = overrides.onSelectRoom ?? vi.fn();
    render(
        <RoomNavigator
            currentRoom={overrides.currentRoom ?? 'chat'}
            onSelectRoom={onSelectRoom}
        />
    );
    return { onSelectRoom };
}

afterEach(() => cleanup());

describe('RoomNavigator', () => {
    it('renders all five peer room buttons', () => {
        renderNav();
        expect(screen.getByRole('button', { name: /Patient/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Examination/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Laboratory/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Radiology/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Consultant/ })).toBeTruthy();
    });

    it('does not render an End-session button (that lives in the patient room)', () => {
        renderNav();
        expect(screen.queryByRole('button', { name: /End & consult/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /End Session/i })).toBeNull();
    });

    it('aria-pressed reflects the active room', () => {
        renderNav({ currentRoom: 'lab' });
        const lab = screen.getByRole('button', { name: /Laboratory/ });
        const chat = screen.getByRole('button', { name: /Patient/ });
        expect(lab.getAttribute('aria-pressed')).toBe('true');
        expect(chat.getAttribute('aria-pressed')).toBe('false');
    });

    it.each([
        ['Patient', 'chat'],
        ['Examination', 'examination'],
        ['Laboratory', 'lab'],
        ['Radiology', 'radiology'],
        ['Consultant', 'consultant'],
    ])('clicking %s calls onSelectRoom(%s)', (label, expected) => {
        const { onSelectRoom } = renderNav({ currentRoom: 'chat' });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
        expect(onSelectRoom).toHaveBeenCalledWith(expected);
    });
});
