import { isoDateInAppTimeZone } from "./app-calendar";

// The household's current month, read at call time.
export function getCurrentMonthKey(date = new Date()): string {
  return isoDateInAppTimeZone(date).slice(0, 7);
}
