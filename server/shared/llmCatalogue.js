// Single source of truth for LLM providers, their current model catalogue,
// and per-model pricing.
//
// Lives under server/ (not src/) for the same reason as
// server/shared/languages.js: the Docker runtime stage copies server/
// wholesale but NOT src/, so any server code importing from src/ would crash
// only in the deployed image. Client code imports this via the thin re-export
// at src/services/llmCatalogue.js — the bundler owns the cross-tree path in
// exactly one place. No component, route, or seeder may hardcode a provider
// list, a model id, or a price anywhere else.
//
// MODEL-ID ACCURACY: the ids below were verified against each provider's live
// model docs on 2026-07-11 (sources noted per provider). Provider model ids
// still churn, so re-check when models change — the picker's "Custom…" escape
// covers anything unlisted, so a stale id here never blocks an admin.

// Human-facing tier labels (admin English — model tiers are not localized,
// same as model names themselves are proper nouns, not translated).
export const TIER_LABELS = {
    flagship: 'Flagship',
    balanced: 'Balanced',
    fast: 'Fast',
    legacy: 'Legacy'
};

// Provider metadata. `name` is used in validation messages; `keyPrefix` is the
// expected start of an API key (a soft sanity check, never a blocker);
// `apiShape` selects the request format at the proxy ('anthropic' → /messages,
// everything else → OpenAI-compatible /chat/completions); `group` drives the
// grouped <optgroup> in the pickers.
export const LLM_PROVIDERS = {
    lmstudio:   { name: 'LM Studio (Local)',          defaultBase: 'http://localhost:1234/v1',                                            needsKey: false, modelRequired: false, keyPrefix: '',        apiShape: 'openai',    group: 'local' },
    ollama:     { name: 'Ollama (Local)',             defaultBase: 'http://localhost:11434/v1',                                           needsKey: false, modelRequired: true,  keyPrefix: '',        apiShape: 'openai',    group: 'local' },
    openai:     { name: 'OpenAI',                      defaultBase: 'https://api.openai.com/v1',                                           needsKey: true,  modelRequired: true,  keyPrefix: 'sk-',     apiShape: 'openai',    group: 'cloud' },
    anthropic:  { name: 'Anthropic (Claude)',         defaultBase: 'https://api.anthropic.com/v1',                                        needsKey: true,  modelRequired: true,  keyPrefix: 'sk-ant-', apiShape: 'anthropic', group: 'cloud' },
    openrouter: { name: 'OpenRouter',                 defaultBase: 'https://openrouter.ai/api/v1',                                        needsKey: true,  modelRequired: true,  keyPrefix: 'sk-or-',  apiShape: 'openai',    group: 'cloud' },
    groq:       { name: 'Groq',                        defaultBase: 'https://api.groq.com/openai/v1',                                      needsKey: true,  modelRequired: true,  keyPrefix: 'gsk_',    apiShape: 'openai',    group: 'cloud' },
    together:   { name: 'Together AI',                 defaultBase: 'https://api.together.xyz/v1',                                         needsKey: true,  modelRequired: true,  keyPrefix: '',        apiShape: 'openai',    group: 'cloud' },
    azure:      { name: 'Azure OpenAI',               defaultBase: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT', needsKey: true, modelRequired: false, keyPrefix: '',    apiShape: 'openai',    group: 'cloud' },
    custom:     { name: 'Custom OpenAI-Compatible',   defaultBase: 'http://localhost:8000/v1',                                            needsKey: false, modelRequired: false, keyPrefix: '',        apiShape: 'openai',    group: 'other' }
};

// Curated model catalogue per provider, newest first. Providers whose model is
// entirely deployment-specific (lmstudio, azure, custom) get [] — the picker
// falls straight through to the "Custom…" free-text field for those.
export const LLM_MODELS = {
    anthropic: [
        { id: 'claude-opus-4-8',            label: 'Claude Opus 4.8',            tier: 'flagship' },
        { id: 'claude-sonnet-5',            label: 'Claude Sonnet 5',            tier: 'balanced' },
        { id: 'claude-fable-5',             label: 'Claude Fable 5',             tier: 'balanced' },
        { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5',           tier: 'fast'     },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (legacy)', tier: 'legacy'   },
        { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku (legacy)',  tier: 'legacy'   }
    ],
    // Verified: developers.openai.com/api/docs/models (2026-07-11). Reached via
    // the proxy's OpenAI-compatible /chat/completions path.
    openai: [
        { id: 'gpt-5.6-sol',   label: 'GPT-5.6 Sol',          tier: 'flagship' },
        { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra',        tier: 'balanced' },
        { id: 'gpt-5.6-luna',  label: 'GPT-5.6 Luna',         tier: 'fast'     },
        { id: 'gpt-5.5',       label: 'GPT-5.5',              tier: 'flagship' },
        { id: 'gpt-5.5-pro',   label: 'GPT-5.5 Pro',          tier: 'flagship' },
        { id: 'gpt-5.4',       label: 'GPT-5.4',              tier: 'balanced' },
        { id: 'gpt-5.4-mini',  label: 'GPT-5.4 mini',         tier: 'fast'     },
        { id: 'gpt-5',         label: 'GPT-5',                tier: 'balanced' },
        { id: 'gpt-5-mini',    label: 'GPT-5 mini',           tier: 'fast'     },
        { id: 'o3',            label: 'o3 (reasoning)',       tier: 'flagship' },
        { id: 'o3-pro',        label: 'o3-pro (reasoning)',   tier: 'flagship' },
        { id: 'gpt-4.1',       label: 'GPT-4.1',              tier: 'balanced' },
        { id: 'gpt-4.1-mini',  label: 'GPT-4.1 mini',         tier: 'fast'     },
        { id: 'gpt-4o-mini',   label: 'GPT-4o mini (legacy)', tier: 'legacy'   }
    ],
    // Verified: openrouter.ai/api/v1/models (2026-07-11). NB the slugs are
    // DOTTED (claude-opus-4.8) — not Anthropic's own hyphenated id.
    openrouter: [
        { id: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8 (via OpenRouter)', tier: 'flagship' },
        { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 (via OpenRouter)', tier: 'balanced' },
        { id: 'openai/gpt-5.6-sol',        label: 'GPT-5.6 Sol (via OpenRouter)',     tier: 'flagship' }
    ],
    // Verified: console.groq.com/docs/models (2026-07-11). The Llama production
    // models are on Groq's deprecation path (announced 2026-06-17) → kept as
    // legacy; gpt-oss is Groq's current recommendation.
    groq: [
        { id: 'openai/gpt-oss-120b',     label: 'GPT-OSS 120B',               tier: 'flagship' },
        { id: 'openai/gpt-oss-20b',      label: 'GPT-OSS 20B',                tier: 'fast'     },
        { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (deprecated)', tier: 'legacy'   }
    ],
    // Verified: docs.together.ai/docs/serverless-models (2026-07-11).
    together: [
        { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', label: 'Llama 4 Maverick',    tier: 'flagship' },
        { id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',         label: 'Llama 4 Scout',       tier: 'balanced' },
        { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',           label: 'Llama 3.3 70B Turbo', tier: 'fast'     }
    ],
    // Local tags — whatever the admin has pulled; these are common current ones.
    ollama: [
        { id: 'llama3.3', label: 'Llama 3.3', tier: 'balanced' },
        { id: 'llama3.2', label: 'Llama 3.2', tier: 'balanced' },
        { id: 'qwen2.5',  label: 'Qwen 2.5',  tier: 'balanced' }
    ],
    lmstudio: [],
    azure: [],
    custom: []
};

// Per-1,000-token cost in USD { in, out }. ESTIMATES for cost tracking — verify
// against each provider's pricing page. Local providers are zero-cost. Paid
// open-model providers not listed (groq/openrouter/together are usage-priced
// per underlying model) fall back to 0 in llm_model_pricing until an admin adds
// rows; that under-reports cost rather than over-reporting it.
export const LLM_MODEL_PRICING = {
    anthropic: {
        'claude-opus-4-8':            { in: 0.015,  out: 0.075 },
        'claude-sonnet-5':            { in: 0.003,  out: 0.015 },
        'claude-fable-5':             { in: 0.003,  out: 0.015 },
        'claude-haiku-4-5-20251001':  { in: 0.0008, out: 0.004 },
        'claude-3-5-sonnet-20241022': { in: 0.003,  out: 0.015 },
        'claude-3-5-haiku-20241022':  { in: 0.0008, out: 0.004 }
    },
    openai: {
        'gpt-5.6-sol':   { in: 0.005,   out: 0.02   },
        'gpt-5.6-terra': { in: 0.001,   out: 0.004  },
        'gpt-5.6-luna':  { in: 0.0002,  out: 0.0008 },
        'gpt-5.5':       { in: 0.005,   out: 0.02   },
        'gpt-5.5-pro':   { in: 0.01,    out: 0.04   },
        'gpt-5.4':       { in: 0.00125, out: 0.01   },
        'gpt-5.4-mini':  { in: 0.0003,  out: 0.0012 },
        'gpt-5':         { in: 0.00125, out: 0.01   },
        'gpt-5-mini':    { in: 0.0003,  out: 0.0012 },
        'o3':            { in: 0.01,    out: 0.04   },
        'o3-pro':        { in: 0.02,    out: 0.08   },
        'gpt-4.1':       { in: 0.002,   out: 0.008  },
        'gpt-4.1-mini':  { in: 0.0004,  out: 0.0016 },
        'gpt-4o-mini':   { in: 0.00015, out: 0.0006 }
    },
    lmstudio: { default: { in: 0, out: 0 } },
    ollama:   { default: { in: 0, out: 0 } }
};

// Flat model list (provider-annotated) served by GET /api/llm/models. Keeps the
// endpoint's { models: [...] } shape; adding `provider` is additive.
export const LLM_MODEL_REGISTRY = Object.entries(LLM_MODELS).flatMap(
    ([provider, models]) => models.map((m) => ({ provider, ...m }))
);

/** Curated models for a provider (empty array if none / unknown provider). */
export function modelsFor(provider) {
    return LLM_MODELS[provider] || [];
}

/** Preferred default model for a provider: first non-legacy id, else ''. */
export function defaultModelFor(provider) {
    const preferred = modelsFor(provider).find((m) => m.tier !== 'legacy');
    return preferred ? preferred.id : '';
}

/** True if `id` is a catalogued model for `provider`. */
export function isKnownModel(provider, id) {
    return Boolean(id) && modelsFor(provider).some((m) => m.id === id);
}

/** Rows for the llm_model_pricing seed: [provider, model, inPer1k, outPer1k]. */
export function pricingSeedRows() {
    return Object.entries(LLM_MODEL_PRICING).flatMap(([provider, models]) =>
        Object.entries(models).map(([model, p]) => [provider, model, p.in, p.out])
    );
}
