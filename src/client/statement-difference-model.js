// Turns a saved statement's difference (StatementDifferenceDto) into the
// line a person reads: matched, matched once next-statement billing is set
// aside, or off by an amount with the entry that explains it.
import { statementDifferenceMessages as copy } from "./copy/en-SG-statement-difference";
import { formatDateOnly, money } from "./formatters";

export function describeStatementDifference({ deltaMinor, difference }) {
  if (!deltaMinor) {
    return { tone: "in", headline: copy.matched, details: [], isTimingOnly: false };
  }

  const { billedNext, notOnStatement, remainingMinor = deltaMinor } = difference ?? {};
  if (billedNext && !notOnStatement && remainingMinor === 0) {
    return {
      tone: "in",
      headline: copy.matchedBilledNext(billedNext.entryCount, money(Math.abs(billedNext.totalMinor))),
      details: [],
      isTimingOnly: true
    };
  }

  const details = [];
  if (billedNext) {
    details.push(copy.partlyBilledNext(money(Math.abs(billedNext.totalMinor))));
  }
  let removableEntry;
  if (notOnStatement) {
    const names = notOnStatement.entries.map(describeEntry);
    if (notOnStatement.oneOf) {
      details.push(copy.notOnStatementOneOf(names));
    } else if (notOnStatement.entryCount === 1) {
      details.push(copy.notOnStatementOne(names[0]));
      removableEntry = { ...notOnStatement.entries[0], label: names[0] };
    } else {
      details.push(copy.notOnStatementGroup(names, notOnStatement.entryCount - names.length));
    }
  }
  if (remainingMinor) {
    details.push(copy.notExplained(money(Math.abs(remainingMinor))));
  }

  return {
    tone: "short",
    headline: copy.offBy(money(Math.abs(deltaMinor))),
    details,
    isTimingOnly: false,
    ...(removableEntry ? { removableEntry } : {})
  };
}

function describeEntry(entry) {
  return copy.entry(entry.description, formatDateOnly(entry.date), money(Math.abs(entry.signedAmountMinor)));
}
