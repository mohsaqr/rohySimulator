// Contract for the consolidated top-bar menu: ONE trigger opens ONE panel that
// holds the Cases shortcut, profile/settings/help, the language switcher, and
// logout. (Previously a separate globe + gear; merged on user request.)

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import TopBarControls from './TopBarControls';

// i18n is stubbed to echo keys so assertions don't depend on translations.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k) => k }),
}));

function setup(props = {}) {
    const handlers = {
        onOpenCases: vi.fn(),
        onOpenProfile: vi.fn(),
        onOpenSettings: vi.fn(),
        onOpenHelp: vi.fn(),
        onLogout: vi.fn(),
        onSetLanguage: vi.fn(),
    };
    render(<TopBarControls uiLanguage="en" {...handlers} {...props} />);
    return handlers;
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'settings_menu_aria' }));

describe('TopBarControls (consolidated menu)', () => {
    it('exposes a single menu trigger, not two', () => {
        setup();
        // ONE menu trigger at rest (the old globe + gear pair is gone). The
        // direct logout button beside it is not a menu.
        const triggers = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded'));
        expect(triggers).toHaveLength(1);
    });

    // Regression lock: ISSUE-0018 — logout was reachable only as the last
    // dropdown item and pilot testers could not find it.
    it('offers logout directly in the bar, without opening the menu', () => {
        const h = setup();
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'logout' }));
        expect(h.onLogout).toHaveBeenCalledTimes(1);
    });

    it('omits the direct logout button when no handler is provided', () => {
        setup({ onLogout: undefined });
        expect(screen.queryByRole('button', { name: 'logout' })).toBeNull();
    });

    it('opens one panel holding cases, settings, and the language switch', () => {
        setup();
        openMenu();
        const menu = screen.getByRole('menu');
        expect(within(menu).getByText('menu_cases')).toBeInTheDocument();
        expect(within(menu).getByText('open_settings')).toBeInTheDocument();
        expect(within(menu).getByText('my_profile')).toBeInTheDocument();
        // language section: label + one radio per language, current one checked
        expect(within(menu).getByText('menu_language')).toBeInTheDocument();
        const langItems = within(menu).getAllByRole('menuitemradio');
        expect(langItems.length).toBeGreaterThanOrEqual(4);
        expect(langItems.some((el) => el.getAttribute('aria-checked') === 'true')).toBe(true);
    });

    it('fires the Cases shortcut', () => {
        const h = setup();
        openMenu();
        fireEvent.click(screen.getByText('menu_cases'));
        expect(h.onOpenCases).toHaveBeenCalledTimes(1);
    });

    it('switches language from within the same menu', () => {
        const h = setup();
        openMenu();
        // pick a non-current language (German) by its native label
        fireEvent.click(screen.getByText(/Deutsch/));
        expect(h.onSetLanguage).toHaveBeenCalledWith('de');
    });

    it('hides the Cases shortcut when no handler is provided', () => {
        setup({ onOpenCases: undefined });
        openMenu();
        expect(screen.queryByText('menu_cases')).not.toBeInTheDocument();
    });
});

// The named Oyon dashboard is an ADDITION beside Emotion Analytics, not a
// replacement for it. Both entries must coexist under the same educator+ gate.
describe('TopBarControls — named Oyon dashboard entry', () => {
    it('renders the Oyon dashboard entry alongside Emotion Analytics for educator+', () => {
        setup({ canSeeOyonAnalytics: true });
        openMenu();
        const menu = screen.getByRole('menu');
        // Regression lock: the pre-existing entry must survive the addition.
        expect(within(menu).getByText('emotion_analytics')).toBeInTheDocument();
        expect(within(menu).getByText('oyon_dashboard')).toBeInTheDocument();
    });

    it('invokes onOpenOyonDashboard, leaving the emotion-analytics handler alone', () => {
        const onOpenOyonDashboard = vi.fn();
        const onOpenEmotionAnalytics = vi.fn();
        setup({ canSeeOyonAnalytics: true, onOpenOyonDashboard, onOpenEmotionAnalytics });
        openMenu();
        fireEvent.click(screen.getByText('oyon_dashboard'));
        expect(onOpenOyonDashboard).toHaveBeenCalledTimes(1);
        expect(onOpenEmotionAnalytics).not.toHaveBeenCalled();
    });

    it('hides the Oyon dashboard entry from users without Oyon read access', () => {
        setup({ canSeeOyonAnalytics: false });
        openMenu();
        expect(screen.queryByText('oyon_dashboard')).not.toBeInTheDocument();
    });
});
