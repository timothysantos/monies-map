import { messages } from "./copy/en-SG";

export function sortRows(rows, sort, monthKey = "") {
  if (!sort) {
    return rows;
  }

  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = getSortValue(left, sort.key, monthKey);
    const rightValue = getSortValue(right, sort.key, monthKey);

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return (leftValue - rightValue) * direction;
    }

    return String(leftValue).localeCompare(String(rightValue)) * direction;
  });
}

function getSortValue(row, key, monthKey) {
  switch (key) {
    case "variance":
      return row.plannedMinor - row.actualMinor;
    case "day":
      return getRowDateValue(row, monthKey);
    case "accountName":
      return row.accountName ?? "";
    case "note":
      return row.note ?? "";
    default:
      return row[key] ?? "";
  }
}

export function getRowDateValue(row, fallbackMonth) {
  if (!row.dayLabel) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(row.dayLabel)) {
    return row.dayLabel;
  }

  if (/^\d+$/.test(row.dayLabel)) {
    return `${fallbackMonth}-${String(Number(row.dayLabel)).padStart(2, "0")}`;
  }

  return "";
}

export function formatRowDateLabel(row, fallbackMonth) {
  const value = getRowDateValue(row, fallbackMonth);
  if (!value) {
    return messages.common.emptyValue;
  }

  const [year, month, day] = value.split("-");
  return new Intl.DateTimeFormat("en-SG", {
    month: "short",
    day: "numeric"
  }).format(new Date(Number(year), Number(month) - 1, Number(day)));
}
