import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';

// Landing — until we ship a real "home" page, send researchers to Live where
// they'll spend most of their time.
export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/live' });
  },
});
