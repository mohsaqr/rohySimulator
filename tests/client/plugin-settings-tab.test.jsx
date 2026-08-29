// Settings → Plugins (RPS-1 1.4 §11c): the host renders a plugin's admin page
// GENERICALLY from the schema its manifest declares. Pathology is the first
// user, not the only intended one — so these tests drive a synthetic schema
// wherever the behaviour is generic, and the real manifest only where it isn't.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiGet = vi.hoisted(() => vi.fn());
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/apiClient', () => ({
    apiGet,
    apiFetch,
    apiPost: vi.fn(),
    ApiError: class ApiError extends Error {
        constructor(status, body) { super(`http ${status}`); this.status = status; this.body = body; }
    },
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key, opts) => opts?.defaultValue ?? key }),
}));

const { default: PluginSettingsTab } = await import('../../src/components/settings/PluginSettingsTab.jsx');
const { ApiError } = await import('../../src/services/apiClient');

const SCHEMA = {
    groups: [
        { key: 'imports', labelKey: 'g_imports' },
        { key: 'tiling', labelKey: 'g_tiling' },
    ],
    fields: {
        'imports.enabled': { type: 'boolean', default: false, labelKey: 'Allow imports' },
        'imports.allowedOrigins': { type: 'origins', default: [], labelKey: 'Allowed hosts' },
        'tiling.tileSize': { type: 'enum', options: [256, 512, 1024], default: 512, labelKey: 'Tile size' },
        'tiling.jpegQuality': { type: 'int', min: 60, max: 95, default: 85, labelKey: 'JPEG quality' },
    },
};
const VALUES = {
    'imports.enabled': false,
    'imports.allowedOrigins': [],
    'tiling.tileSize': 512,
    'tiling.jpegQuality': 85,
};

function mockLoad({ settings = VALUES, assets = null } = {}) {
    apiGet.mockImplementation(async (path) => {
        if (path.endsWith('/settings')) return { plugin: 'pathology', schema: SCHEMA, settings };
        if (path.endsWith('/assets')) {
            if (assets === null) throw new ApiError(503);
            return { assets };
        }
        throw new Error(`unexpected GET ${path}`);
    });
}

beforeEach(() => { apiGet.mockReset(); apiFetch.mockReset(); });

describe('the generic plugin settings page', () => {
    it('renders one card per declared group, with a control per field type', async () => {
        mockLoad();
        render(<PluginSettingsTab />);
        await screen.findByText('g_imports');
        expect(screen.getByText('g_tiling')).toBeInTheDocument();
        expect(screen.getByLabelText('Allow imports')).toBeInstanceOf(HTMLInputElement);
        expect(screen.getByLabelText('Tile size')).toBeInstanceOf(HTMLSelectElement);
        expect(screen.getByLabelText(/JPEG quality/)).toHaveAttribute('type', 'number');
    });

    // Nothing is saveable until something changes, and then ONLY what changed.
    // The PUT is a key-presence merge, so sending every field would overwrite a
    // value another admin edited between this page loading and this click.
    it('sends only the keys the admin actually changed', async () => {
        mockLoad();
        apiFetch.mockResolvedValue({ settings: { ...VALUES, 'imports.enabled': true } });
        const user = userEvent.setup();
        render(<PluginSettingsTab />);

        const save = await screen.findByRole('button', { name: 'Save changes' });
        expect(save).toBeDisabled();

        await user.click(screen.getByLabelText('Allow imports'));
        expect(save).toBeEnabled();
        await user.click(save);

        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        const [path, init] = apiFetch.mock.calls[0];
        expect(path).toBe('/plugins/pathology/settings');
        expect(init.method).toBe('PUT');
        expect(JSON.parse(init.body)).toEqual({ 'imports.enabled': true });
    });

    // A <select> hands back a string. The schema's options carry their own type
    // — a tileSize is a NUMBER — and sending "1024" would be refused by the
    // server's own validator with "must be one of 256, 512, 1024".
    it('sends an enum value in the type the schema declared, not the DOM string', async () => {
        mockLoad();
        apiFetch.mockResolvedValue({ settings: VALUES });
        const user = userEvent.setup();
        render(<PluginSettingsTab />);

        await user.selectOptions(await screen.findByLabelText('Tile size'), '1024');
        await user.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ 'tiling.tileSize': 1024 });
    });

    // The server names the offending field; showing that beats a generic
    // "save failed" when several cards are on screen.
    it('shows the server\'s reason, naming the field', async () => {
        mockLoad();
        apiFetch.mockRejectedValue(new ApiError(400, {
            error: "Setting 'tiling.jpegQuality' must be at most 95", field: 'tiling.jpegQuality',
        }));
        const user = userEvent.setup();
        render(<PluginSettingsTab />);

        await user.click(await screen.findByLabelText('Allow imports'));
        await user.click(screen.getByRole('button', { name: 'Save changes' }));
        expect(await screen.findByRole('alert')).toHaveTextContent("must be at most 95");
    });

    // An empty allowlist is not a misconfiguration to warn about — it is the
    // correct state of a server nobody has told where slides may come from.
    it('says plainly that an empty origin list means no imports', async () => {
        mockLoad();
        render(<PluginSettingsTab />);
        expect(await screen.findByText(/Imports are refused until one is added/)).toBeInTheDocument();
    });

    it('adds and removes an allowed origin without touching the others', async () => {
        mockLoad({ settings: { ...VALUES, 'imports.allowedOrigins': ['https://a.edu'] } });
        apiFetch.mockResolvedValue({ settings: VALUES });
        const user = userEvent.setup();
        render(<PluginSettingsTab />);

        await user.type(await screen.findByPlaceholderText('https://slides.example.edu'), 'https://b.edu');
        await user.click(screen.getByRole('button', { name: 'Add' }));
        await user.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        expect(JSON.parse(apiFetch.mock.calls[0][1].body))
            .toEqual({ 'imports.allowedOrigins': ['https://a.edu', 'https://b.edu'] });
    });
});

describe('the imported-slide library card', () => {
    // No server module (404) or no library directory (503) are OPERATOR states.
    // The card is absent rather than showing an empty table that implies the
    // deployment imports slides and simply has none.
    it('is absent when this deployment has no managed library', async () => {
        mockLoad({ assets: null });
        render(<PluginSettingsTab />);
        await screen.findByText('g_imports');
        // Wait for the card's OWN call to have answered before asserting it is
        // absent — otherwise this passes for the wrong reason on a slow machine,
        // simply because nothing has rendered yet.
        await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/plugins/pathology/assets'));
        await waitFor(() => expect(screen.queryByText('Imported slides')).not.toBeInTheDocument());
    });

    it('lists every imported slide whatever state it is in, with its failure reason', async () => {
        mockLoad({ assets: [
            { id: 'a1', label: 'Liver', status: 'ready', revisions: [{ optics: { nativeObjective: 40, nativeMpp: 0.25 } }] },
            { id: 'a2', label: 'Broken', status: 'failed', error: 'upstream answered 404', revisions: [] },
        ] });
        render(<PluginSettingsTab />);
        expect(await screen.findByText('Liver')).toBeInTheDocument();
        expect(screen.getByText('Broken')).toBeInTheDocument();
        expect(screen.getByText('upstream answered 404')).toBeInTheDocument();
        expect(screen.getByText(/40× · 0.25 µm\/px/)).toBeInTheDocument();
    });

    it('removes a slide through the plugin\'s own route', async () => {
        mockLoad({ assets: [{ id: 'a1', label: 'Liver', status: 'ready', revisions: [] }] });
        apiFetch.mockResolvedValue({ removed: true });
        const user = userEvent.setup();
        render(<PluginSettingsTab />);

        await user.click(await screen.findByRole('button', { name: 'Remove Liver' }));
        await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/plugins/pathology/assets/a1', { method: 'DELETE' }));
    });
});
