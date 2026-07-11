// Integrity contract for the shared LLM provider + model catalogue
// (server/shared/llmCatalogue.js) — the single source of truth behind the
// settings pickers, the GET /api/llm/models endpoint, and the pricing seed.
//
// Pins: every provider carries complete metadata; catalogued models are
// well-formed; defaults are non-legacy; the current Claude line is present;
// every priced (openai/anthropic) model has a pricing row; the pricing-seed
// helper and the flat registry stay consistent with the catalogue.

import { describe, expect, it } from 'vitest';
import {
    LLM_PROVIDERS,
    LLM_MODELS,
    LLM_MODEL_PRICING,
    LLM_MODEL_REGISTRY,
    TIER_LABELS,
    modelsFor,
    defaultModelFor,
    isKnownModel,
    pricingSeedRows
} from '../../server/shared/llmCatalogue.js';

const PROVIDER_KEYS = Object.keys(LLM_PROVIDERS);
const TIERS = new Set(['flagship', 'balanced', 'fast', 'legacy']);
const PRICED_PROVIDERS = ['openai', 'anthropic'];

describe('LLM_PROVIDERS', () => {
    it.each(PROVIDER_KEYS)('%s has complete metadata', (key) => {
        const p = LLM_PROVIDERS[key];
        expect(p.name, `${key}.name`).toBeTruthy();
        expect(p.defaultBase, `${key}.defaultBase`).toMatch(/^https?:\/\//);
        expect(typeof p.needsKey).toBe('boolean');
        expect(typeof p.modelRequired).toBe('boolean');
        expect(['anthropic', 'openai']).toContain(p.apiShape);
        expect(['local', 'cloud', 'other']).toContain(p.group);
    });

    it('only anthropic uses the anthropic request shape', () => {
        const anthropicShaped = PROVIDER_KEYS.filter(k => LLM_PROVIDERS[k].apiShape === 'anthropic');
        expect(anthropicShaped).toEqual(['anthropic']);
    });
});

describe('LLM_MODELS', () => {
    it('every provider has a model list (possibly empty)', () => {
        for (const key of PROVIDER_KEYS) {
            expect(Array.isArray(LLM_MODELS[key]), `${key} model list`).toBe(true);
        }
    });

    it('every catalogued model is well-formed with a known tier', () => {
        for (const [provider, models] of Object.entries(LLM_MODELS)) {
            for (const m of models) {
                expect(m.id, `${provider} model id`).toBeTruthy();
                expect(m.label, `${provider}/${m.id} label`).toBeTruthy();
                expect(TIERS.has(m.tier), `${provider}/${m.id} tier "${m.tier}"`).toBe(true);
            }
        }
    });

    it('has no duplicate model ids within a provider', () => {
        for (const [provider, models] of Object.entries(LLM_MODELS)) {
            const ids = models.map(m => m.id);
            expect(new Set(ids).size, `${provider} duplicate ids`).toBe(ids.length);
        }
    });

    it('carries the current Claude line', () => {
        const ids = LLM_MODELS.anthropic.map(m => m.id);
        expect(ids).toContain('claude-opus-4-8');
        expect(ids).toContain('claude-sonnet-5');
        expect(ids).toContain('claude-haiku-4-5-20251001');
    });

    it('lists deployment-specific providers with no curated models', () => {
        expect(modelsFor('lmstudio')).toEqual([]);
        expect(modelsFor('azure')).toEqual([]);
        expect(modelsFor('custom')).toEqual([]);
    });
});

describe('defaultModelFor', () => {
    it('returns a non-legacy catalogued id for providers with a catalogue', () => {
        for (const key of PROVIDER_KEYS) {
            const def = defaultModelFor(key);
            if (modelsFor(key).length === 0) {
                expect(def, `${key} default`).toBe('');
            } else {
                expect(isKnownModel(key, def), `${key} default "${def}" catalogued`).toBe(true);
                const tier = modelsFor(key).find(m => m.id === def).tier;
                expect(tier, `${key} default tier`).not.toBe('legacy');
            }
        }
    });

    it('anthropic defaults to the flagship', () => {
        expect(defaultModelFor('anthropic')).toBe('claude-opus-4-8');
    });
});

describe('isKnownModel', () => {
    it('is true only for catalogued ids', () => {
        expect(isKnownModel('anthropic', 'claude-opus-4-8')).toBe(true);
        expect(isKnownModel('anthropic', 'not-a-real-model')).toBe(false);
        expect(isKnownModel('lmstudio', 'anything')).toBe(false);
        expect(isKnownModel('anthropic', '')).toBe(false);
    });
});

describe('LLM_MODEL_PRICING', () => {
    it('prices every catalogued openai/anthropic model', () => {
        for (const provider of PRICED_PROVIDERS) {
            for (const m of LLM_MODELS[provider]) {
                const price = LLM_MODEL_PRICING[provider]?.[m.id];
                expect(price, `pricing for ${provider}/${m.id}`).toBeDefined();
                expect(price.in).toBeGreaterThanOrEqual(0);
                expect(price.out).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('keeps local providers at zero cost', () => {
        expect(LLM_MODEL_PRICING.lmstudio.default).toEqual({ in: 0, out: 0 });
        expect(LLM_MODEL_PRICING.ollama.default).toEqual({ in: 0, out: 0 });
    });

    it('pricingSeedRows() emits [provider, model, in, out] tuples', () => {
        const rows = pricingSeedRows();
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(row).toHaveLength(4);
            const [provider, model, input, output] = row;
            expect(typeof provider).toBe('string');
            expect(typeof model).toBe('string');
            expect(typeof input).toBe('number');
            expect(typeof output).toBe('number');
        }
        // Opus 4.8 must be seeded so cost tracking is non-zero for the flagship.
        expect(rows).toContainEqual(['anthropic', 'claude-opus-4-8', 0.015, 0.075]);
    });
});

describe('LLM_MODEL_REGISTRY (served by GET /api/llm/models)', () => {
    it('flattens every catalogued model with its provider', () => {
        const total = Object.values(LLM_MODELS).reduce((n, list) => n + list.length, 0);
        expect(LLM_MODEL_REGISTRY).toHaveLength(total);
        for (const entry of LLM_MODEL_REGISTRY) {
            expect(PROVIDER_KEYS).toContain(entry.provider);
            expect(entry.id).toBeTruthy();
            expect(entry.label).toBeTruthy();
            expect(TIERS.has(entry.tier)).toBe(true);
        }
    });

    it('no longer contains the retired Opus 4.7 id', () => {
        expect(LLM_MODEL_REGISTRY.some(m => m.id === 'claude-opus-4-7')).toBe(false);
    });
});

describe('TIER_LABELS', () => {
    it('labels every tier used in the catalogue', () => {
        for (const models of Object.values(LLM_MODELS)) {
            for (const m of models) {
                expect(TIER_LABELS[m.tier], `label for tier ${m.tier}`).toBeTruthy();
            }
        }
    });
});
