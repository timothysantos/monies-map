import { useCallback, useEffect, useRef, useState } from "react";

import { declineHabit, requestDoneForYou, requestEntryHabits, stopHabit, undoDoneForYou } from "./ask-habits-api";
import { askHabitsCopy } from "./copy/ask-habits-copy";

// Ask's habits for the saved card (docs/flows/ask-flow.md "Hands-off"): one
// request when a saved entry's card opens (Ask applies what the safe set
// allows and says what is left to suggest), and the "Done for you" list for
// the last 30 days. No AI; nothing here is a notification, and a failed
// request is simply no row.
//
// `applyCategory(name)` and `applyShare(groupId, firstPersonBasisPoints)` are
// the panel's own saved-card actions (the existing Entries and Splits
// commands), each returning whether it worked. `onChanged()` refreshes the
// panel's entry data after Ask did or undid something.
export function useAskHabits({ entryId, applyCategory, applyShare, onChanged, onApplied = undefined, onUndone = undefined }) {
  const [suggestion, setSuggestion] = useState(null);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const asked = useRef(new Set());
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const applied = useRef(onApplied);
  applied.current = onApplied;

  const reloadDone = useCallback(async (signal) => {
    const next = await requestDoneForYou({ signal });
    if (!signal?.aborted) {
      setItems(next);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reloadDone(controller.signal);
    return () => controller.abort();
  }, [reloadDone]);

  useEffect(() => {
    if (!entryId || asked.current.has(entryId)) {
      return undefined;
    }
    asked.current.add(entryId);
    const controller = new AbortController();
    void requestEntryHabits(entryId, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || !result) {
        return;
      }
      setSuggestion(result.suggestion);
      if (result.done.length) {
        applied.current?.(result.done);
        void reloadDone();
        changed.current?.();
      }
    });
    return () => controller.abort();
  }, [entryId, reloadDone]);

  const apply = useCallback(async () => {
    if (!suggestion || busy) {
      return;
    }
    setBusy("apply");
    setError("");
    try {
      if (suggestion.category && !(await applyCategory(suggestion.category.categoryName))) {
        setError(askHabitsCopy.suggestion.failed);
        return;
      }
      if (suggestion.split && !(await applyShare(suggestion.split.groupId ?? "split-group-none", suggestion.split.firstPersonBasisPoints))) {
        setError(askHabitsCopy.suggestion.failed);
        return;
      }
      setSuggestion(null);
    } finally {
      setBusy("");
    }
  }, [applyCategory, applyShare, busy, suggestion]);

  const dismiss = useCallback(() => {
    if (!suggestion) {
      return;
    }
    // The cross is a "no": the habits it came from start again from nothing.
    for (const habitId of [suggestion.category?.habitId, suggestion.split?.habitId]) {
      if (habitId) void declineHabit(habitId);
    }
    setSuggestion(null);
    setError("");
  }, [suggestion]);

  const undo = useCallback(async (item) => {
    if (busy) {
      return false;
    }
    setBusy(item.id);
    setError("");
    try {
      const result = await undoDoneForYou(item.id);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setItems((current) => current.map((candidate) => (candidate.id === item.id ? { ...candidate, undone: true } : candidate)));
      onUndone?.(item);
      changed.current?.();
      return true;
    } finally {
      setBusy("");
    }
  }, [busy, onUndone]);

  const stop = useCallback(async (item) => {
    if (busy || !item.habitId) {
      return false;
    }
    setBusy(item.id);
    setError("");
    try {
      const result = await stopHabit(item.habitId);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setItems((current) => current.map((candidate) => (candidate.habitId === item.habitId ? { ...candidate, habitId: "" } : candidate)));
      return true;
    } finally {
      setBusy("");
    }
  }, [busy]);

  return { suggestion, items, busy, error, apply, dismiss, undo, stop };
}
