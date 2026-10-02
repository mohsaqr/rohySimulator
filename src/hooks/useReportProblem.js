// Report a problem — the user-menu rows "Report a problem…" and "My reports" (owner's design, 2026-10-02).
//
// The dialog, My reports and the error capture are Prova's widget (src/vendor/prova-report.js, vendored).
// Every request goes to THIS server (/api/report, /api/reports/mine, routes/report-routes.js) through
// apiFetch, so the cookie/bearer auth and the CSRF header travel as on every other call; the server adds
// the signed-in username and relays to Prova. The page never talks to Prova.
//
// Recent errors: console errors, uncaught errors and failed requests (method, path, status — never a query
// string), captured from the moment this module loads.
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
 * @returns {{available: boolean, news: number, open: () => void, openMine: () => void, refresh: () => void}}
 */
export function useReportProblem(user, page, version = '') {
    const username = user?.username || null;
    const [state, setState] = useState({ available: false, news: 0 });
    const reporter = useMemo(() => (username ? createReporter({
        reportUrl: '/report', mineUrl: '/reports/mine', fetch: viaApiClient,
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
        open: () => reporter?.open(),
        openMine: () => reporter?.openMine(),
        refresh: () => reporter?.refresh(),
    };
}
