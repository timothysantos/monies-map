import { useState } from "react";

import { askCopy } from "./copy/ask-copy";
import { moneyWithCurrency } from "./formatters";
import { PrivateMoney } from "./money-privacy";
import { DetailRow, DetailRows } from "./ui/lead-support-detail";
import { receiptProgress } from "./ask-receipt-queue";

const copy = askCopy.receipts;

function headline(progress) {
  if (progress.working && progress.reading) return copy.reading(progress.reading, progress.total);
  if (progress.open) return copy.position(progress.open, progress.total);
  if (progress.finished) return copy.allDone(progress.total);
  return copy.reading(Math.min(progress.total, progress.done + progress.left + 1), progress.total);
}

/**
 * The receipts sent in one go (docs/flows/ask-flow.md "Many receipts at
 * once"): the progress line ("Reading 3 of 7…", "Receipt 2 of 7"), the
 * receipts that could not be read (each with Try again while its photo is
 * still in this tab's memory, and Type it instead), and See all for one
 * read-only Detail row per receipt with what happened to it. Shown only for
 * two or more receipts.
 * @param {{ receipts: any, busy?: boolean, canRetry: (id: string) => boolean, onRetry: (id: string) => void, onTypeInstead: (id: string) => void }} props
 */
export function AskReceiptQueueList({ receipts, busy = false, canRetry, onRetry, onTypeInstead }) {
  const [expanded, setExpanded] = useState(false);
  const progress = receiptProgress(receipts);
  const rows = receipts.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => expanded || item.status === "failed");
  return (
    <section className="ask-receipts" aria-label={copy.listLabel} data-receipts-total={progress.total}>
      <p className="ask-receipts-head" role="status" aria-live="polite">{headline(progress)}</p>
      <DetailRows label={copy.listLabel} className="ask-receipts-rows">
        {rows.map(({ item, index }) => {
          const name = item.read?.merchant?.value || copy.untitled(index + 1);
          const total = item.read?.total;
          const amount = Number.isInteger(total?.amountMinor) ? <PrivateMoney className="money-neutral">{moneyWithCurrency(total.amountMinor, total.currency ?? "SGD")}</PrivateMoney> : null;
          return (
            <div key={item.id} className={`ask-receipt-row is-${item.status}`} data-receipt-status={item.status} data-receipt-id={item.id}>
              <DetailRow
                readOnly
                label={<span className="ask-receipt-row-name">{`${index + 1}. ${name}`}</span>}
                value={(
                  <span className="ask-receipt-row-value">
                    {amount}
                    <span className="ask-receipt-row-state">{copy.states[item.status] ?? ""}</span>
                  </span>
                )}
              />
              {item.status === "failed" ? (
                <>
                  {canRetry(item.id) ? <DetailRow label={copy.tryAgain} state="action" disabled={busy} onClick={() => onRetry(item.id)} data-receipt-retry="" /> : null}
                  <DetailRow label={copy.typeInstead} state="action" disabled={busy} onClick={() => onTypeInstead(item.id)} data-receipt-type="" />
                </>
              ) : null}
            </div>
          );
        })}
        <DetailRow
          label={expanded ? copy.seeFewer : copy.seeAll(progress.total)}
          state="action"
          aria-expanded={expanded ? "true" : "false"}
          onClick={() => setExpanded((open) => !open)}
          data-receipts-toggle=""
        />
      </DetailRows>
    </section>
  );
}
