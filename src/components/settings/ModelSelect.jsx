// Shared model picker used by BOTH the admin LLM screen (ConfigPanel) and the
// per-user AI tab (UserProfilePanel), so the two surfaces can never drift.
//
// It's a single editable combobox: one text field you can always type in, with
// the shared catalogue offered as type-ahead suggestions (native <datalist>).
// Pick a suggestion or type any model id — a dated snapshot, a fine-tune, a
// model we don't list yet. Providers with no catalogue just get the plain box.
import { modelsFor, TIER_LABELS } from '../../services/llmCatalogue';

const ACCENT_BORDER = {
    cyan: 'focus:border-cyan-500',
    blue: 'focus:border-blue-500'
};

/**
 * @param {string}   provider  active provider key
 * @param {string}   value     current model id (controlled)
 * @param {Function} onChange  (modelId: string) => void
 * @param {'cyan'|'blue'} [accent]  focus-ring colour (default cyan / admin)
 * @param {string}   [id]      id for the input (label association)
 * @param {boolean}  [invalid] draw a red border (validation error)
 * @param {string[]} [detectedModels]  ids fetched live from the running server
 *   (LM Studio / Ollama / any OpenAI-compatible `/models`). Offered as
 *   suggestions ahead of the static catalogue so the admin can pick exactly
 *   what's loaded — the answer to "Multiple models are loaded, specify one".
 */
export default function ModelSelect({ provider, value, onChange, accent = 'cyan', id, invalid = false, detectedModels = [] }) {
    const catalogue = modelsFor(provider);
    // Live-detected ids lead (they reflect what's actually loaded right now);
    // catalogue entries fill in behind them, skipping any already detected.
    const detected = detectedModels
        .filter((id) => typeof id === 'string' && id.trim() !== '')
        .map((mid) => ({ id: mid, label: mid, tier: 'loaded' }));
    const catalogueOnly = catalogue.filter((m) => !detected.some((d) => d.id === m.id));
    const models = [...detected, ...catalogueOnly];
    const border = invalid ? 'border-red-500' : 'border-neutral-600';
    const base = `w-full bg-neutral-800 border ${border} rounded-lg p-3 text-white outline-none ${ACCENT_BORDER[accent] || ACCENT_BORDER.cyan}`;
    const listId = `${id || `model-${provider}`}-options`;

    return (
        <div>
            <input
                id={id}
                type="text"
                list={models.length ? listId : undefined}
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                className={base}
                placeholder="model-name"
                autoComplete="off"
                spellCheck={false}
                aria-label="Model name"
            />
            {models.length > 0 && (
                <>
                    <datalist id={listId}>
                        {models.map((m) => (
                            <option key={m.id} value={m.id} label={`${m.label} · ${TIER_LABELS[m.tier] || 'loaded now'}`} />
                        ))}
                    </datalist>
                    <p className="text-xs text-neutral-500 mt-1">
                        Pick a suggestion or type any model id.
                    </p>
                </>
            )}
        </div>
    );
}
