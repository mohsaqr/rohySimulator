import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { rootRoute } from './routes/root';
import { indexRoute } from './routes/index';
import { liveRoute } from './routes/live';
import {
  analyzeRoute,
  analyzeIndexRoute,
  analyzeAffectRoute,
  analyzeEngagementRoute,
  analyzeGazeRoute,
  analyzeSequenceRoute,
  analyzeComparisonRoute,
} from './routes/analyze';
import { sessionsRoute } from './routes/sessions';
import { settingsRoute } from './routes/settings';
import { helpRoute } from './routes/help';

const routeTree = rootRoute.addChildren([
  indexRoute,
  liveRoute,
  analyzeRoute.addChildren([
    analyzeIndexRoute,
    analyzeAffectRoute,
    analyzeEngagementRoute,
    analyzeGazeRoute,
    analyzeSequenceRoute,
    analyzeComparisonRoute,
  ]),
  sessionsRoute,
  settingsRoute,
  helpRoute,
]);

/*
 * Factory so the same route tree can serve two delivery modes:
 *   - standalone (main.tsx): default browser history — unchanged behavior.
 *   - embedded (<oyon-app>, element.tsx): a memory history, so the embedded
 *     app never hijacks the host page's URL.
 *
 * Deliberately NO module-level `makeRouter()` call here: constructing a
 * router without a history arg eagerly runs createBrowserHistory(), which
 * synchronously calls history.replaceState on the page, monkey-patches
 * window.history.pushState/replaceState, and installs popstate/beforeunload
 * listeners. Inside the <oyon-app> element bundle that would mutate the
 * HOST page at import time even if the element is never mounted. Each entry
 * point constructs its own router (main.tsx: browser history; element.tsx:
 * memory history).
 */
export function makeRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    ...(history ? { history } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
