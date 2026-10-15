// The few Plan Studio words the Month page itself needs: the Studio | Tables
// switch and adding a line from Studio (the plan-row sheet's title, subtitle
// and due date field). Kept apart
// from plan-studio-copy.js, which ships only with the studio's own chunk.
export const planStudioAddCopy = {
  // The Studio | Tables switch above the plan.
  modes: {
    label: "Plan view",
    studio: "Studio",
    tables: "Tables",
    unsavedStudio: "Studio, with changes not saved yet"
  },
  addLine: "Add a line",
  newLineSubtitle: "Spend, save or invest",
  dueDate: "Due date (optional)"
};
