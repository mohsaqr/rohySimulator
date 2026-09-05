import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { PluginAuthor } from '../../plugins/index.js';
import EventLogger, { VERBS } from '../../services/eventLogger';

/**
 * RPS-1 §11a.3(2) — "a surface, not a panel".
 *
 * A plugin editor is a workstation: pathology's is a whole-slide viewer with
 * its own header, its own left rail and its own keyboard map. Nesting that in a
 * wizard step would put two headers and a wizard footer around it and leave the
 * actual tool about 400px tall. So it takes the whole viewport.
 *
 * WHY THIS MOUNTS FROM ConfigPanel RATHER THAN App.jsx. The plan called for an
 * App-level early-return, like `personaEditorTarget`. That works for the persona
 * editor because it saves through its own endpoint and needs nothing from the
 * wizard. This one is different: §11a.3(3) says the document is saved by the
 * ORDINARY case save and nothing else, which means the wizard has to still be
 * holding the draft when the editor hands it back. Unmounting ConfigPanel to
 * render the editor would tear that draft down; it would come back from the
 * localStorage stash, but with the "Resumed draft from …" banner — which is a
 * confusing thing to meet immediately after pressing Done on your own edit.
 * Rendered here, the wizard stays mounted, owns the draft throughout, and the
 * document is persisted by the same PUT /cases as everything else in the case.
 *
 * DONE / DISCARD LIVE IN THE PLUGIN'S OWN HEADER, through the `topBarControls`
 * slot the package exposes. That is the whole reason the slot exists — a host
 * header stacked above the plugin's would be the second header this component
 * is trying to avoid.
 */
export function PluginAuthorSurface({ pluginId, caseData, user, onCommit, onClose }) {
    const { t } = useTranslation('authoring_config');

    // Seeded ONCE from the wizard's config (§8's ordering trap). The editor
    // owns its document from here; re-seeding on a parent re-render would
    // discard whatever the author had done since.
    const initial = caseData?.config?.[pluginId] ?? null;
    const [draft, setDraft] = useState(initial);
    const dirty = useRef(false);
    const [confirmingDiscard, setConfirmingDiscard] = useState(false);

    // Document SHAPE for the two host authoring verbs — bytes and top-level
    // keys, never the content (the case save already stores the document).
    const shapeOf = (doc) => {
        let bytes = 0;
        try { bytes = JSON.stringify(doc ?? null).length; } catch { bytes = -1; }
        return { bytes, keys: doc && typeof doc === 'object' ? Object.keys(doc).length : 0, surface: 'author' };
    };
    const logAuthoring = (verb) => EventLogger.log(verb, 'plugin_document', {
        objectId: String(caseData?.id ?? 'new'),
        objectName: `${pluginId} document`,
        component: 'PluginAuthor',
        parentComponent: 'PluginAuthor',
        room: pluginId,
        pluginId,
        context: shapeOf(draft),
    });
    // One EDITED row per burst of edits (2 s quiet), not one per keystroke.
    const editTimer = useRef(null);
    useEffect(() => {
        if (!dirty.current) return undefined;
        clearTimeout(editTimer.current);
        editTimer.current = setTimeout(() => logAuthoring(VERBS.EDITED_PLUGIN_DOCUMENT), 2000);
        return () => clearTimeout(editTimer.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft]);

    const session = useMemo(() => ({
        id: null,
        caseId: caseData?.id ?? null,
        userId: user?.id ?? null,
        role: user?.role ?? 'guest',
        language: caseData?.config?.case_language ?? 'en',
        examMode: false,
    }), [caseData?.id, caseData?.config?.case_language, user?.id, user?.role]);

    const controls = (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={() => (dirty.current ? setConfirmingDiscard(true) : onClose())}
                className="px-3 py-2 rounded border border-slate-600 text-slate-200 hover:bg-slate-800 text-sm font-medium flex items-center gap-2"
            >
                <X className="w-4 h-4" /> {t('plugins_discard')}
            </button>
            <button
                type="button"
                onClick={() => { clearTimeout(editTimer.current); logAuthoring(VERBS.SAVED_PLUGIN_DOCUMENT); onCommit(draft); }}
                className="px-3 py-2 rounded bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold flex items-center gap-2"
            >
                <Check className="w-4 h-4" /> {t('plugins_done')}
            </button>
        </div>
    );

    return (
        <div className="fixed inset-0 z-50 bg-slate-950">
            <PluginAuthor
                // Keyed by (plugin, case) so switching either seeds a fresh
                // editor rather than showing the previous case's document.
                key={`${pluginId}:${caseData?.id ?? 'new'}`}
                pluginId={pluginId}
                session={session}
                caseConfig={caseData?.config ?? {}}
                eventLogger={EventLogger}
                value={initial}
                onSave={(next) => { dirty.current = true; setDraft(next); }}
                topBarControls={controls}
            />

            {confirmingDiscard && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-6">
                    <div className="max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-5 space-y-4">
                        <p className="text-sm text-neutral-200">{t('plugins_discard_confirm')}</p>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setConfirmingDiscard(false)}
                                className="px-3 py-2 rounded border border-neutral-700 text-neutral-300 text-sm"
                            >
                                {t('btn_cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-3 py-2 rounded bg-red-700 hover:bg-red-600 text-white text-sm font-bold"
                            >
                                {t('plugins_discard')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default PluginAuthorSurface;
