import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { reportClientCrash } from "./client-crash-report";
import { MoneyPrivacyProvider } from "./money-privacy";
import { installPreloadRecovery } from "./preload-recovery";
import { queryClient } from "./query-client";
import { ScreenErrorBoundary } from "./screen-error-boundary";

// A lazy sheet whose stylesheet fails to download opens unstyled instead of
// crashing the app (preload-recovery.js).
installPreloadRecovery(window, reportClientCrash);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MoneyPrivacyProvider>
        <BrowserRouter>
          <ScreenErrorBoundary level="app">
            <App />
          </ScreenErrorBoundary>
        </BrowserRouter>
      </MoneyPrivacyProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
