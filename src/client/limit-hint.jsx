import "./limit-hint.css";

import { limitsCopy } from "./copy/limits-copy";
import { limitState } from "./input-limits";

// The quiet line under a field that has a cap (input-limits.js): nothing
// until the text reaches 80% of the cap, then "1,640 / 2,000" (or `near`'s
// words), and past the cap `over`'s plain refusal in the error ink. It is
// read out politely as it changes.
export function LimitHint({ size, max, over, near = limitsCopy.counter, className = "" }) {
  const state = limitState(size, max);
  if (!state.near) return null;
  return (
    <small className={["limit-hint", state.over ? "is-over" : "", className].filter(Boolean).join(" ")} aria-live="polite">
      {state.over ? over(max) : near(size, max)}
    </small>
  );
}
