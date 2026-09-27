// Client entry to the household calendar (src/lib/app-calendar.ts), plus
// calendar-day arithmetic.
export { APP_TIME_ZONE, isoDateInAppTimeZone, todayInAppTimeZone } from "../lib/app-calendar";

// Calendar-day arithmetic in UTC so no daylight-saving shift can skip a day.
export function addDaysToIsoDate(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
