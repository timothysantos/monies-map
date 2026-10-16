import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

import { planStudioAddCopy } from "./copy/plan-studio-add-copy";
import { useIsMobileLayout } from "./use-viewport";

function IslandAction({ children }) {
  const mobile = useIsMobileLayout();
  const [target, setTarget] = useState(null);
  // The shell's host may be committed alongside this route on a warm visit.
  useLayoutEffect(() => {
    setTarget(mobile ? document.getElementById("mobile-plan-actions") : null);
  }, [mobile]);
  return target ? createPortal(children, target) : null;
}

export function PlanIslandActions({ mode, onModeChange, disabled = false }) {
  const next = mode === "studio" ? "tables" : "studio";
  return (
    <IslandAction>
      <button type="button" className="mobile-context-line-action" data-plan-island-mode disabled={disabled} onClick={() => onModeChange(next)}>
        {planStudioAddCopy.modes[next]}
      </button>
    </IslandAction>
  );
}

export function PlanIslandUndo({ label, disabled, onUndo }) {
  const undo = (event) => {
    // The last Undo removes this button; keep focus in the island.
    event.currentTarget.parentElement.querySelector("[data-plan-island-mode]")?.focus({ preventScroll: true });
    onUndo();
  };
  return (
    <IslandAction>
      <button type="button" className="mobile-context-line-action" data-plan-island-undo disabled={disabled} onClick={undo}>
        {label}
      </button>
    </IslandAction>
  );
}
