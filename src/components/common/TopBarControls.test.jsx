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
    it('exposes a single trigger, not two', () => {
        setup();
        // Only the one menu trigger button is rendered at rest.
        expect(screen.getAllByRole('button')).toHaveLength(1);
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
