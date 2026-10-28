import { composeCheckIn } from "../domain/money-signals/checkin";
import { readVisitMemory } from "./checkin-visit-memory";

// The check-in's headline alone, composed exactly as the insights compose
// it (the same signals, visit memory, rotation and calm lines) but without
// recording a visit: the Ask page's "since you last looked" card shows it
// and leaves the visit to the page that owns the insights.
//
// `coveredKeys` are signals a reminder card on the same screen already says
// (a card bill shown above): they are left out, and forgotten from this
// read of the memory too, so the headline is the next one, never a claim that
// the covered thing was "sorted".
export function composeCheckInHeadline(checkIn) {
  const { memoryKey, contextKey, signals, period, triviaRotation, calmLines, clock, ready = true, coveredKeys = [] } = checkIn;
  const covered = new Set(coveredKeys);
  const stored = readVisitMemory(memoryKey);
  const memory = covered.size
    ? { ...stored, quickFixes: Object.fromEntries(Object.entries(stored.quickFixes ?? {}).filter(([key]) => !covered.has(key))) }
    : stored;
  return composeCheckIn({
    signals: covered.size ? signals.filter((signal) => !covered.has(signal.key)) : signals,
    memory,
    nowMs: clock.nowMs,
    today: clock.today,
    seed: `${memoryKey}|${contextKey}`,
    contextKey,
    period,
    triviaRotation,
    calmLines,
    ready
  }).headline;
}
