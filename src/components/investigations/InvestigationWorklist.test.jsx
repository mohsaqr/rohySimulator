// Regression lock for Bug 4 (16.5.2026 report): pending orders showed the
// literal "Ready" label. Root cause: getTimeRemaining() parsed the SQLite
// "YYYY-MM-DD HH:MM:SS" (UTC, no tz marker) string with new Date(), which
// reads it as LOCAL time. In a UTC-offset timezone the parse lands in the
// past, diff <= 0, and the Pending row printed "Ready".
//
// Pending rows are filtered to !is_ready (server truth), so the label must
// never claim readiness regardless of the viewer's timezone.

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import InvestigationWorklist from './InvestigationWorklist';

afterEach(cleanup);

const theme = { accentText: '', accentRail: '', glow: '' };

function renderWorklist(orders) {
    return render(
        <InvestigationWorklist
            kind="lab"
            theme={theme}
            orders={orders}
            openOrderIds={new Set()}
            onSelectOrder={() => {}}
        />,
    );
}

describe('InvestigationWorklist — pending label (Bug 4)', () => {
    it('never shows "Ready" for a pending order, even with a past-looking UTC string', () => {
        // available_at in the *recent past* as a bare SQLite UTC string —
        // the exact shape that made the old code print "Ready".
        const past = new Date(Date.now() - 5 * 60_000)
            .toISOString().replace('T', ' ').slice(0, 19);
        renderWorklist([
            { id: 1, test_name: 'Iron, serum', is_ready: false, available_at: past },
        ]);
        expect(screen.getByText('Iron, serum')).toBeTruthy();
        expect(screen.queryByText('Ready')).toBeNull();
        // Pending section header still present.
        expect(screen.getByText('Pending')).toBeTruthy();
    });

    it('uses server minutes_remaining for the countdown', () => {
        renderWorklist([
            { id: 2, test_name: 'Ferritin, serum', is_ready: false, minutes_remaining: 3,
              available_at: '2026-05-16 19:17:50' },
        ]);
        expect(screen.getByText('~3 min remaining')).toBeTruthy();
    });

    it('shows a truthful transient (not "Ready") when the timer has lapsed but server still pending', () => {
        renderWorklist([
            { id: 3, test_name: 'Hematocrit', is_ready: false, minutes_remaining: 0,
              available_at: '2026-05-16 19:00:00' },
        ]);
        expect(screen.getByText('Finalizing…')).toBeTruthy();
        expect(screen.queryByText('Ready')).toBeNull();
    });

    it('still renders ready orders in the Ready section normally', () => {
        renderWorklist([
            { id: 4, test_name: 'Glucose', is_ready: true, viewed_at: null },
        ]);
        expect(screen.getByText('Ready')).toBeTruthy(); // section header
        expect(screen.getByText('Tap to open report')).toBeTruthy();
    });
});
