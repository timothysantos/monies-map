import { ArrowLeftRight, CalendarDays, CopyPlus, Sparkles, Tag } from "lucide-react";
import { useState } from "react";

import { formatShortMonth } from "./copy/ask-copy";
import { askPlanCopy, formatMonthYear } from "./copy/ask-plan-copy";
import { moneyWithCurrency } from "./formatters";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { headroomTone } from "../domain/money-tone";
import { BottomActions, DetailRow, DetailRows, LeadCard, MetaChip, MoreDetails } from "./ui/lead-support-detail";

export const NEUTRAL_BUBBLE_COLOUR = "#7C8791";
// A long copy shows this many lines, the rest behind "N more lines".
const SHOWN_LINES = 6;

// The card's head line for each kind of draft (design.md "Plan draft"):
// the line's plan (set, change, add), the amount moved and its two lines
// (move), or the month's planned spend (copy).
export function planDraftHead(draft) {
  const amount = moneyWithCurrency(draft.lead.amountMinor);
  if (draft.kind === "move") {
    return { title: askPlanCopy.moveTitle(amount), subtitle: askPlanCopy.moveSubtitle(draft.lead.fromLabel ?? "", draft.lead.toLabel ?? ""), caption: formatShortMonth(draft.month) };
  }
  if (draft.kind === "copy") {
    return {
      title: askPlanCopy.copyTitle(formatMonthYear(draft.month)),
      subtitle: askPlanCopy.copySubtitle(formatMonthYear(draft.copyFrom)),
      caption: askPlanCopy.was(moneyWithCurrency(draft.lead.beforeMinor ?? 0))
    };
  }
  return {
    title: askPlanCopy.lineTitle(draft.lead.label),
    subtitle: formatMonthYear(draft.month),
    caption: draft.lead.beforeMinor === null ? askPlanCopy.newLine : askPlanCopy.was(moneyWithCurrency(draft.lead.beforeMinor))
  };
}

function ChangeValue({ beforeMinor, afterMinor, tone = "plan", hidden }) {
  const toneClass = hidden ? "money-neutral" : moneyToneClass(tone);
  if (beforeMinor === afterMinor) {
    return <span className="ask-plan-change"><PrivateMoney className={toneClass}>{moneyWithCurrency(afterMinor)}</PrivateMoney></span>;
  }
  return (
    <span className="ask-plan-change">
      <PrivateMoney className="ask-plan-before">{moneyWithCurrency(beforeMinor)}</PrivateMoney>
      <span aria-hidden="true">→</span>
      <span className="ask-sr-only">to</span>
      <PrivateMoney className={toneClass}>{moneyWithCurrency(afterMinor)}</PrivateMoney>
    </span>
  );
}

/**
 * A plan draft in the Ask conversation (docs/flows/ask-flow.md "Planning by
 * chat"): the LeadCard with the Draft tag, then each changed line and the
 * view's totals before → after, the plan-balance warning, and Discard and
 * Save plan. Saved, it keeps the head with the Saved tag and offers See it
 * on Month and Undo this change. Every figure is the server's draft, the
 * plan rows' own; nothing is written until Save plan. With money hidden the
 * amounts are dots and the warning (which says the plan is short) is gone.
 */
export function AskPlanDraftCard({ item, categories = [], people = [], busy = false, settled = false, onSave, onDiscard, onUndo, onOpenMonth }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const [linesOpen, setLinesOpen] = useState(false);
  const { draft } = item;
  const saved = item.status === "saved" || item.status === "undoing";
  const head = planDraftHead(draft);
  const category = draft.lead.categoryName ? categories.find((entry) => entry.name === draft.lead.categoryName) ?? null : null;
  const bubble = draft.kind === "move"
    ? { colorHex: NEUTRAL_BUBBLE_COLOUR, icon: ArrowLeftRight }
    : draft.kind === "copy"
      ? { colorHex: NEUTRAL_BUBBLE_COLOUR, icon: CopyPlus }
      : category ?? { colorHex: NEUTRAL_BUBBLE_COLOUR, icon: Tag };
  const viewPerson = people.find((person) => person.id === draft.viewId) ?? null;
  const showOwner = !viewPerson;
  const { before, after } = draft.totals;
  const sameSpend = draft.kind === "move" && before.plannedSpendMinor === after.plannedSpendMinor;
  const lineRows = draft.changes.map((change) => (
    <DetailRow
      key={change.rowId}
      readOnly
      data-plan-line={change.rowId}
      label={showOwner && change.ownerLabel ? askPlanCopy.lineWithOwner(change.label, change.ownerLabel) : change.label}
      value={<ChangeValue beforeMinor={change.beforeMinor} afterMinor={change.afterMinor} hidden={!areTotalsVisible} />}
    />
  ));
  const totals = [
    ["plannedIncome", before.plannedIncomeMinor, after.plannedIncomeMinor, "plan"],
    ["plannedSpend", before.plannedSpendMinor, after.plannedSpendMinor, "plan"],
    ["remaining", before.remainingMinor, after.remainingMinor, headroomTone(after.remainingMinor)]
  ];

  return (
    <section id={item.id} className={`ask-plan-draft${settled ? " is-settled" : ""}`} data-plan-draft={item.status} aria-label={askPlanCopy.cardLabel}>
      <LeadCard
        className="ask-plan-lead"
        tag={(
          <span className="ask-plan-tags">
            <span className={`ask-card-tag ${saved ? "is-saved" : "is-filled"}`}>{saved ? askPlanCopy.savedTag : askPlanCopy.draftTag}</span>
            {item.source === "ai" && !saved ? (
              <span className="ask-card-tag is-filled ask-plan-ai-tag">
                <Sparkles size={13} aria-hidden="true" />
                {askPlanCopy.aiTag}
              </span>
            ) : null}
          </span>
        )}
        category={bubble}
        title={<strong className="lsd-title ask-plan-title">{head.title}</strong>}
        subtitle={<span className="ask-plan-subtitle" style={category ? { "--cat": category.colorHex } : undefined}>{head.subtitle}</span>}
        amount={moneyWithCurrency(draft.kind === "copy" ? after.plannedSpendMinor : draft.lead.amountMinor)}
        tone={areTotalsVisible ? "plan" : "neutral"}
        amountCaption={saved ? askPlanCopy.planned : (areTotalsVisible || head.caption === askPlanCopy.newLine || draft.kind === "move" ? head.caption : null)}
        chips={saved ? null : (
          <>
            {viewPerson ? <MetaChip person={viewPerson.name}>{viewPerson.name}</MetaChip> : <MetaChip>{askPlanCopy.household}</MetaChip>}
            {draft.kind === "move" ? null : <MetaChip icon={CalendarDays}>{formatShortMonth(draft.month)}</MetaChip>}
            {sameSpend ? <MetaChip tone="sky" data-chip="same-spend">{askPlanCopy.sameSpend}</MetaChip> : null}
          </>
        )}
      />
      {saved ? (
        <DetailRows label={askPlanCopy.savedRowsLabel}>
          <DetailRow label={askPlanCopy.seeOnMonth} state="action" onClick={onOpenMonth} disabled={busy} />
          <DetailRow label={item.status === "undoing" ? askPlanCopy.undoing : askPlanCopy.undo} onClick={onUndo} disabled={busy} data-plan-undo="" />
        </DetailRows>
      ) : (
        <>
          <DetailRows label={askPlanCopy.rowsLabel}>
            {lineRows.slice(0, SHOWN_LINES)}
            {lineRows.length > SHOWN_LINES ? (
              <MoreDetails label={askPlanCopy.moreLines(lineRows.length - SHOWN_LINES)} openLabel={askPlanCopy.fewerLines} open={linesOpen} onOpenChange={setLinesOpen}>
                {lineRows.slice(SHOWN_LINES)}
              </MoreDetails>
            ) : null}
            {totals.map(([key, beforeMinor, afterMinor, tone]) => (
              <DetailRow
                key={key}
                readOnly
                className="ask-plan-total"
                data-plan-total={key}
                label={askPlanCopy.totals[key]}
                value={<ChangeValue beforeMinor={beforeMinor} afterMinor={afterMinor} tone={tone} hidden={!areTotalsVisible} />}
              />
            ))}
          </DetailRows>
          {draft.warning && areTotalsVisible ? <p className="ask-plan-warning" data-plan-warning="">{draft.warning.text}</p> : null}
          <BottomActions
            className="ask-plan-actions"
            quietLabel={askPlanCopy.discard}
            onQuiet={onDiscard}
            quietDisabled={busy}
            primaryLabel={item.status === "saving" ? askPlanCopy.saving : askPlanCopy.save}
            onPrimary={onSave}
            primaryDisabled={busy}
          />
        </>
      )}
    </section>
  );
}
