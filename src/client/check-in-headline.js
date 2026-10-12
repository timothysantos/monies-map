import { composeCheckIn } from "../domain/money-signals/checkin";
import { readVisitMemory } from "./checkin-visit-memory";

// The check-in's headline alone, composed exactly as the insights compose
// it (the same signals, visit memory, rotation and calm lines) but without
// recording a visit: the Ask page's "since you last looked" card shows it
// and leaves the visit to the page that owns the insights.
export function composeCheckInHeadline(checkIn) {
  const { memoryKey, contextKey, signals, period, triviaRotation, calmLines, clock, ready = true } = checkIn;
  return composeCheckIn({
    signals,
    memory: readVisitMemory(memoryKey),
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
