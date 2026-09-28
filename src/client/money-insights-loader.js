import { useEffect, useState } from "react";

// Summary's Money insights (its signals and every copy pool they word
// themselves with: phrasings, think lines, Just for fun lines and calm
// lines) are not part of the first screen. They load with one dynamic
// import that starts with the Summary route's own (route-modules.js), and
// App.jsx loads the active route's code beside its data, so the insights
// normally render complete the first time they paint; until they arrive
// the insights show their frame only, and the route never waits for them.
// The promise is shared, so the module downloads once; a failed load is
// forgotten, and the next mount tries again.
let summaryInsights = null;
let pending = null;

export function loadSummaryInsights() {
  pending ??= import("../domain/money-signals/summary-signals").then(
    (module) => {
      summaryInsights = module;
      return module;
    },
    (error) => {
      pending = null;
      throw error;
    }
  );
  return pending;
}

// The loaded module, or null while it is still on its way.
export function useSummaryInsights() {
  const [module, setModule] = useState(summaryInsights);
  useEffect(() => {
    if (module) {
      return undefined;
    }
    let active = true;
    loadSummaryInsights()
      .then((loaded) => {
        if (active) {
          setModule(loaded);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [module]);
  return module;
}
