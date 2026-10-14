// The Money insights that are about the plan (DOMAIN.md "Lead View"): spend
// against the plan, plan rows left or short, planned bills, savings against
// the target. The Simple view of Summary and Month shows no plan, so it
// leaves these out and keeps every other insight (statements, cards,
// subscriptions, spending against income, the long view). Matched on the
// signal's key, or its key's prefix before ":".
export const PLAN_SIGNAL_KEYS: readonly string[] = [
  "months-under-plan",
  "unlinked-bills",
  "plan-shortfall",
  "one-off-over-plan",
  "category-over-plan",
  "income-above-plan",
  "plan-left",
  "savings-on-plan",
  "upcoming-bills",
  "plan-pace",
  "fixed-costs"
];

export function isPlanSignal(signal: { key: string }) {
  return PLAN_SIGNAL_KEYS.includes(signal.key.split(":")[0]);
}

export function withoutPlanSignals<T extends { key: string }>(signals: T[]): T[] {
  return signals.filter((signal) => !isPlanSignal(signal));
}
