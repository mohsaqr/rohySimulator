import {
  createRoute,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from '@tanstack/react-router';
import { rootRoute } from './root';
import { PageHeader } from '@/components/shell/PageHeader';
import { cn } from '@/lib/cn';
import { analyzeSubTabs } from '@/lib/analyzeTabs';
import { useBridge } from '@/lib/hostBridge';
import { AffectView } from './analyze/affect';
import { EngagementView } from './analyze/engagement';
import { GazeView } from './analyze/gaze';
import { SequenceView } from './analyze/sequence';
import { ComparisonView } from './analyze/comparison';

/*
 * Analyze — parent route with sub-tabs for Affect, Engagement, Gaze,
 * Sequence, Comparison. Each sub-view is in its own file under
 * src/routes/analyze/ so this stays a thin layout.
 *
 * Embedded (<oyon-app chrome="none" | "capture-analytics">) the navigation and
 * domain tabs live in the unified EmbedHeader instead, so this layout renders
 * ONLY the active domain view — no PageHeader block, no second subtab row. The
 * standalone app renders both, unchanged.
 */
function AnalyzeLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const embedded = useBridge((s) => s.embedded);

  if (embedded) return <Outlet />;

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Step 4"
        title="Analyze"
        description="Retrospective research views. Pick a domain below; each follows the same Summary → Trend → Structure → Drill-down rhythm."
      />
      <div
        className="mb-5 flex gap-1 border-b border-line"
        role="tablist"
        aria-label="Analyze domains"
      >
        {analyzeSubTabs.map((tab) => {
          const active = pathname === tab.to;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              role="tab"
              aria-selected={active}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-status-info text-status-info'
                  : 'border-transparent text-ink-2 hover:text-ink-0',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <Outlet />
    </>
  );
}

export const analyzeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analyze',
  component: AnalyzeLayout,
});

export const analyzeIndexRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/',
  beforeLoad: () => {
    // Land on the first/default domain — Emotion dynamics (route id /sequence).
    throw redirect({ to: '/analyze/sequence' as never });
  },
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
export const analyzeGazeRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/gaze',
  component: GazeView,
});
export const analyzeSequenceRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/sequence',
  component: SequenceView,
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
