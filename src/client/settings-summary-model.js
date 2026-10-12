// The status word on each closed Settings row and the Ask and AI lead
// (design.md, "Settings"). Pure and read-only: every word comes from data the
// section already shows, never from a new request. No money is shown on
// Settings, so nothing here has a hidden-money form.

import { claudeCreditCopy } from "./copy/claude-credit-copy";
import { settingsMessages } from "./copy/en-SG-settings";

/**
 * Whether Claude answers Ask right now: set up, and neither used up nor at
 * the monthly limit. A set-up Claude that has not answered yet still counts.
 * @param {{ visible?: boolean, claudeConfigured?: boolean, state?: string } | null | undefined} status
 */
export function usesClaude(status) {
  return Boolean(status?.visible && status.claudeConfigured && status.state !== "exhausted" && status.state !== "capped");
}

/**
 * The Ask and AI lead: who answers, and one Support chip for the credit
 * state in its pastel pair.
 * @param {{ visible?: boolean, claudeConfigured?: boolean, state?: string, lastFailureAt?: string | null } | null | undefined} status
 */
export function describeAskAi(status) {
  const copy = claudeCreditCopy.settingsLead;
  const claudeOn = usesClaude(status);
  const configured = Boolean(status?.visible && status.claudeConfigured);
  const state = status?.state ?? "unknown";
  let chip;
  if (!configured) {
    chip = { text: copy.chipNotSetUp, tone: "butter" };
  } else if (state === "ok") {
    chip = { text: copy.chipOk, tone: "mint" };
  } else if (state === "low") {
    chip = { text: copy.chipLow, tone: "butter" };
  } else if (state === "exhausted") {
    chip = { text: copy.chipExhausted, tone: "rose" };
  } else if (state === "capped") {
    chip = { text: copy.chipCapped, tone: "rose" };
  } else {
    chip = { text: status?.lastFailureAt ? copy.chipNotSetUp : copy.chipNotUsedYet, tone: status?.lastFailureAt ? "butter" : undefined };
  }
  return {
    modelName: claudeOn ? copy.modelClaude : copy.modelBasic,
    subtitle: claudeOn ? copy.usesClaude : configured ? copy.usesBasicForNow : copy.usesBasic,
    chip
  };
}

/**
 * @param {{
 *   people?: { name: string }[], accounts?: unknown[], shortcutIsSetUp?: boolean,
 *   claudeStatus?: object | null, categories?: unknown[],
 *   exceptions?: { status: string }[], unresolvedTransfers?: unknown[]
 * }} input
 * @returns {Record<string, { text: string, tone?: string }>} keyed by Settings section
 */
export function buildSettingsSummaries({
  people = [],
  accounts = [],
  shortcutIsSetUp = false,
  claudeStatus = null,
  categories = [],
  exceptions = [],
  unresolvedTransfers = []
}) {
  const openExceptions = exceptions.filter((item) => item.status === "open").length;
  return {
    people: { text: people.map((person) => person.name).join(", ") },
    accounts: { text: String(accounts.length) },
    shortcutApi: shortcutIsSetUp
      ? { text: settingsMessages.statusSetUp }
      : { text: settingsMessages.statusNotSetUp, tone: "butter" },
    askAi: { text: describeAskAi(claudeStatus).modelName },
    paymentWays: { text: "" },
    categories: { text: String(categories.length) },
    categoryRules: { text: "" },
    trust: openExceptions
      ? { text: settingsMessages.statusToCheck(openExceptions), tone: "butter" }
      : { text: settingsMessages.statusAllClear },
    transfers: unresolvedTransfers.length
      ? { text: settingsMessages.statusToPair(unresolvedTransfers.length), tone: "butter" }
      : { text: settingsMessages.statusAllPaired },
    errorDiagnostics: { text: "" },
    activity: { text: "" }
  };
}
