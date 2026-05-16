// Help & Support drawer (Stage 4 — P1 + P3/P4 surfaces).
//
// One right-side drawer with three tabs:
//   Help       — role-filtered article list, links into the docs site
//   What's new — parsed CHANGELOG.md from /api/help/release-notes (P4)
//   Support    — the redacted diagnostics bundle from /api/help/diagnostics
//                (P3), copyable to attach to a support request
//
// It does NOT introduce a new toast path: the "copied" confirmation is
// emitted through the central NotificationCenter (SOURCES.USER /
// SEVERITY.SUCCESS) per the CLAUDE.md constraint.

import { useCallback, useEffect, useState } from 'react';
import { HelpCircle, X, ExternalLink, Copy } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useNotifications, SOURCES, SEVERITY } from '../notifications';
import { apiGet } from '../services/apiClient.js';
import { articlesForRole, docsUrl } from './helpContent.js';

const TABS = [
  { id: 'help', label: 'Help' },
  { id: 'whatsnew', label: "What's new" },
  { id: 'support', label: 'Support' },
];

export default function HelpCenter({ open, onClose }) {
  const { user } = useAuth();
  const { notify } = useNotifications();
  const [tab, setTab] = useState('help');
  const [releases, setReleases] = useState(null);
  const [diag, setDiag] = useState(null);
  const [error, setError] = useState(null);

  const groups = articlesForRole(user?.role);

  useEffect(() => {
    if (!open) return;
    if (tab === 'whatsnew' && releases === null) {
      apiGet('/api/help/release-notes')
        .then((r) => {
          setReleases(r.releases || []);
          setError(null);
        })
        .catch((e) => setError(e.message || 'Could not load release notes.'));
    }
    if (tab === 'support' && diag === null) {
      apiGet('/api/help/diagnostics')
        .then((d) => {
          setDiag(d);
          setError(null);
        })
        .catch((e) => setError(e.message || 'Could not load diagnostics.'));
    }
  }, [open, tab, releases, diag]);

  // Clearing transient error on tab change happens in the click handler so
  // it never runs synchronously inside the data effect.
  const selectTab = useCallback((id) => {
    setError(null);
    setTab(id);
  }, []);

  // WCAG 2.1.2 — keyboard users must be able to dismiss the dialog without
  // a pointer. Escape closes the drawer while it is open.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const copyDiagnostics = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
      notify({
        source: SOURCES.USER,
        severity: SEVERITY.SUCCESS,
        title: 'Support bundle copied',
        message: 'Paste it into your support request.',
      });
    } catch {
      setError('Clipboard unavailable — select the text and copy manually.');
    }
  }, [diag, notify]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label="Help and support">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="relative w-[min(28rem,100vw)] h-full bg-neutral-900 border-l border-neutral-700 shadow-2xl flex flex-col">
        <header className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <div className="flex items-center gap-2 text-neutral-100">
            <HelpCircle className="w-5 h-5 text-blue-400" />
            <span className="font-semibold">Help &amp; Support</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close help" className="text-neutral-400 hover:text-neutral-200">
            <X className="w-5 h-5" />
          </button>
        </header>

        <nav className="flex border-b border-neutral-800" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`help-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="help-tabpanel"
              onClick={() => selectTab(t.id)}
              className={`flex-1 px-4 py-2 text-sm ${
                tab === t.id
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div
          className="flex-1 overflow-y-auto p-5 text-sm"
          id="help-tabpanel"
          role="tabpanel"
          aria-labelledby={`help-tab-${tab}`}
        >
          {error && (
            <p className="text-red-400 mb-4" role="alert">
              {error}
            </p>
          )}

          {tab === 'help' &&
            groups.map((g) => (
              <section key={g.group} className="mb-6">
                <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
                  {g.group}
                </h3>
                <ul className="space-y-1">
                  {g.articles.map((a) => (
                    <li key={a.id}>
                      <a
                        href={docsUrl(a.path)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-neutral-200 hover:text-blue-400"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-neutral-500" />
                        {a.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

          {tab === 'whatsnew' && (
            <div>
              {releases === null && !error && <p className="text-neutral-400">Loading…</p>}
              {(releases || []).map((r) => (
                <section key={r.version} className="mb-6">
                  <h3 className="text-neutral-100 font-semibold">
                    {r.version}{' '}
                    <span className="text-neutral-500 font-normal">{r.date}</span>
                  </h3>
                  {r.summary && <p className="text-neutral-400 mt-1 mb-2">{r.summary}</p>}
                  {Object.entries(r.sections || {}).map(([name, items]) => (
                    <div key={name} className="mt-2">
                      <div className="text-xs uppercase tracking-wide text-neutral-500">{name}</div>
                      <ul className="list-disc ml-5 text-neutral-300">
                        {items.map((it, i) => (
                          <li key={i}>{it}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}

          {tab === 'support' && (
            <div>
              <p className="text-neutral-400 mb-3">
                This bundle contains no personal data — only version, runtime
                and boolean health flags. Attach it to a support request.
              </p>
              {diag && (
                <>
                  <button
                    type="button"
                    onClick={copyDiagnostics}
                    className="mb-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
                  >
                    <Copy className="w-4 h-4" /> Copy bundle
                  </button>
                  <pre className="bg-black/50 border border-neutral-800 rounded-lg p-3 overflow-x-auto text-xs text-neutral-300">
                    {JSON.stringify(diag, null, 2)}
                  </pre>
                </>
              )}
              {diag === null && !error && <p className="text-neutral-400">Loading…</p>}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
