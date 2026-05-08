import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys.js";

// Keep server data warm between tab switches without treating quick edits as
// stale forever. Mutation flows will override invalidation explicitly.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry(failureCount, error) {
        if (error?.name === "AbortError") {
          return false;
        }
        return failureCount < 2;
      }
    },
    mutations: {
      retry: 0
    }
  }
});

queryClient.setQueryDefaults(queryKeys.appShell(), {
  staleTime: 5 * 60 * 1000,
  gcTime: 30 * 60 * 1000
});
