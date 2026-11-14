import { createRoute, Navigate, Outlet, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { analyzeLandingFor } from '@/lib/analyzeTabs';
import { useBridge } from '@/lib/hostBridge';
import { useRecordScope } from '@/lib/recordScope';
import { recordKindsOf } from 'oyon';
import { AffectView } from './analyze/affect';
import { EngagementView } from './analyze/engagement';
import { GazeView } from './analyze/gaze';
import { PositionView } from './analyze/sensing';
import { HeartRateView } from './analyze/heartRate';
import { LogsView } from './analyze/logs';
import { PatternsView } from './analyze/patterns';
import { PatternsNextView } from './analyze/patternsNext';
import { DynamicsNextView } from './analyze/dynamicsNext';
import { SequenceView } from './analyze/sequence';
import { TypingView } from './analyze/typing';
import { WritingView } from './analyze/writing';
import { VoiceView } from './analyze/voice';
import { ComparisonView } from './analyze/comparison';

/*
 * Analyze — parent route. Each domain view lives in its own file under
 * src/routes/analyze/, so this is now purely a route container.
 *
 * It used to render a PageHeader block plus a row of nine domain tabs. Both
 * are gone: the domains are reachable from the single top bar's Analyze menu,
 * standalone and embedded alike, so the layout renders only the active view.
 */
export const analyzeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analyze',
  component: Outlet,
});

/*
 * Land on the leading domain. With no host feed that is Affect — the first
 * entry in analyzeSubTabs. Over a host feed it is the leading tab the feed can
 * fill (Typing for a host with no camera), never an empty Affect page. A
 * component, not a `beforeLoad` redirect: the feed lives in the element's own
 * bridge store, which only a hook can reach.
 */
function AnalyzeIndex() {
  const fed = useBridge((s) => s.hostRecords);
  // A person or group embed draws only what the host feeds: until the feed
  // arrives there is nothing to decide a landing page from, so wait for it.
  const { needsFeed } = useRecordScope();
  if (fed == null && needsFeed) return null;
  return <Navigate to={analyzeLandingFor(fed ? recordKindsOf(fed) : null) as never} replace />;
}

export const analyzeIndexRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/',
  component: AnalyzeIndex,
});

export const analyzeAffectRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/affect',
  component: AffectView,
});
export const analyzeEngagementRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/engagement',
  component: EngagementView,
});
export const analyzeAttentionExperimentalRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/attention-experimental',
  beforeLoad: () => {
    // Compatibility for saved links: attention and engagement now share one
    // evidence screen instead of competing destinations.
    throw redirect({ to: '/analyze/engagement' });
  },
});
export const analyzeGazeRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/gaze',
  component: GazeView,
});
// Route id kept as '/sensing' (stable deep-link) — labelled "Position".
export const analyzeSensingRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/sensing',
  component: PositionView,
});
export const analyzeHeartRateRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/heart-rate',
  component: HeartRateView,
});
export const analyzeMonitorRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/monitor',
  beforeLoad: () => {
    // Compatibility for saved links: the monitor now leads the Gaze page.
    throw redirect({ to: '/analyze/gaze' });
  },
});
export const analyzeLogsRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/logs',
  component: LogsView,
});
export const analyzePatternsRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/patterns',
  component: PatternsView,
});
export const analyzePatternsNextRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/patterns-next',
  component: PatternsNextView,
});
// The Dynamics tab (/analyze/sequence, the URL every link uses) is the ladyna
// page; the previous one stays at /analyze/dynamics-old until it is retired.
export const analyzeDynamicsOldRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/dynamics-old',
  component: SequenceView,
});
export const analyzeSequenceRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/sequence',
  component: DynamicsNextView,
});
export const analyzeTypingRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/typing',
  component: TypingView,
});
export const analyzeWritingRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/writing',
  component: WritingView,
});
export const analyzeVoiceRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/voice',
  component: VoiceView,
});
export const analyzeComparisonRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/comparison',
  component: ComparisonView,
  validateSearch: (search: Record<string, unknown>): { ids?: string } => {
    const ids = typeof search.ids === 'string' ? search.ids : undefined;
    return { ids };
  },
});
