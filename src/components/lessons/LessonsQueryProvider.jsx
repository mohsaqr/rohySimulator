// React Query provider for the vendored lesson module. rohy doesn't use
// react-query elsewhere, so the provider wraps just the lesson surfaces.
// Module-level singleton client.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export function LessonsQueryProvider({ children }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
