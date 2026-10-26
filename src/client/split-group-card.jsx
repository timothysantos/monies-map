import { Coins, Plane, Users } from "lucide-react";
import { useState } from "react";

import { splitsMessages } from "./copy/en-SG-splits";
import { GrowingTextarea, PickerRow } from "./detail-field-rows";
import { DetailRows, LeadCard, MetaChip } from "./ui/lead-support-detail";

const copy = splitsMessages;
// Splits terracotta, from the category palette (the split cards' colour).
const GROUP_BUBBLE_COLOUR = "#BF7D51";

export const SPLIT_CURRENCY_OPTIONS = [
  ["SGD", "Singapore dollar"],
  ["JPY", "Japanese yen"],
  ["KRW", "South Korean won"],
  ["PHP", "Philippine peso"],
  ["USD", "US dollar"],
  ["EUR", "Euro"],
  ["GBP", "British pound"],
  ["AUD", "Australian dollar"],
  ["CAD", "Canadian dollar"],
  ["CNY", "Chinese yuan"],
  ["HKD", "Hong Kong dollar"],
  ["TWD", "New Taiwan dollar"],
  ["THB", "Thai baht"],
  ["MYR", "Malaysian ringgit"],
  ["IDR", "Indonesian rupiah"],
  ["VND", "Vietnamese dong"],
  ["INR", "Indian rupee"]
];

const SOURCE_OPTIONS = [
  { value: "cash", label: "Cash only" },
  { value: "ledger", label: "Bank/card" },
  { value: "mixed", label: "Cash and bank/card" }
];

// The Create group card (design.md, "Lead · Support · Detail"): the lead is
// the group being named (typed in place) with its currency and purchase
// source as chips; the two choices are Detail rows (the picker sheet on a
// phone, a native select on a wide screen), with the advice for holidays
// under them. SplitsPanel keeps the draft and the save.
export function SplitGroupCard({ dialog, isSheet, onChange }) {
  const [openPicker, setOpenPicker] = useState("");
  const currency = dialog?.currency ?? "SGD";
  const source = dialog?.expenseSource ?? "mixed";
  const currencyOption = SPLIT_CURRENCY_OPTIONS.find(([code]) => code === currency);
  const currencyLabel = currencyOption ? `${currencyOption[0]} - ${currencyOption[1]}` : currency;
  const sourceLabel = SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? "";
  const update = (patch) => onChange((current) => current ? { ...current, ...patch } : current);
  const pickerProps = (key) => ({
    rowKey: key,
    isSheet,
    open: openPicker === key,
    onOpenChange: (open) => setOpenPicker(open ? key : "")
  });

  return (
    <div className="split-expense-card split-group-card is-sheet">
      <div className="split-expense-card-lead">
        <LeadCard
          className="split-expense-lead"
          category={{ colorHex: GROUP_BUBBLE_COLOUR, icon: currency === "SGD" ? Users : Plane }}
          title={(
            <GrowingTextarea
              className="lsd-title lsd-title-input"
              aria-label={copy.groupName}
              placeholder={copy.groupName}
              value={dialog?.name ?? ""}
              singleLine
              onChange={(name) => update({ name })}
            />
          )}
          chips={[
            <MetaChip key="currency" icon={Coins}>{currency}</MetaChip>,
            <MetaChip key="source">{sourceLabel}</MetaChip>
          ]}
        />
      </div>
      <DetailRows label={copy.createGroup} className="split-expense-rows">
        <PickerRow
          {...pickerProps("currency")}
          label="Group currency"
          valueLabel={currencyLabel}
          value={currency}
          options={SPLIT_CURRENCY_OPTIONS.map(([code, name]) => ({ value: code, label: `${code} - ${name}` }))}
          onValueChange={(next) => update({ currency: next })}
        />
        <PickerRow
          {...pickerProps("source")}
          label="Purchase source"
          valueLabel={sourceLabel}
          value={source}
          options={SOURCE_OPTIONS}
          onValueChange={(next) => update({ expenseSource: next })}
        />
      </DetailRows>
      <p className="lsd-note split-dialog-help">Use Cash only and Bank/card as separate groups for a holiday when you want settlements to stay easy to reconcile.</p>
    </div>
  );
}
