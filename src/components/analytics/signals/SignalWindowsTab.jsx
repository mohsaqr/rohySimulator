// Fetches stored Oyon signal windows for ONE modality under the dashboard's
// filters, and renders the Text or Voice view over them.
//
// Self-contained on purpose. The emotion tabs share one emotion-records fetch
// threaded through TnaDashboardV2; these read a different table
// (oyon_signal_windows via GET /addons/oyon/signal-windows), so they own their
// fetch rather than adding more state to that file.
//
// Filters mirror the emotion-records fetch exactly (case, learner, from, to),
// with the same page size and 1000-window cap, so every signal tab describes the
// same selection. Access is enforced server-side (assertOyonReadAccess); this
// component only asks.

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../services/apiClient';
import OyonTextView from './OyonTextView.jsx';
import OyonVoiceView from './OyonVoiceView.jsx';
import { signalWindowsQuery } from './signalFormat.js';

const PAGE = 200;
const CAP = 1000;

const VIEWS = {
    typing: OyonTextView,
    voice: OyonVoiceView,
};

export default function SignalWindowsTab({ modality, caseId, userId, startDate, endDate }) {
    // The selection this component is showing. A result is stamped with the key
    // it was fetched for, so "loading" is derived — result.key !== key — rather
    // than set synchronously inside the effect (react-hooks/set-state-in-effect).
    const key = JSON.stringify([modality, caseId, userId, startDate, endDate]);
    const [result, setResult] = useState({ key: null, windows: null, truncated: false, error: null });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const all = [];
                let offset = 0;
                let total = Infinity;
                while (offset < total && all.length < CAP) {
                    const q = signalWindowsQuery({ modality, caseId, userId, startDate, endDate, limit: PAGE, offset });
                    const d = await apiFetch(`/addons/oyon/signal-windows?${q}`);
                    const rows = d?.windows || [];
                    all.push(...rows);
                    total = Number.isFinite(d?.total) ? d.total : all.length;
                    if (rows.length < PAGE) break;
                    offset += PAGE;
                }
                if (!cancelled) {
                    setResult({ key, windows: all, truncated: all.length >= CAP && total > all.length, error: null });
                }
            } catch (err) {
                if (!cancelled) setResult({ key, windows: null, truncated: false, error: err?.message || String(err) });
            }
        })();
        return () => { cancelled = true; };
    }, [key, modality, caseId, userId, startDate, endDate]);

    const View = VIEWS[modality];
    if (!View) return null;

    const current = result.key === key;
    const noun = modality === 'voice' ? 'voice turns' : 'typing episodes';

    if (current && result.error) {
        return (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {`Could not load ${noun}: ${result.error}`}
            </div>
        );
    }

    if (!current) {
        return (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
                {`Loading ${noun}…`}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {result.truncated && (
                <p className="text-right text-xs text-gray-500">
                    {`Capped at the most recent ${CAP} windows — narrow the filters to include older ones.`}
                </p>
            )}
            <View windows={result.windows} loading={false} />
        </div>
    );
}
