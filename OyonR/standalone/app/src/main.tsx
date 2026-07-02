import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeRouter } from '@/router';
import '@/styles/tokens.css';
import '@/styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // IndexedDB reads are cheap; refetch on remount during dev is helpful.
      staleTime: 1_000,
      refetchOnWindowFocus: false,
    },
  },
});

// Standalone delivery mode: browser history (default). The element entry
// builds its own memory-history router — see router.ts for why neither
// router is constructed at module level.
const router = makeRouter();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
