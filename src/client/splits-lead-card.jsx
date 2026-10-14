import "./splits-lead.css";
import { History, Receipt } from "lucide-react";

import { messages } from "./copy/en-SG";
import { splitsLeadCopy as copy } from "./copy/splits-lead-copy";
import { moniesClient } from "./monies-client-service";
import { PrivateMoney } from "./money-privacy";
import { getIconComponent } from "./ui-components";
import { DetailRow, DetailRows, LeadCard, MetaChip } from "./ui/lead-support-detail";

const { format: formatService } = moniesClient;

// Splits terracotta, from the category palette (the same colour the split
// expense card's bubble uses).
const GROUP_BUBBLE_COLOUR = "#BF7D51";

// The lead card for the open group (design.md, "Lead · Support · Detail"):
// the group bubble, its name and "JPY · 10 entries", the balance as the one
// figure in its money tone with who owes whom under it, the person and group
// spend as Support chips, then History (quiet) and Settle group (the one
// primary). A wide screen adds + Add expense. The group spend chip opens the
// category breakdown, as the old summary strip's chevron did.
// `lead` comes from buildSplitsLead; every handler stays in SplitsPanel.
// The balance is an openable figure (design.md "Openable figures",
// figure-menu.js): Open Splits (this group, at the list that made the
// balance) and Ask about this ("Who owes whom?").
export function SplitsLeadCard({
  lead,
  groupId = "",
  iconKey,
  currency,
  readOnly = false,
  showSimplify = false,
  isCheckpointing = false,
  canSettle = false,
  showBreakdown = false,
  showAddExpense = false,
  onToggleBreakdown,
  onOpenHistory,
  onAddExpense,
  onSettle,
  onSimplify
}) {
  const Icon = getIconComponent(iconKey);
  const isHousehold = lead.amountMinor === null;
  // The household has no balance: the spend is the figure.
  const amount = formatService.moneyWithCurrency(isHousehold ? lead.spendMinor : lead.amountMinor, currency);
  const spend = formatService.moneyWithCurrency(lead.spendMinor, currency);
  const caption = isHousehold ? messages.entries.totalSpend : lead.caption;

  return (
    <LeadCard
      className="splits-lead"
      aria-label={copy.groupBalanceLabel}
      category={{ colorHex: GROUP_BUBBLE_COLOUR, icon: Icon }}
      title={lead.title}
      subtitle={lead.subtitle}
      amount={(
        <span data-fig="splits" data-fig-arg={groupId} role="button" tabIndex={0}>
          <PrivateMoney>{amount}</PrivateMoney>
        </span>
      )}
      tone={lead.tone}
      amountCaption={caption}
      chips={[
        lead.counterpartName ? <MetaChip key="person" person={lead.counterpartName}>{lead.counterpartName}</MetaChip> : null,
        isHousehold ? null : (
          <MetaChip
            key="spend"
            icon={Receipt}
            data-chip="group-spend"
            actionLabel="Toggle split donut"
            aria-haspopup={undefined}
            aria-expanded={showBreakdown}
            onClick={onToggleBreakdown}
          >
            {copy.groupSpend} <span className="splits-lead-spend">{spend}</span>
          </MetaChip>
        )
      ]}
    >
      {!readOnly && showSimplify ? (
        <DetailRows className="splits-lead-rows">
          <DetailRow
            label={isCheckpointing ? "Simplifying..." : "Simplify settlement"}
            value={<></>}
            disabled={isCheckpointing}
            onClick={onSimplify}
            className="splits-lead-simplify-row"
            data-row="simplify"
          />
        </DetailRows>
      ) : null}
      <div className="splits-lead-actions">
        <button type="button" className="lsd-quiet splits-lead-history" aria-label="Activity history" onClick={onOpenHistory}>
          <History size={18} aria-hidden="true" />
          {copy.history}
        </button>
        {!readOnly && showAddExpense ? (
          <button type="button" className="splits-lead-add" onClick={onAddExpense}>
            {messages.splits.addExpense}
          </button>
        ) : null}
        {!readOnly ? (
          <button type="button" className="lsd-primary splits-lead-settle" disabled={!canSettle} onClick={onSettle}>
            {messages.splits.settleUp}
          </button>
        ) : null}
      </div>
    </LeadCard>
  );
}
