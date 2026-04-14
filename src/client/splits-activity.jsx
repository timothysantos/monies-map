import { getCategoryTheme } from "./category-utils";
import { messages } from "./copy/en-SG";
import { formatDateOnly, money } from "./formatters";
import { CategoryGlyph } from "./ui-components";

// Activity cards are shared by current split rows and archived batch history.
export function SplitActivityGroups({
  groups,
  categories,
  archived = false,
  onEditExpense,
  onEditSettlement,
  onEditLinkedEntry
}) {
  return groups.map((group) => (
    <section key={`${archived ? "archived" : "current"}-${group.date}`} className={`split-date-group ${archived ? "is-archived" : ""}`}>
      <header className="split-date-header">
        <strong>{formatDateOnly(group.date)}</strong>
        <span>{group.items.length} {messages.splits.entries}</span>
      </header>
      <div className="split-date-items">
        {group.items.map((item, index) => {
          const theme = getCategoryTheme(categories, { categoryName: item.categoryName ?? "Other" }, index);
          return (
            <article key={item.id} className="split-activity-card">
              <div className="split-activity-leading">
                <span className="category-icon category-icon-static" style={{ "--category-color": theme.color }}>
                  <CategoryGlyph iconKey={theme.iconKey} />
                </span>
              </div>
              <div className="split-activity-copy">
                <strong>{item.description}</strong>
                <p>{item.kind === "expense" ? `${item.paidByPersonName} paid ${money(item.totalAmountMinor)}` : `${item.fromPersonName} paid ${item.toPersonName}`}</p>
                {item.note ? <span className="share-row-meta">{item.note}</span> : null}
                <div className="split-card-actions">
                  <button type="button" className="subtle-action" onClick={() => (item.kind === "expense" ? onEditExpense(item) : onEditSettlement(item))}>
                    {messages.splits.editSplit}
                  </button>
                  {item.linkedTransactionId ? (
                    <button type="button" className="subtle-action" onClick={() => onEditLinkedEntry(item)}>
                      {messages.splits.editLinkedEntry}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="split-activity-trailing">
                <strong className={item.viewerDirectionLabel.includes("borrowed") || item.viewerDirectionLabel.includes("owe") ? "tone-negative" : "tone-positive"}>
                  {item.viewerDirectionLabel}
                </strong>
                <span>{money(item.viewerAmountMinor ?? item.totalAmountMinor)}</span>
                <span className="share-row-meta">{item.matched ? messages.splits.linked : messages.splits.manual}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  ));
}
