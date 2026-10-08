import { useState } from "react";

import { nextFoldState } from "./import-inbox-model";

// An open/closed fold that follows `defaultOpen` whenever it changes and
// otherwise keeps the user's toggle (rules in `nextFoldState`).
export function useFollowingFold(defaultOpen, options) {
  const [state, setState] = useState({ defaultOpen, open: defaultOpen });
  const followed = nextFoldState(state, defaultOpen, options);
  if (followed !== state) {
    // Adjusting state while rendering, so the fold never shows one frame of
    // the old position.
    setState(followed);
  }
  const setOpen = (next) => setState((current) => ({
    ...current,
    open: typeof next === "function" ? next(current.open) : next
  }));
  return [followed.open, setOpen];
}
