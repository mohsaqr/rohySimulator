// Contract test for server/seeders/llmSettings.js — the explicit,
// NON-SECRET LLM platform defaults that replace the invisible read-time
// fallbacks (proxy-routes.js ~202-208, admin-routes.js DEFAULT_LLM_SETTINGS).
//
// Pins: exactly the three non-secret keys are seeded (provider, base URL,
// enabled) with the fallback-matching values; the secret ('llm_api_key')
// and the free-text model ('llm_model') are never written; the seeder only
// ever calls the injected setSettingIfEmpty helper (so admin-saved values
// can never be clobbered — the helper is ON CONFLICT DO NOTHING).

import { describe, expect, it } from 'vitest';
import { seedLlmDefaults, defaultLlmSettings } from '../../server/seeders/llmSettings.js';

describe('seedLlmDefaults', () => {
    it('seeds exactly the three non-secret keys with fallback-matching values', async () => {
        const calls = [];
        const result = await seedLlmDefaults(async (key, value) => {
            calls.push([key, value]);
        });

        expect(calls).toEqual([
            ['llm_provider', 'lmstudio'],
            ['llm_base_url', 'http://localhost:1234/v1'],
            ['llm_enabled', 'true']
        ]);
        expect(result.seeded).toEqual(['llm_provider', 'llm_base_url', 'llm_enabled']);
    });

    it('never seeds the API key or the model', () => {
        const keys = Object.keys(defaultLlmSettings);
        expect(keys).not.toContain('llm_api_key');
        expect(keys).not.toContain('llm_model');
    });

    it('rejects a missing setSettingIfEmpty helper instead of writing directly', async () => {
        await expect(seedLlmDefaults()).rejects.toThrow(/setSettingIfEmpty/);
    });

    it('propagates helper failures instead of swallowing them', async () => {
        await expect(
            seedLlmDefaults(async () => { throw new Error('db locked'); })
        ).rejects.toThrow('db locked');
    });
});
