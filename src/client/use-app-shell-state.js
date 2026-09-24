import { useState, useSyncExternalStore } from "react";

import { createAppShellOwner } from "./app-shell-owner.js";

// React binding for the app shell owner.
export function useAppShellState() {
  const [owner] = useState(createAppShellOwner);
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { appShell: state.shell, appShellError: state.error, appShellOwner: owner };
}
