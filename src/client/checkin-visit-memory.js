import { useState } from "react";

import { emptyVisitMemory, normalizeVisitMemory } from "../domain/money-signals/checkin";
import { todayInAppTimeZone } from "./app-dates";

// The money check-in's visit memory: which signals, phrasings, trivia and
// quotes were shown and when, and the numbers last seen. It lives only in
// this browser's localStorage, keyed per page + view (+ group on Splits);
// nothing about visits goes to the server or to AI. Storage can be missing,
// blocked or full, so every access is guarded and the check-in renders
// correctly (as a first visit) without it.
const STORAGE_PREFIX = "monies-map:checkin:v1:";

export function checkInMemoryKey(page, viewId, groupId = "") {
  return [page, viewId || "household", groupId].filter(Boolean).join(":");
}

export function readVisitMemory(memoryKey, storage = getStorage()) {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + memoryKey);
    return raw ? normalizeVisitMemory(JSON.parse(raw)) : emptyVisitMemory();
  } catch {
    return emptyVisitMemory();
  }
}

export function writeVisitMemory(memoryKey, memory, storage = getStorage()) {
  try {
    storage?.setItem(STORAGE_PREFIX + memoryKey, JSON.stringify(memory));
    return true;
  } catch {
    return false;
  }
}

function getStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// One visit's clock, fixed when the page mounts, so the check-in (and its
// rotation) stays stable while the page rerenders.
export function useCheckInClock() {
  const [clock] = useState(() => ({ nowMs: Date.now(), today: todayInAppTimeZone() }));
  return clock;
}
