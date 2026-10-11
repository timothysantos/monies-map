// The Claude credit status as Ask and Settings show it (design.md "Claude
// credit notice"; DOMAIN.md "AI Provider Status"). Pure: the status read,
// the Ask notice and the Settings line, the session dismissal rule, and the
// "I've topped up" amount check. The data (claude-credit-status.js) and the
// components (claude-credit-notice.jsx) use these; tests import them
// directly.

import { claudeCreditCopy as copy } from "./copy/claude-credit-copy.js";

const STATES = new Set(["ok", "low", "exhausted", "capped", "unknown"]);
// Only these three show a notice on Ask. The rank is how bad it is: a
// dismissed notice comes back only for a higher rank. A used-up balance
// outranks the monthly spending limit, which resets by itself.
const NOTICE_STATES = {
  low: { rank: 1, tone: "butter" },
  capped: { rank: 2, tone: "rose" },
  exhausted: { rank: 3, tone: "rose" }
};
const MAX_TOP_UP_USD = 10_000;
export const CLAUDE_CREDIT_MAX_AGE_MS = 5 * 60 * 1000;
// sessionStorage: one browser tab's session, never localStorage or the server.
export const CREDIT_NOTICE_DISMISSAL_KEY = "monies.claudeCreditNotice.v1";

function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function readTime(value) {
  return typeof value === "string" && value ? value : null;
}

// GET /api/ai-assist/provider-status as the client keeps it: { visible:
// false } for a viewer who may not see it, the known fields for one who may,
// or null for a body that is not a status (the caller treats it as failed).
export function readClaudeCreditStatus(body) {
  if (!body || typeof body !== "object" || body.ok !== true) {
    return null;
  }
  if (body.visible === false) {
    return { visible: false };
  }
  if (body.visible !== true) {
    return null;
  }
  return {
    visible: true,
    claudeConfigured: body.claudeConfigured === true,
    state: STATES.has(body.state) ? body.state : "unknown",
    estimatedSpendUsd: readNumber(body.estimatedSpendUsd),
    creditUsd: readNumber(body.creditUsd),
    warnAtUsd: readNumber(body.warnAtUsd),
    lastFailureAt: readTime(body.lastFailureAt),
    lastSuccessAt: readTime(body.lastSuccessAt),
    // Only an https address becomes a link.
    consoleBillingUrl: typeof body.consoleBillingUrl === "string" && body.consoleBillingUrl.startsWith("https://") ? body.consoleBillingUrl : null
  };
}

// "$20" for whole dollars, "$15.23" otherwise. US dollars: Claude bills in
// them, whatever the household's own currency.
export function formatUsd(value) {
  const cents = Math.round(readNumber(value) * 100);
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}

function buildActions(status) {
  return [
    ...(status.consoleBillingUrl ? [{ id: "top-up", label: copy.topUp, href: status.consoleBillingUrl }] : []),
    { id: "topped-up", label: copy.toppedUp }
  ];
}

function describeState(status, areTotalsVisible) {
  const spent = formatUsd(status.estimatedSpendUsd);
  const credit = formatUsd(status.creditUsd);
  switch (status.state) {
    case "low":
      return areTotalsVisible ? copy.low(spent, credit) : copy.lowHidden;
    case "exhausted":
      return copy.exhausted;
    case "capped":
      return copy.capped;
    case "ok":
      return areTotalsVisible ? copy.ok(spent, credit) : copy.okHidden;
    default:
      return copy.notSetUp;
  }
}

// The one calm notice at the top of the Ask conversation, or null when the
// credits are fine, unknown or not the viewer's to see.
export function buildClaudeCreditNotice(status, { areTotalsVisible }) {
  if (!status?.visible) {
    return null;
  }
  const kind = NOTICE_STATES[status.state];
  if (!kind) {
    return null;
  }
  return {
    state: status.state,
    rank: kind.rank,
    tone: kind.tone,
    text: describeState(status, areTotalsVisible),
    actions: buildActions(status),
    dismissLabel: copy.dismiss
  };
}

// The Settings line: every state, with the two actions while Claude is set
// up and none when it is not (or the state is unknown).
export function buildClaudeCreditLine(status, { areTotalsVisible }) {
  if (!status?.visible) {
    return null;
  }
  const known = status.claudeConfigured && status.state !== "unknown";
  return {
    state: known ? status.state : "unknown",
    tone: known ? NOTICE_STATES[status.state]?.tone ?? "neutral" : "neutral",
    text: known ? describeState(status, areTotalsVisible) : copy.notSetUp,
    actions: known ? buildActions(status) : []
  };
}

function rankOf(state) {
  return NOTICE_STATES[state]?.rank ?? 0;
}

export function readCreditNoticeDismissal(storage) {
  try {
    const value = storage?.getItem(CREDIT_NOTICE_DISMISSAL_KEY) ?? null;
    return rankOf(value) > 0 ? value : null;
  } catch {
    return null;
  }
}

// Writes the dismissed state, or clears it for null. A blocked store (a
// private window) just means the notice comes back on the next visit.
export function writeCreditNoticeDismissal(storage, state) {
  try {
    if (state) {
      storage?.setItem(CREDIT_NOTICE_DISMISSAL_KEY, state);
    } else {
      storage?.removeItem(CREDIT_NOTICE_DISMISSAL_KEY);
    }
  } catch {
    // Kept in memory for this visit only.
  }
}

export function isCreditNoticeHidden(notice, dismissedState) {
  return Boolean(notice && dismissedState && rankOf(dismissedState) >= notice.rank);
}

// What the stored dismissal becomes for a newly read status: kept while the
// state is no worse, cleared when it gets worse (so the notice shows) or
// when the credits are fine again (so a later drop shows). No status yet
// changes nothing.
export function nextCreditNoticeDismissal(dismissedState, status) {
  if (!dismissedState || !status) {
    return dismissedState ?? null;
  }
  const rank = status.visible ? rankOf(status.state) : 0;
  if (rank === 0 || rank > rankOf(dismissedState)) {
    return null;
  }
  return dismissedState;
}

// The amount typed into "I've topped up": US dollars, more than 0 (after
// rounding to cents) and at most 10,000, as the route checks. A leading $
// or US$ and thousands commas are allowed; anything else is refused.
export function validateTopUpAmount(text) {
  const cleaned = String(text ?? "").trim().replace(/^(us)?\$\s*/i, "").replace(/,/g, "");
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) {
    return { ok: false, error: copy.form.invalid };
  }
  const creditUsd = Math.round(Number(cleaned) * 100) / 100;
  if (!(creditUsd > 0) || creditUsd > MAX_TOP_UP_USD) {
    return { ok: false, error: copy.form.invalid };
  }
  return { ok: true, creditUsd };
}

// Read when the screen first becomes usable, then again only once the kept
// status is older than five minutes.
export function shouldFetchClaudeCreditStatus({ enabled, hasData, updatedAt, now, maxAgeMs = CLAUDE_CREDIT_MAX_AGE_MS }) {
  if (!enabled) {
    return false;
  }
  return !hasData || now - updatedAt > maxAgeMs;
}
