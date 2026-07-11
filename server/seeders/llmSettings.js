/**
 * LLM Platform-Settings Seeder
 *
 * Writes the explicit, NON-SECRET LLM platform defaults into
 * platform_settings so a fresh install has visible, editable rows instead
 * of invisible read-time code fallbacks. The values below mirror the
 * fallbacks that already exist in code:
 *   - server/routes/proxy-routes.js (~line 202-208):
 *       getPlatformLLMSetting('llm_provider', 'lmstudio')
 *       getPlatformLLMSetting('llm_base_url', 'http://localhost:1234/v1')
 *   - server/routes/admin-routes.js (~line 1152, DEFAULT_LLM_SETTINGS):
 *       provider: 'lmstudio', baseUrl: 'http://localhost:1234/v1',
 *       enabled: true
 *
 * Deliberately NOT seeded:
 *   - 'llm_api_key' — a secret; must never be written by a seeder.
 *   - 'llm_model'   — free-text and deployment-specific; left unset so the
 *                     read-time default applies until an admin picks one.
 *
 * Idempotency: the caller passes in setSettingIfEmpty(key, value) — the
 * ON CONFLICT DO NOTHING helper defined in server/server.js — so these
 * writes only ever fill EMPTY keys and never clobber a value an admin has
 * saved.
 */

import { logger } from '../logger.js';
import { LLM_PROVIDERS } from '../shared/llmCatalogue.js';

const seederLog = logger('seeder');

// Default provider for a fresh install: a local LM Studio server (no key, no
// model needed). Its base URL comes from the shared catalogue so there is one
// source of truth.
const SEED_PROVIDER = 'lmstudio';

/**
 * Explicit non-secret LLM defaults (key => value). Exported so tests can
 * pin the seed contract.
 */
export const defaultLlmSettings = {
    llm_provider: SEED_PROVIDER,
    llm_base_url: LLM_PROVIDERS[SEED_PROVIDER].defaultBase,
    llm_enabled: 'true'
};

/**
 * Seed the LLM platform defaults into platform_settings.
 * @param {Function} setSettingIfEmpty - async (key, value) helper that
 *        inserts with ON CONFLICT DO NOTHING (never overwrites existing
 *        admin-saved values). Same helper server.js uses for the Voice 2.0
 *        defaults (~line 301).
 * @returns {Promise<{seeded: string[]}>} keys the helper was invoked for
 */
export async function seedLlmDefaults(setSettingIfEmpty) {
    if (typeof setSettingIfEmpty !== 'function') {
        throw new Error('seedLlmDefaults requires a setSettingIfEmpty(key, value) function');
    }

    const keys = Object.keys(defaultLlmSettings);
    for (const key of keys) {
        await setSettingIfEmpty(key, defaultLlmSettings[key]);
    }

    seederLog.info('llm platform defaults seeded (empty keys only)', { keys });
    return { seeded: keys };
}

export default seedLlmDefaults;
