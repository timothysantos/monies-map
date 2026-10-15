// Where a plan line is stored (DOMAIN.md "Plan Studio"): a line with a due
// date is a planned item, any other spending line a budget bucket. The two
// sections are storage; the Month page's Studio shows both as Spend. This is
// all the Month page needs to add a line from Studio, so it stays out of the
// studio's own code (the first thing Simple view must not load).
export const sectionForNewLine = (planDate) => (planDate ? "planned_items" : "budget_buckets");
