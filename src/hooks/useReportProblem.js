// Report a problem — the user-menu rows "Report a problem…", "Request a feature…" and "My reports" (owner's
// design, 2026-10-02; feature requests and several screenshots with widget 1.3.0, 2026-10-13; each report's
// conversation with the team — "Write to the team", "A question for you" — with widget 1.4.0, 2026-10-13).
//
// The dialog, My reports and the error capture are Prova's widget (src/vendor/prova-report.js, vendored).
// Every request goes to THIS server (/api/report, /api/reports/mine, /api/reports/:id/messages,
// routes/report-routes.js) through apiFetch, so the cookie/bearer auth and the CSRF header travel as on every
// other call; the server adds the signed-in username and relays to Prova. The page never talks to Prova.
//
// Recent errors: console errors, uncaught errors and failed requests (method, path, status — never a query
// string), captured from the moment this module loads. A feature request sends none of them (the widget's rule).
//
// `subjectsUrl: null`: Rohy does not mount /api/report/subjects (a report is always about Rohy), so the dialog
// asks for no subject list instead of requesting a route that does not exist.
import { useEffect, useMemo, useState } from 'react';
import { createErrorRing, createReporter } from '../vendor/prova-report.js';
import { apiFetch } from '../services/apiClient.js';

const ring = typeof window !== 'undefined' ? createErrorRing().install(window) : null;

// The widget speaks fetch; apiFetch adds the auth and CSRF headers and hands the raw response back.
const viaApiClient = (url, init = {}) => apiFetch(url, { method: init.method, headers: init.headers, body: init.body, parseAs: 'response' });

/**
 * @param {{username?: string}|null} user  the signed-in user (null when signed out)
 * @param {() => string} page              where the person is, in words (a room, a screen) — never case content
 * @param {string} version                 Rohy's version, shown under "Sent with it"
 * @returns {{available: boolean, news: number, open: () => void, openFeature: () => void, openMine: () => void,
 *            refresh: () => void}}  `open` starts a problem report, `openFeature` a feature request
 */
export function useReportProblem(user, page, version = '') {
    const username = user?.username || null;
    const [state, setState] = useState({ available: false, news: 0 });
    const reporter = useMemo(() => (username ? createReporter({
        reportUrl: '/report', mineUrl: '/reports/mine', messagesUrl: '/reports/{id}/messages', subjectsUrl: null, fetch: viaApiClient,
        user: username, app: { name: 'Rohy', version, host: window.location.host },
        team: 'the Rohy developers', page, errors: () => ring?.list() ?? [],
    }) : null), [username, version]); // eslint-disable-line react-hooks/exhaustive-deps -- `page` is read when a report is made

    useEffect(() => {
        if (!reporter) return undefined;
        let live = true;
        const off = reporter.onChange(({ news }) => { if (live) setState((s) => ({ ...s, news })); });
        reporter.refresh().then((r) => {
            if (live) setState({ available: Boolean(r.ok) && r.code !== 'report_not_configured', news: r.news });
        });
        return () => { live = false; off(); reporter.destroy(); };
    }, [reporter]);

    // Signed out: nothing to offer, whatever the last reporter said.
    return {
        available: Boolean(reporter) && state.available,
        news: reporter ? state.news : 0,
        // The kind is always named: the widget otherwise reopens with the kind the last dialog was switched to.
        open: () => reporter?.open({ kind: 'problem' }),
        openFeature: () => reporter?.open({ kind: 'feature' }),
        openMine: () => reporter?.openMine(),
        refresh: () => reporter?.refresh(),
    };
}
