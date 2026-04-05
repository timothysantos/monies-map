export const messages = {
  common: {
    loading: "Loading...",
    emptyValue: "—",
    viewingDot: (label) => `Viewing • ${label}`,
    contextWithView: (left, right) => `${left} • ${right}`,
    triplet: (first, second, third) => `${first} • ${second} • ${third}`,
    moneyAndPercent: (moneyValue, percentage) => `${moneyValue} • ${percentage}%`
  },
  views: {
    household: "Household"
  },
  tabs: {
    summary: "Summary",
    month: "Month",
    entries: "Entries",
    imports: "Imports",
    faq: "FAQ",
    ariaLabel: "Dashboard sections"
  },
  period: {
    month: "Month",
    year: "Year",
    currentYear: "2025",
    previousAriaLabel: "Previous period",
    nextAriaLabel: "Next period"
  },
  summary: {
    spendingMix: "Spending Mix",
    intentVsOutcome: "Intent vs Outcome",
    intentVsOutcomeDetail: "Monthly comparison with expandable detail.",
    incomeLabel: (value) => `${value} income`,
    totalSpend: "Total spend",
    table: {
      metric: "Metric",
      estimate: "Planned",
      actual: "Actual",
      variance: "Variance",
      note: "Context",
      expectedExpenses: "Expected spend",
      expectedSavings: "Savings goal",
      actualSavings: "Realized savings"
    }
  },
  month: {
    incomeSectionTitle: "Income",
    incomeSectionDetail: "Planned income sources that fund the month before expenses are allocated.",
    addIncomeSource: "+ Add income source",
    incomeRowNote: "Main planned income source for the month.",
    extraIncomeNote: "Additional planned income source.",
    addPlannedItem: "+ Add planned item",
    addBudgetBucket: "+ Add budget bucket",
    newPlannedItemNote: "New planned item.",
    newBudgetBucketNote: "New budget bucket.",
    doneEdit: "Done",
    cancelEdit: "Cancel",
    notesTitle: "Monthly Notes",
    notesDetail: "Why the month looked like this.",
    accountsTitle: "Accounts",
    accountsDetail: "Tracked finance accounts.",
    editHint: "Click a row to edit the plan. Actual stays read-only because it should come from entries.",
    table: {
      category: "Category",
      day: "Date",
      item: "Item",
      planned: "Planned",
      actual: "Actual",
      variance: "Variance",
      account: "Account",
      note: "Note"
    }
  },
  entries: {
    viewing: (label) => `Viewing entries for ${label}`,
    wallet: "By wallet",
    category: "By category",
    person: "By people",
    allWallets: "All wallets",
    allCategories: "All categories",
    allPeople: "All people",
    type: "By type",
    allTypes: "All types",
    dateNet: "Daily net",
    editCategory: "Category",
    editDate: "Date",
    editDescription: "Description",
    editWallet: "Wallet",
    editOwner: "Owner",
    editSplit: "Split %",
    editNote: "Note",
    scope: "Scope",
    shared: "Shared",
    offsetsCategory: " • offsets category",
    split: "Split",
    counterpart: "Counterpart",
    doneEdit: "Done",
    cancelEdit: "Cancel"
  },
  imports: {
    viewing: (label) => `Viewing imports for ${label}`,
    transactionCount: (count) => `${count} transactions`
  },
  faq: {
    viewing: (label) => `Viewing FAQ for ${label}`,
    items: [
      {
        question: "What is Monie's Map trying to answer?",
        answer:
          "Not only what got spent. The app is trying to answer what was intended, what happened, whether the difference was justified, whether savings were hurt, and which assumption was wrong."
      },
      {
        question: "What does over-granular mean here?",
        answer:
          "Over-granular means budgeting too many unstable or one-off purchases as separate planned rows. Based on the June to October sheets, your current split already looks reasonable: planned items on top and broader budget buckets below."
      },
      {
        question: "Why is the month view split into planned items and budget buckets?",
        answer:
          "Planned items are intentional commitments like savings, loan, tax, subscriptions, or specific one-offs. Budget buckets are flexible categories like food, groceries, shopping, and transport."
      },
      {
        question: "Should this FAQ be updated later?",
        answer:
          "Yes. The FAQ is a living product document and should be updated whenever setup, workflow, philosophy, or user-facing behavior changes."
      }
    ]
  }
};
