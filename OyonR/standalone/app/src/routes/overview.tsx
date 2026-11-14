import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './root';
import { RecordsOverview } from '@/components/overview/RecordsOverview';

/*
 * Overview — the front page of an embedded dashboard: headline figures, the
 * people and the sessions in the embed's scope, across every record kind
 * (components/overview/RecordsOverview). The standalone instrument shows the
 * same component on its Sessions page, with export and compare.
 */
export const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/overview',
  component: RecordsOverview,
});
