// Ambient types for `npm run typecheck:client` (tsconfig.client.json). These
// describe browser features and test hooks the client already relies on.
import "react";

declare module "react" {
  // Inline styles pass theme values through CSS custom properties.
  interface CSSProperties {
    [customProperty: `--${string}`]: string | number | undefined;
  }
}

declare global {
  interface Window {
    // Route work snapshot exposed outside production for e2e assertions.
    __MONIES_MAP_ROUTE_WORK__?: unknown;
    // Test override for route warmup: "off" | "intent-only".
    __MONIES_MAP_WARMUP_MODE__?: string;
  }

  // Network Information API (Chromium only; absent on iPhone Safari).
  interface Navigator {
    connection?: EventTarget & {
      effectiveType?: string;
      saveData?: boolean;
    };
  }
}
