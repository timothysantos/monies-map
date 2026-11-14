// What the Month page's wrap-up card shows (design.md "Month wrap-up";
// DOMAIN.md "Month Wrap-up"), as data, so it is tested without a page:
// month-wrap-up-section.jsx draws it. The checklist and its rules are the
// domain's (month-wrap-up.ts); this only turns each check into a row's
// words, figures and one action.
//
// A figure carries what its openable span needs (design.md "Openable
// figures"): `fig` (spent, splits or plan), its amount and, for `spent`,
// the exact entry ids, so View entries lists them and its total is the
// figure (money-figures.ts monthWrapUpFigureMinor and changedFigureMinor).
// With money hidden no figure, no tone and no words that say who owes whom.
import { buildMonthWrapUpChecks } from "../domain/month-wrap-up";
import { signTone, spendTone } from "../domain/money-tone";
import { monthWrapUpCopy as copy } from "./copy/month-wrap-up-copy";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const longMonthName = (month) => MONTHS[Number(String(month).slice(5, 7)) - 1] ?? "";

function changedBlock(changed, hidden) {
  if (!changed?.rows.length) {
    return null;
  }
  // Hidden money lists names only, A to Z, so even the order says nothing.
  const rows = hidden ? [...changed.rows].sort((left, right) => left.category.localeCompare(right.category)) : changed.rows;
  return {
    label: copy.changed.label,
    against: copy.changed.against(longMonthName(changed.baseMonth)),
    seeAll: copy.changed.seeAll,
    rows: rows.map((row) => ({
      key: row.category,
      name: row.category,
      move: hidden ? "" : copy.changed[row.direction],
      diffMinor: hidden ? null : Math.abs(row.diffMinor),
      figure: hidden || !row.ids.length ? null : { fig: "spent", amountMinor: row.amountMinor, ids: row.ids, name: row.category }
    }))
  };
}

function spentFigure(part, name, hidden) {
  return hidden || !part.ids.length ? null : { fig: "spent", amountMinor: part.amountMinor, ids: part.ids, name };
}

/**
 * The card as data: null when there is no answer (nothing to wrap up, or
 * the month has no entries); a single line once every check is done.
 * @param {{ answer: any, planSections: any[], monthNote: string, hidden: boolean }} input
 */
export function buildMonthWrapUpView({ answer, planSections, monthNote, hidden }) {
  const wrapUp = answer?.wrapUp;
  if (!wrapUp) {
    return null;
  }
  const monthName = longMonthName(wrapUp.month);
  const checks = buildMonthWrapUpChecks({ wrapUp, planSections: planSections ?? [], monthNote });
  const total = checks.checks.length;
  if (checks.wrappedUp) {
    return { month: wrapUp.month, wrappedUp: true, line: copy.wrappedUp(monthName), done: total, total, changed: null, rows: [] };
  }
  const rows = checks.checks.map((check) => {
    const base = { id: check.id, done: check.done, value: "", figure: null, lines: [], action: null };
    switch (check.id) {
      case "other":
        return check.done
          ? { ...base, label: copy.other.label, value: copy.other.none }
          : { ...base, label: copy.other.label, value: copy.other.value(wrapUp.other.ids.length), figure: spentFigure(wrapUp.other, copy.other.label, hidden), action: { kind: "other", label: copy.other.open } };
      case "estimates":
        return check.done
          ? { ...base, label: copy.estimates.label, value: copy.estimates.none }
          : { ...base, label: copy.estimates.label, value: copy.estimates.value(wrapUp.estimates.ids.length), figure: spentFigure(wrapUp.estimates, copy.estimates.label, hidden), action: { kind: "estimates", label: copy.estimates.open, ids: wrapUp.estimates.ids } };
      case "statements":
        return check.done
          ? { ...base, label: copy.statements.label, value: copy.statements.all(wrapUp.statements.accountCount) }
          : { ...base, label: copy.statements.label, value: copy.statements.missing(wrapUp.statements.missing.map((file) => file.name)), action: { kind: "imports", label: copy.statements.open } };
      case "splits": {
        if (check.done) {
          return { ...base, label: copy.splits.label, value: copy.splits.none };
        }
        const { balances, usuallySharedIds } = wrapUp.splits;
        const lines = hidden ? [] : balances.map((balance) => ({
          key: balance.id,
          // Several groups each say which ("Baby River: Tim owes Joyce").
          text: balances.length > 1 ? copy.splits.inGroup(balance.name, balance.owes) : balance.owes,
          // Owed to you is mint, a debt rose; the household's "Ethan owes Serene" has no side.
          figure: { fig: "splits", amountMinor: Math.abs(balance.balanceMinor), currency: balance.currency, arg: balance.id, name: balance.name, tone: balance.direction === "between" ? "neutral" : signTone(balance.direction === "owed_to_you" ? 1 : -1) }
        }));
        if (usuallySharedIds.length) {
          lines.push({ key: "usually-shared", text: copy.splits.usuallyShared(usuallySharedIds.length), figure: null });
        }
        return { ...base, label: copy.splits.label, value: hidden && balances.length ? copy.splits.many(balances.length) : "", lines, action: { kind: "splits", label: copy.splits.open } };
      }
      case "plan":
        return check.done
          ? { ...base, label: copy.plan.label, value: copy.plan.none }
          : {
            ...base,
            label: copy.plan.label,
            value: hidden ? copy.plan.hiddenCount(checks.overPlan.length) : "",
            lines: hidden ? [] : checks.overPlan.map((line) => ({
              key: line.id,
              text: line.name,
              figure: { fig: "plan", amountMinor: line.overMinor, name: line.name, tone: spendTone(line.actualMinor, line.plannedMinor) },
              after: copy.plan.over
            })),
            action: { kind: "plan", label: copy.plan.open }
          };
      case "note":
      default:
        return check.done
          ? { ...base, label: copy.note.label, value: copy.note.written }
          : { ...base, label: copy.note.label, value: copy.note.notWritten, action: { kind: "note", label: copy.note.open } };
    }
  });
  return { month: wrapUp.month, wrappedUp: false, line: "", done: checks.doneCount, total, changed: changedBlock(wrapUp.changed, hidden), rows };
}
