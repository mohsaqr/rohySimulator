import type { ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { EmptyState } from '@/components/ui/EmptyState';
import { useRecordScope } from '@/lib/recordScope';

/*
 * ScopeGate — a person or group scope draws host-fed records only. With no
 * feed there is nothing it may draw, so every Analyze view is replaced by one
 * statement of that fact. It never falls back to this browser's own storage,
 * which may hold other people's sessions.
 */
export function ScopeGate({ children }: { children: ReactNode }) {
  const { needsFeed, scope } = useRecordScope();
  const onAnalyze = useRouterState({
    select: (s) => s.location.pathname.startsWith('/analyze') || s.location.pathname === '/overview',
  });
  if (!needsFeed || !onAnalyze) return <>{children}</>;
  return (
    <EmptyState
      title={scope === 'person' ? 'No records for this person yet' : `No ${scope} records yet`}
      description={
        'This view draws only the records the host application supplies through setRecords(). ' +
        'None have been supplied, and it does not read this browser’s own storage.'
      }
    />
  );
}
