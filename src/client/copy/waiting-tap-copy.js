// The words on the waiting tap card at the top of Entries and its Ask
// reminder (DOMAIN.md "Waiting Tap"): an Apple Pay payment that reached the
// app without its amount. Plain words: say what happened to the payment,
// then what to do. No amount is ever shown or hinted while money is hidden.

import { addDaysToIsoDate } from "../app-dates";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "today", "yesterday" or "Sun 15 Nov".
export function tapDayWord(date, today) {
  if (date === today) {
    return "today";
  }
  if (today && date === addDaysToIsoDate(today, -1)) {
    return "yesterday";
  }
  const [year, month, day] = String(date).split("-").map(Number);
  if (!year || !month || !day) {
    return "";
  }
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month - 1]}`;
}

export const waitingTapCopy = {
  label: "Payment waiting for its amount",
  // "Periplus, today 14:02, UOB One. The amount didn't come through."
  line: ({ merchant, dayWord, time, accountName }) =>
    `${merchant}, ${[dayWord, time].filter(Boolean).join(" ")}${accountName ? `, ${accountName}` : ""}. The amount didn't come through.`,
  // A bare tap (DOMAIN.md "Bare Tap"): Wallet sent no shop and no amount.
  // "Payment on Citi Rewards, today 6:54 pm. No details came through."
  bareLine: ({ dayWord, time, accountName }) =>
    `Payment${accountName ? ` on ${accountName}` : ""}, ${[dayWord, time].filter(Boolean).join(" ")}. No details came through.`,
  bareName: (accountName) => `the payment${accountName ? ` on ${accountName}` : ""}`,
  shopLabel: (accountName) => `Shop for the payment${accountName ? ` on ${accountName}` : ""}`,
  shopPlaceholder: "Shop",
  needShop: "Type the shop's name.",
  bareRemoved: (accountName) => `Removed the payment${accountName ? ` on ${accountName}` : ""}. Nothing was saved.`,
  amountLabel: (merchant) => `Amount for ${merchant}`,
  amountPlaceholder: "0.00",
  currencyLabel: "Paid in",
  save: "Save",
  saving: "Saving",
  notPayment: "Not a payment",
  removing: "Removing",
  saved: (merchant) => `Saved ${merchant}.`,
  removed: (merchant) => `Removed ${merchant}. Nothing was saved.`,
  needAmount: "Type the amount, like 12.50.",
  saveFailed: "Couldn't save the amount. Try again.",
  removeFailed: "Couldn't remove it. Try again."
};
