import { useState } from "react";

import { askCopy } from "./copy/ask-copy";
import { moneyWithCurrency } from "./formatters";
import { PrivateMoney } from "./money-privacy";
import { DetailRow, DetailRows } from "./ui/lead-support-detail";

const copy = askCopy.receiptItems;

/**
 * The items a receipt lists, on its entry card (docs/flows/ask-flow.md
 * "Items and whose they are"): name, quantity and amount as read, tax,
 * service, discount and rounding lines as their own lines. On a card shared
 * on Splits each item has three one-tap choices, Mine, <other>'s and
 * Shared; the card's share rows below then show each person's share from
 * the items. Folded behind "See the N items" until the card is shared.
 * When the lines did not add up to the total, one line says so instead.
 * @param {{ card: any, people: Array<{ id: string, name: string }>, meId: string, disabled?: boolean, onOwner: (index: number, owner: string) => void }} props
 */
export function AskReceiptItems({ card, people, meId, disabled = false, onOwner }) {
  const items = card.receiptItems;
  const [open, setOpen] = useState(false);
  if (card.receiptItemsUnreliable && !items) {
    return <p className="ask-note is-calm ask-receipt-items-note" data-receipt-items="unreliable">{copy.unreliable}</p>;
  }
  if (!items) return null;
  const shown = open || card.share.on;
  const choosing = card.share.on && people.length > 1;
  const other = people.find((person) => person.id !== meId);
  const count = items.items.filter((item) => item.kind === "item").length;
  const choices = [
    { owner: meId, label: copy.mine },
    { owner: other?.id ?? "", label: copy.theirs(other?.name ?? "") },
    { owner: "shared", label: copy.shared }
  ];
  return (
    <section className="ask-receipt-items" aria-label={copy.label} data-receipt-items="ok">
      <DetailRows label={copy.label}>
        {!card.share.on ? (
          <DetailRow
            label={copy.label}
            value={open ? copy.hide : copy.see(count)}
            state="action"
            aria-expanded={open ? "true" : "false"}
            onClick={() => setOpen((value) => !value)}
            data-receipt-items-toggle=""
          />
        ) : null}
        {shown ? items.items.map((item, index) => {
          const owner = items.owners[index] ?? "shared";
          const name = `${item.quantity && item.quantity > 1 ? `${item.quantity}× ` : ""}${item.description}`;
          return (
            <div key={`${index}-${item.description}`} className={`ask-receipt-item is-${item.kind}${item.counted ? "" : " is-included"}`} data-receipt-item={index}>
              <DetailRow
                readOnly
                label={<span className="ask-receipt-item-name">{name}{item.counted ? "" : ` (${copy.included})`}</span>}
                value={<PrivateMoney className="money-neutral">{moneyWithCurrency(item.amountMinor, items.currency)}</PrivateMoney>}
              />
              {choosing && item.kind === "item" && item.counted ? (
                <div className="ask-receipt-item-whose" role="group" aria-label={copy.whose(item.description)}>
                  {choices.map((choice) => (
                    <button
                      key={choice.owner || choice.label}
                      type="button"
                      className="ask-receipt-item-choice"
                      aria-pressed={owner === choice.owner ? "true" : "false"}
                      disabled={disabled || !choice.owner}
                      onClick={() => onOwner(index, choice.owner)}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }) : null}
      </DetailRows>
    </section>
  );
}
