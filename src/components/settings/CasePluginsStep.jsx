import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Puzzle, Pencil, Trash2, AlertTriangle, Info } from 'lucide-react';
import { registry } from '../../plugins/registry.js';

/**
 * RPS-1 §11a.3(1) — the wizard step that makes a plugin's material discoverable.
 *
 * "Discoverable" is the actual requirement: a case author must be able to find
 * a plugin's editor WITHOUT already knowing the plugin exists. Before this
 * step, pathology material could only reach a case by hand-pasting the
 * editor's JSON export into `config`, which meant the authoring slot was real
 * in the standard and imaginary in the product.
 *
 * NOTHING HERE KNOWS WHAT A PLUGIN IS. The card's label, its one-line summary
 * and its list of problems all come from the descriptor — `authoring.labelKey`,
 * `summarize(doc)`, `validate(doc)`. That is the test of whether the standard
 * is worth having: a second plugin that ships an editor appears here with no
 * change to this file. If this component ever grows an `if (id === 'pathology')`
 * the design has failed.
 *
 * The step is deliberately a SUMMARY, not the editor. A plugin editor is a
 * workstation — pathology's is a whole-slide viewer with its own header — and
 * wrapping it in two headers and a wizard footer is the wrong frame. "Open
 * editor" hands off to a full-page surface, the way the persona editor does.
 */
export function CasePluginsStep({ caseData, setCaseData, role, onOpenPluginAuthor }) {
    const { t } = useTranslation('authoring_config');
    const [confirmingRemoval, setConfirmingRemoval] = useState(null);

    // Not filtered by `available()`, deliberately: that gate declines a case
    // with no material, which is exactly the case an editor exists to create.
    const authors = registry.authors(role);
    if (authors.length === 0) return null;

    const config = caseData?.config ?? {};

    const removeDocument = (pluginId) => {
        setCaseData((prev) => {
            // Delete rather than set to undefined: JSON.stringify drops an
            // undefined value anyway, but an explicit key with `undefined`
            // survives a spread and reads as "present" to anything checking
            // with `in`.
            const { [pluginId]: _removed, ...rest } = prev.config ?? {};
            return { ...prev, config: rest };
        });
        setConfirmingRemoval(null);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3">
                <Puzzle className="w-5 h-5 text-teal-400 mt-0.5 shrink-0" />
                <p className="text-sm text-neutral-400">{t('plugins_step_help')}</p>
            </div>

            <div className="space-y-3">
                {authors.map((plugin) => {
                    const { id, authoring } = plugin.manifest;
                    const document = config[id] ?? null;

                    // Both hooks are the plugin's. A descriptor that ships no
                    // summarize() falls back to "material present" rather than
                    // the host inventing a count it cannot compute.
                    const summary = document && typeof plugin.summarize === 'function'
                        ? plugin.summarize(document)
                        : null;
                    // validate() is REQUIRED of any plugin declaring authoring
                    // (R19), but a descriptor is ordinary code and may throw;
                    // an editor's bug must not take the case wizard down.
                    let issues = [];
                    if (document && typeof plugin.validate === 'function') {
                        try {
                            issues = plugin.validate(document) ?? [];
                        } catch {
                            issues = [{ level: 'error', message: t('plugins_validate_failed') }];
                        }
                    }
                    const errors = issues.filter((issue) => issue.level === 'error');
                    const warnings = issues.filter((issue) => issue.level !== 'error');

                    return (
                        <div key={id} className="border border-neutral-800 rounded-lg p-4 bg-neutral-900/40">
                            <div className="flex items-start justify-between gap-4 flex-wrap">
                                <div className="min-w-0">
                                    {/* A plugin's keys (`authoring.labelKey`, `summarize().labelKey`)
                                        live in the `common` namespace — that is where every
                                        plugin string lives, room labels included — while this
                                        step's own strings are `authoring_config`. Resolve
                                        theirs explicitly; the hook's namespace would render
                                        the raw key. */}
                                    <h4 className="font-bold text-white">{t(authoring.labelKey, { ns: 'common' })}</h4>
                                    <p className="text-sm text-neutral-400 mt-0.5">
                                        {document
                                            ? (summary
                                                ? t(summary.labelKey, { ns: 'common', count: summary.count })
                                                : t('plugins_material_present'))
                                            : t('plugins_no_material')}
                                    </p>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => onOpenPluginAuthor?.(id)}
                                        disabled={typeof onOpenPluginAuthor !== 'function'}
                                        className="px-3 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:hover:bg-teal-600 rounded font-bold text-sm flex items-center gap-2"
                                    >
                                        <Pencil className="w-4 h-4" /> {t('plugins_open_editor')}
                                    </button>
                                    {document && (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmingRemoval(id)}
                                            className="px-3 py-2 bg-neutral-800 hover:bg-red-800 rounded font-bold text-sm flex items-center gap-2"
                                        >
                                            <Trash2 className="w-4 h-4" /> {t('plugins_remove')}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Errors first: these are the reasons the case
                                cannot go in front of learners. They never
                                block SAVING — a half-finished case is the
                                normal state of an unfinished one (§11a.2). */}
                            {(errors.length > 0 || warnings.length > 0) && (
                                <ul className="mt-3 space-y-1 text-sm">
                                    {[...errors, ...warnings].map((issue, index) => (
                                        <li
                                            key={`${issue.level}-${index}`}
                                            className={`flex items-start gap-2 ${issue.level === 'error' ? 'text-red-300' : 'text-amber-300'}`}
                                        >
                                            {issue.level === 'error'
                                                ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                                : <Info className="w-4 h-4 mt-0.5 shrink-0" />}
                                            <span>{issue.message}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {confirmingRemoval === id && (
                                <div className="mt-3 p-3 border border-red-800/60 bg-red-950/30 rounded flex items-center justify-between gap-3 flex-wrap">
                                    <span className="text-sm text-red-200">{t('plugins_remove_confirm')}</span>
                                    <div className="flex gap-2 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setConfirmingRemoval(null)}
                                            className="px-3 py-1.5 rounded border border-neutral-700 text-neutral-300 text-sm"
                                        >
                                            {t('btn_cancel')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeDocument(id)}
                                            className="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white text-sm font-bold"
                                        >
                                            {t('plugins_remove')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default CasePluginsStep;
