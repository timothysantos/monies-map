// The few Plan Studio words the Month page itself needs: the Studio | Tables
// switch and adding a line from Studio (the plan-row sheet's title, subtitle
// and due date field). Kept apart
// from plan-studio-copy.js, which ships only with the studio's own chunk.
export const planStudioAddCopy = {
  // The Sliders | List switch beside the plan's buttons (stored values stay
  // "studio" and "tables"; only these words are shown).
  modes: {
    label: "How to show the plan",
    studio: "Sliders",
    tables: "List",
    unsavedStudio: "Sliders, with changes not saved yet"
  },
  // The planned line "Add to Savings" counts extra money in on.
  extraIncomeLabel: "Extra income",
  addLine: "Add a line",
  newLineSubtitle: "Spend, save or invest",
  dueDate: "Due date (optional)"
};
