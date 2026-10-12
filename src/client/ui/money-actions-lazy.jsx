import { lazy, Suspense } from "react";

// The bar's and the jobs' menu (money-actions.jsx) loads on the first click
// or tap that opens it: it builds Entries and Ask links and reaches the Ask
// dock, none of which the first screen needs (scripts/initial-bundle-budget.json).
const MoneyActionsMenu = lazy(() => import("./money-actions").then((module) => ({ default: module.MoneyActions })));

/** @param {{ actionKey: string, name: string, figures: object, hidden: boolean, period: { startMonth: string, endMonth: string } }} props */
export function MoneyActions(props) {
  return (
    <Suspense fallback={null}>
      <MoneyActionsMenu {...props} />
    </Suspense>
  );
}
