// The household's calendar. Entry, month and statement dates are plain
// YYYY-MM-DD calendar dates, never instants, so only "what day is it now" and
// timestamp display need a time zone. toISOString() gives the UTC day, which
// is yesterday in Singapore between midnight and 8 am.
export const APP_TIME_ZONE = "Asia/Singapore";

const calendarDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function isoDateInAppTimeZone(instant) {
  if (Number.isNaN(instant.getTime())) {
    return "";
  }
  const parts = Object.fromEntries(calendarDateFormatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function todayInAppTimeZone() {
  return isoDateInAppTimeZone(new Date());
}

// Calendar-day arithmetic in UTC so no daylight-saving shift can skip a day.
export function addDaysToIsoDate(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
