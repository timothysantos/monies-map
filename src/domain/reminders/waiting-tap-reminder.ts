// An Apple Pay tap waiting for its amount (DOMAIN.md "Waiting Tap"): one
// reminder per tap until it is finished in Entries, removed, or cleared by an
// import. It never expires by itself, so a payment is never lost.
import type { WaitingTapReminderDto } from "../../types/dto";
import type { ReminderInputs } from "./facts";

export function waitingTapReminders(input: Pick<ReminderInputs, "waitingTaps">): WaitingTapReminderDto[] {
  return (input.waitingTaps ?? []).map((tap) => ({
    key: `waiting_tap:${tap.id}`,
    kind: "waiting_tap",
    tapId: tap.id,
    merchant: tap.merchant,
    date: tap.date,
    time: tap.time,
    accountName: tap.accountName
  }));
}
