import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { MoneyPrivacyProvider } from "./money-privacy";
import { queryClient } from "./query-client";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MoneyPrivacyProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MoneyPrivacyProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
