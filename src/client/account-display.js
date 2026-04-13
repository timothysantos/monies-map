import { messages } from "./copy/en-SG";
import { formatMonthLabel, money } from "./formatters";

export function describeAccountHealth(account) {
  if (account.reconciliationStatus === "matched" && account.latestCheckpointMonth) {
    return messages.settings.accountHealthMatched(formatMonthLabel(account.latestCheckpointMonth));
  }

  if (account.reconciliationStatus === "mismatch" && account.latestCheckpointMonth) {
    return messages.settings.accountHealthMismatch(
      formatMonthLabel(account.latestCheckpointMonth),
      money(Math.abs(account.latestCheckpointDeltaMinor ?? 0))
    );
  }

  return messages.settings.accountHealthNeedsCheckpoint;
}

export function formatAccountDisplayName(account) {
  const accountName = account.accountName ?? account.name ?? messages.common.emptyValue;
  return account.ownerLabel ? `${accountName} • ${account.ownerLabel}` : accountName;
}

export function formatAuditAction(action) {
  return action
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
