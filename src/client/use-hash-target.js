import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// The place an openable figure's menu opened (figure-menu.js, design.md
// "Openable figures"): "#month-plan", "#month-plan-income" on the Month page
// and "#splits-activity" on Splits. Once the page has drawn it (`ready`),
// it is scrolled into view, once per navigation.
export function useHashTarget(ready) {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!ready || !hash) {
      return;
    }
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash, key, ready]);
}
