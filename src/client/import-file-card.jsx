import { CalendarDays, Check, CircleAlert, FileText } from "lucide-react";

import { importMessages } from "./copy/en-SG-imports";
import { LeadCard, MetaChip } from "./ui-components";
import "./import-file-card.css";

// The Lead of a file in review (design.md, "Imports"): the file's name, how
// many rows will import as the figure, and the Support chips that say what
// to know before committing: the dates it covers, whether its account is
// mapped, and whose it is. The account itself is shown once: as the subtitle
// when nothing here changes it, and as the Account row under the card when
// the person can map it (never both).
/**
 * @param {{
 *   title: string, subtitle?: string, rowCount: number, coverage?: string,
 *   unknownAccountCount?: number, showAccountState?: boolean, ownerName?: string
 * }} props
 */
export function ImportFileCard({ title, subtitle = undefined, rowCount, coverage = undefined, unknownAccountCount = 0, showAccountState = false, ownerName = undefined }) {
  const chips = [
    coverage ? <MetaChip key="coverage" icon={CalendarDays}>{coverage}</MetaChip> : null,
    showAccountState ? (
      unknownAccountCount > 0
        ? <MetaChip key="account" tone="butter" icon={CircleAlert}>{importMessages.fileCardMapAccounts(unknownAccountCount)}</MetaChip>
        : <MetaChip key="account" tone="mint" icon={Check}>{importMessages.fileCardAccountMapped}</MetaChip>
    ) : null,
    ownerName ? <MetaChip key="owner" person={ownerName}>{ownerName}</MetaChip> : null
  ].filter(Boolean);
  return (
    <LeadCard
      className="import-file-card"
      accentColor="var(--accent-strong)"
      category={{ icon: FileText }}
      title={title}
      subtitle={subtitle}
      // A count of rows, not money: a node keeps it out of money privacy.
      amount={<span>{rowCount}</span>}
      amountCaption={importMessages.fileCardRowsCaption(rowCount)}
      chips={chips}
    />
  );
}
