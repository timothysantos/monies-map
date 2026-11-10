// Tax relief room (DOMAIN.md "Tax Relief", owner decision 2026-11-10): from
// 1 to 31 December, while a relief the person has already started (SRS, CPF
// cash top-up for themselves or for family) is below its yearly limit, one
// To do names the room left. Charity gifts have no limit, so they never
// appear. A relief nobody started is never suggested, and the wording states
// the room, never advice and never the tax it would save. In a person's view
// only that person's reliefs count.
import type { TaxReliefReminderDto } from "../../types/dto";
import { taxReliefRoomLeft } from "../tax-reliefs";
import type { ReminderInputs } from "./facts";

export function taxReliefReminders(input: Pick<ReminderInputs, "today" | "viewId" | "taxRelief">): TaxReliefReminderDto[] {
  const year = input.taxRelief;
  if (!year) {
    return [];
  }
  const inView = { ...year, people: input.viewId === "household" ? year.people : year.people.filter((person) => person.personId === input.viewId) };
  const items = taxReliefRoomLeft(inView, input.today).map((item) => ({ personId: item.personId, personName: item.name, relief: item.key, roomMinor: item.roomMinor }));
  if (!items.length) {
    return [];
  }
  return [{ key: `tax_relief:${year.year}`, kind: "tax_relief", year: year.year, daysLeft: year.daysLeft, items }];
}
