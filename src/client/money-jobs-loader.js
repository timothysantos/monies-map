import { useEffect, useState } from "react";

// The words of the opened money jobs and of the bar parts' menu
// (money-jobs-words.js: labels, statuses, questions and the Entries filter)
// are not part of the first screen: the lead shows the bar and the folded
// "3 of 4 money jobs done" line at once, and the words load on the first
// open, tap, hover or focus that needs them (or at once where the jobs start
// open, on a wider screen). They are plain functions with no React, so the
// chunk they load in leans only on the first screen's own chunks, the same
// way Money insights load (money-insights-loader.js). The promise is shared,
// so they download once; a failed load is forgotten and the next try loads
// again.
let words = null;
let pending = null;

export function loadMoneyJobsWords() {
  pending ??= import("./money-jobs-words").then(
    (module) => {
      words = module;
      return module;
    },
    (error) => {
      pending = null;
      throw error;
    }
  );
  return pending;
}

// The loaded words once `wanted` has been true, or null while they are on their way.
export function useMoneyJobsWords(wanted) {
  const [module, setModule] = useState(words);
  useEffect(() => {
    if (module || !wanted) {
      return undefined;
    }
    let active = true;
    loadMoneyJobsWords()
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
