import { createRootRoute } from '@tanstack/react-router';
import { AppShell } from '@/components/shell/AppShell';

export const rootRoute = createRootRoute({
  component: AppShell,
});
