// Files sent to Monies Map that wait for review (DOMAIN.md "Waiting File").
// Pure helpers for Imports: which listed files are new to this visit, the
// order they join the intake queue in, and the line that says how and when
// each one arrived.

import { importMessages } from "./copy/en-SG-imports";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const APP_TIME_ZONE = "Asia/Singapore";

// The waiting files not yet pulled into this visit's queue, in one order
// whatever order they arrived in: by name, then id. The queue then sorts
// them by what they are (statements first, older months first).
export function selectWaitingFilesToPull(waitingFiles, pulledIds) {
  return (waitingFiles ?? [])
    .filter((file) => file?.id && !pulledIds.has(file.id))
    .sort((left, right) => left.fileName.localeCompare(right.fileName) || left.id.localeCompare(right.id));
}

// "12 Nov" in Singapore time.
function formatArrivalDay(receivedAt) {
  const instant = new Date(receivedAt);
  if (Number.isNaN(instant.getTime())) {
    return "";
  }
  const parts = new Intl.DateTimeFormat("en-SG", { timeZone: APP_TIME_ZONE, day: "numeric", month: "numeric" }).formatToParts(instant);
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = MONTHS[Number(parts.find((part) => part.type === "month")?.value ?? 0) - 1] ?? "";
  return day && month ? `${day} ${month}` : "";
}

// "Sent from your phone, 12 Nov".
export function describeWaitingFileArrival(waitingFile) {
  if (!waitingFile) {
    return "";
  }
  return importMessages.waitingFileArrived({
    arrivedVia: waitingFile.arrivedVia,
    day: formatArrivalDay(waitingFile.receivedAt)
  });
}
