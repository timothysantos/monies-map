import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// The place an openable figure's menu opened (figure-menu.js, design.md
// "Openable figures"): "#month-plan", "#month-plan-income" on the Month page
// and "#splits-activity" on Splits. Once the page is `ready` the place is
// scrolled into view, once per navigation; a part that draws a moment later
// (the plan tables follow the lead) is waited for, up to three seconds.
export function useHashTarget(ready) {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!ready || !hash) {
      return undefined;
    }
    let tries = 0;
    const timer = window.setInterval(() => {
      const target = document.getElementById(hash.slice(1));
      tries += 1;
      if (target || tries > 30) {
        window.clearInterval(timer);
        target?.scrollIntoView({ block: "start" });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [hash, key, ready]);
}
