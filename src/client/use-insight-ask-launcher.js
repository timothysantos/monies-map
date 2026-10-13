import { useEffect, useRef } from "react";

import { buildAskLocation } from "./app-routing";
import { openAskDock } from "./ask-dock";
import { ASK_INSIGHT_EVENT } from "./insight-ask-event";
import { isMobileLayout } from "./use-viewport";

// The chat: an insight question is asked there, never in a new entry card.
const CHAT_INTENT = { mode: "chat", from: "", savedEntryId: "", splitGroupId: "" };

/**
 * "Ask about this" on a Money insights line (insight-ask-event.js): the
 * shell opens Ask with the insight and the view, scope and month the page
 * was showing. On a phone the Ask page, as a new history entry with the
 * insight in its state (Ask asks it once, then drops it); on a wider screen
 * the Ask panel beside the page, which stays. The shell does this so the
 * router and the dock's launcher stay out of the insights' code.
 * @param {{ navigate: import("react-router-dom").NavigateFunction, searchParams: URLSearchParams }} input
 */
export function useInsightAskLauncher({ navigate, searchParams }) {
  const latest = useRef({ navigate, searchParams });
  latest.current = { navigate, searchParams };
  useEffect(() => {
    const onAsk = (event) => {
      const insight = /** @type {CustomEvent} */ (event).detail?.insight;
      if (!insight || typeof insight !== "object") {
        return;
      }
      const { navigate: go, searchParams: params } = latest.current;
      const handoff = {
        ...insight,
        context: {
          viewId: params.get("view") ?? "household",
          scope: params.get("scope") ?? "direct_plus_shared",
          month: params.get("month") ?? ""
        }
      };
      if (isMobileLayout()) {
        go(buildAskLocation(params), { state: { askInsight: handoff } });
      } else {
        openAskDock({ intent: CHAT_INTENT, insight: handoff });
      }
    };
    window.addEventListener(ASK_INSIGHT_EVENT, onAsk);
    return () => window.removeEventListener(ASK_INSIGHT_EVENT, onAsk);
  }, []);
}
