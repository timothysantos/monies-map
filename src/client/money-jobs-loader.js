import { useEffect, useState } from "react";

// The opened money jobs (money-jobs-detail.js: labels, statuses and the
// rows) are not part of the first screen: the lead shows the bar and the
// folded "3 of 4 money jobs done" line at once, and this loads on the first
// open (or at once where the jobs start open, on a wider screen). It imports no React, so the chunk it
// loads in leans only on the first screen's own chunks, the same way Money
// insights load (money-insights-loader.js). The promise is shared, so it
// downloads once; a failed load is forgotten and the next try loads again.
let detail = null;
let pending = null;

export function loadMoneyJobsDetail() {
  pending ??= import("./money-jobs-detail").then(
    (module) => {
      detail = module;
      return module;
    },
    (error) => {
      pending = null;
      throw error;
    }
  );
  return pending;
}

// The loaded module once `wanted` has been true, or null while it is on its way.
export function useMoneyJobsDetail(wanted) {
  const [module, setModule] = useState(detail);
  useEffect(() => {
    if (module || !wanted) {
      return undefined;
    }
    let active = true;
    loadMoneyJobsDetail()
      .then((loaded) => {
        if (active) setModule(loaded);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [module, wanted]);
  return module;
}
