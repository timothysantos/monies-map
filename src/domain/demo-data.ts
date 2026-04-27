import type {
  AccountDto,
  CategoryDto,
  EntryDto,
  HouseholdDto,
  ImportBatchDto,
  MonthIncomeRowDto,
  MonthPlanRowDto,
  SummaryMonthDto
} from "../types/dto";

export interface DemoSettings {
  salaryPerPersonMinor: number;
  lastSeededAt: string;
  emptyState?: boolean;
}

interface SummaryMonthSeed {
  month: string;
  estimatedExpensesMinor: number;
  realExpensesMinor: number;
  savingsGoalMinor: number;
  householdNote: string;
  timEstimatedExpensesMinor: number;
  timRealExpensesMinor: number;
  timSavingsGoalMinor: number;
  timNote: string;
  joyceEstimatedExpensesMinor: number;
  joyceRealExpensesMinor: number;
  joyceSavingsGoalMinor: number;
  joyceNote: string;
}

type MonthDetailSeed = {
  month: string;
  planned: number;
  actual: number;
};

const DEFAULT_DEMO_LAST_SEEDED_AT = "2026-04-05T10:00:00+08:00";

export const defaultDemoSettings: DemoSettings = {
  salaryPerPersonMinor: 300000,
  lastSeededAt: DEFAULT_DEMO_LAST_SEEDED_AT,
  emptyState: true
};

export const household: HouseholdDto = {
  id: "household-1",
  name: "Monie's Map",
  baseCurrency: "SGD",
  people: [
    { id: "person-tim", name: "Tim" },
    { id: "person-joyce", name: "Joyce" }
  ]
};

export const accounts: AccountDto[] = [
  {
    id: "acct-uob-savings",
    name: "UOB Savings",
    institution: "UOB",
    kind: "bank",
    ownerLabel: "Tim",
    currency: "SGD",
    isJoint: false
  },
  {
    id: "acct-uob-one",
    name: "UOB One",
    institution: "UOB",
    kind: "credit_card",
    ownerLabel: "Tim",
    currency: "SGD",
    isJoint: false
  },
  {
    id: "acct-uob-lady",
    name: "UOB Lady's",
    institution: "UOB",
    kind: "credit_card",
    ownerLabel: "Joyce",
    currency: "SGD",
    isJoint: false
  },
  {
    id: "acct-citi-rewards",
    name: "Citi Rewards",
    institution: "Citibank",
    kind: "credit_card",
    ownerLabel: "Joyce",
    currency: "SGD",
    isJoint: false
  },
  {
    id: "acct-household",
    name: "Household Float",
    institution: "DBS",
    kind: "bank",
    ownerLabel: "Shared",
    currency: "SGD",
    isJoint: true
  }
];

export const categories: CategoryDto[] = [
  { id: "cat-income", name: "Income", slug: "income", iconKey: "receipt", colorHex: "#1F7A63", sortOrder: 1, isSystem: true },
  { id: "cat-transfer", name: "Transfer", slug: "transfer", iconKey: "arrow-right-left", colorHex: "#C97B47", sortOrder: 5, isSystem: true },
  { id: "cat-savings", name: "Savings", slug: "savings", iconKey: "receipt", colorHex: "#7C8791", sortOrder: 6, isSystem: true },
  { id: "cat-investments", name: "Investments", slug: "investments", iconKey: "banknote", colorHex: "#8FAE4B", sortOrder: 7, isSystem: true },
  { id: "cat-salary", name: "Salary", slug: "salary", iconKey: "badge-dollar-sign", colorHex: "#22B573", sortOrder: 8, isSystem: true },
  { id: "cat-extra-income", name: "Extra Income", slug: "extra-income", iconKey: "banknote-arrow-up", colorHex: "#D5A24B", sortOrder: 9, isSystem: true },
  { id: "cat-other-income", name: "Other - Income", slug: "other-income", iconKey: "wallet-cards", colorHex: "#B8875D", sortOrder: 10, isSystem: true },
  { id: "cat-subscriptions-mo", name: "Subscriptions MO", slug: "subscriptions-mo", iconKey: "washing-machine", colorHex: "#E96A7A", sortOrder: 11, isSystem: true },
  { id: "cat-subscriptions-yr", name: "Subscriptions YR", slug: "subscriptions-yr", iconKey: "washing-machine", colorHex: "#F08FA0", sortOrder: 12, isSystem: true },
  { id: "cat-food-drinks", name: "Food & Drinks", slug: "food-drinks", iconKey: "utensils", colorHex: "#F7A21B", sortOrder: 20, isSystem: true },
  { id: "cat-shopping", name: "Shopping", slug: "shopping", iconKey: "shopping-bag", colorHex: "#D86B73", sortOrder: 30, isSystem: true },
  { id: "cat-family-personal", name: "Family & Personal", slug: "family-personal", iconKey: "users", colorHex: "#4F8FD6", sortOrder: 40, isSystem: true },
  { id: "cat-baby-kids", name: "Baby & Kids", slug: "baby-kids", iconKey: "baby", colorHex: "#7EBDC2", sortOrder: 42, isSystem: true },
  { id: "cat-home", name: "Home", slug: "home", iconKey: "house", colorHex: "#F85A53", sortOrder: 45, isSystem: true },
  { id: "cat-church", name: "Church", slug: "church", iconKey: "church", colorHex: "#F062A6", sortOrder: 50, isSystem: true },
  { id: "cat-tax", name: "Tax", slug: "tax", iconKey: "banknote", colorHex: "#CC63D8", sortOrder: 60, isSystem: true },
  { id: "cat-groceries", name: "Groceries", slug: "groceries", iconKey: "shopping-cart", colorHex: "#F08B43", sortOrder: 70, isSystem: true },
  { id: "cat-travel", name: "Travel", slug: "travel", iconKey: "plane", colorHex: "#567CC9", sortOrder: 80, isSystem: true },
  { id: "cat-loans", name: "Loans", slug: "loans", iconKey: "wallet-cards", colorHex: "#A06C5B", sortOrder: 90, isSystem: true },
  { id: "cat-sport-hobbies", name: "Sports & Hobbies", slug: "sports-hobbies", iconKey: "dumbbell", colorHex: "#66D2CF", sortOrder: 100, isSystem: true },
  { id: "cat-bills", name: "Bills", slug: "bills", iconKey: "lightbulb", colorHex: "#62C7B2", sortOrder: 110, isSystem: true },
  { id: "cat-education", name: "Education", slug: "education", iconKey: "graduation-cap", colorHex: "#7D86F2", sortOrder: 115, isSystem: true },
  { id: "cat-insurance", name: "Insurance", slug: "insurance", iconKey: "shield", colorHex: "#5EA89B", sortOrder: 120, isSystem: true },
  { id: "cat-fees", name: "Fees", slug: "fees", iconKey: "receipt", colorHex: "#8B78E6", sortOrder: 125, isSystem: true },
  { id: "cat-beauty", name: "Beauty", slug: "beauty", iconKey: "receipt", colorHex: "#D56BDD", sortOrder: 130, isSystem: true },
  { id: "cat-entertainment", name: "Entertainment", slug: "entertainment", iconKey: "clapperboard", colorHex: "#FFA51A", sortOrder: 140, isSystem: true },
  { id: "cat-healthcare", name: "Healthcare", slug: "healthcare", iconKey: "heart-pulse", colorHex: "#D4B35D", sortOrder: 150, isSystem: true },
  { id: "cat-gifts", name: "Gifts", slug: "gifts", iconKey: "gift", colorHex: "#C98A5A", sortOrder: 160, isSystem: true },
  { id: "cat-other", name: "Other", slug: "other", iconKey: "wallet-cards", colorHex: "#717379", sortOrder: 170, isSystem: true },
  { id: "cat-public-transport", name: "Public Transport", slug: "public-transport", iconKey: "bus", colorHex: "#56A4C9", sortOrder: 180, isSystem: true },
  { id: "cat-taxi", name: "Taxi", slug: "taxi", iconKey: "car-front", colorHex: "#BDD93C", sortOrder: 190, isSystem: true }
];

const summaryMonthSeeds: SummaryMonthSeed[] = [
  {
    month: "2025-06",
    estimatedExpensesMinor: 659935,
    realExpensesMinor: 751465,
    savingsGoalMinor: 120000,
    householdNote: "Japan tickets, wedding gifts, and a couple of baby-prep buys pushed June above plan before things settled.",
    timEstimatedExpensesMinor: 410000,
    timRealExpensesMinor: 455500,
    timSavingsGoalMinor: 70000,
    timNote: "A few annual and family-related costs landed in the same month, which pushed Tim above the original plan.",
    joyceEstimatedExpensesMinor: 249935,
    joyceRealExpensesMinor: 295965,
    joyceSavingsGoalMinor: 50000,
    joyceNote: "Joyce stayed close to plan overall, with a bit more family-related spend than expected."
  },
  {
    month: "2025-07",
    estimatedExpensesMinor: 562288,
    realExpensesMinor: 587226,
    savingsGoalMinor: 120000,
    householdNote: "July was close to plan overall. Most recurring costs landed normally and the month stayed stable.",
    timEstimatedExpensesMinor: 355000,
    timRealExpensesMinor: 370000,
    timSavingsGoalMinor: 70000,
    timNote: "Tim stayed close to plan, with regular subscriptions and hobbies staying manageable.",
    joyceEstimatedExpensesMinor: 207288,
    joyceRealExpensesMinor: 217226,
    joyceSavingsGoalMinor: 50000,
    joyceNote: "Joyce side was mostly steady, with a few small one-off family expenses."
  },
  {
    month: "2025-08",
    estimatedExpensesMinor: 588919,
    realExpensesMinor: 574282,
    savingsGoalMinor: 120000,
    householdNote: "August included travel and admin costs, but other spending stayed controlled enough to keep the month under plan.",
    timEstimatedExpensesMinor: 382000,
    timRealExpensesMinor: 365000,
    timSavingsGoalMinor: 70000,
    timNote: "Tim had a few larger planned items this month, but the rest of spending stayed measured.",
    joyceEstimatedExpensesMinor: 206919,
    joyceRealExpensesMinor: 209282,
    joyceSavingsGoalMinor: 50000,
    joyceNote: "Joyce stayed close to estimate, with no category materially breaking the plan."
  },
  {
    month: "2025-09",
    estimatedExpensesMinor: 515488,
    realExpensesMinor: 529907,
    savingsGoalMinor: 120000,
    householdNote: "September stayed manageable overall, with only mild drift in discretionary categories.",
    timEstimatedExpensesMinor: 320000,
    timRealExpensesMinor: 333000,
    timSavingsGoalMinor: 70000,
    timNote: "Tim side remained fairly controlled with routine obligations and hobby spending in range.",
    joyceEstimatedExpensesMinor: 195488,
    joyceRealExpensesMinor: 196907,
    joyceSavingsGoalMinor: 50000,
    joyceNote: "Joyce tracked close to plan, with slightly more discretionary spend than expected."
  },
  {
    month: "2025-10",
    estimatedExpensesMinor: 579688,
    realExpensesMinor: 559665,
    savingsGoalMinor: 120000,
    householdNote: "October came in slightly under plan because routine costs landed as expected and discretionary spend stayed reasonable.",
    timEstimatedExpensesMinor: 356000,
    timRealExpensesMinor: 342830,
    timSavingsGoalMinor: 70000,
    timNote: "Tim covered the usual direct commitments and still stayed under estimate.",
    joyceEstimatedExpensesMinor: 223688,
    joyceRealExpensesMinor: 216835,
    joyceSavingsGoalMinor: 50000,
    joyceNote: "Joyce carried a few larger direct commitments, but the month still finished under estimate."
  }
];

export const demoMonths = summaryMonthSeeds.map((seed) => seed.month);

function buildSummaryMonth(
  seed: SummaryMonthSeed,
  incomeMinor: number,
  estimatedExpensesMinor: number,
  realExpensesMinor: number,
  savingsGoalMinor: number,
  note: string
): SummaryMonthDto {
  return {
    month: seed.month,
    plannedIncomeMinor: incomeMinor,
    actualIncomeMinor: incomeMinor,
    estimatedExpensesMinor,
    realExpensesMinor,
    savingsGoalMinor,
    realizedSavingsMinor: incomeMinor - realExpensesMinor,
    estimatedDiffMinor: incomeMinor - estimatedExpensesMinor,
    realDiffMinor: incomeMinor - realExpensesMinor,
    note
  };
}

export function buildSummaryMonthsByView(salaryPerPersonMinor: number): Record<string, SummaryMonthDto[]> {
  const householdIncomeMinor = salaryPerPersonMinor * 2;

  return {
    household: summaryMonthSeeds.map((seed) =>
      buildSummaryMonth(
        seed,
        householdIncomeMinor,
        seed.estimatedExpensesMinor,
        seed.realExpensesMinor,
        seed.savingsGoalMinor,
        seed.householdNote
      )
    ),
    "person-tim": summaryMonthSeeds.map((seed) =>
      buildSummaryMonth(
        seed,
        salaryPerPersonMinor,
        seed.timEstimatedExpensesMinor,
        seed.timRealExpensesMinor,
        seed.timSavingsGoalMinor,
        seed.timNote
      )
    ),
    "person-joyce": summaryMonthSeeds.map((seed) =>
      buildSummaryMonth(
        seed,
        salaryPerPersonMinor,
        seed.joyceEstimatedExpensesMinor,
        seed.joyceRealExpensesMinor,
        seed.joyceSavingsGoalMinor,
        seed.joyceNote
      )
    )
  };
}

export function buildMonthIncomeRows(viewId: string, salaryPerPersonMinor: number): MonthIncomeRowDto[] {
  if (viewId === "household") {
    return [
      {
        id: "month-income-tim-salary",
        categoryName: "Income",
        label: "Tim salary",
        plannedMinor: salaryPerPersonMinor,
        actualMinor: salaryPerPersonMinor,
        note: "Primary monthly income."
      },
      {
        id: "month-income-joyce-salary",
        categoryName: "Income",
        label: "Joyce salary",
        plannedMinor: salaryPerPersonMinor,
        actualMinor: salaryPerPersonMinor,
        note: "Primary monthly income."
      }
    ];
  }

  return [
    {
      id: `month-income-${viewId}-salary`,
      categoryName: "Income",
      label: "Salary",
      plannedMinor: salaryPerPersonMinor,
      actualMinor: salaryPerPersonMinor,
      note: "Primary planned monthly income."
    }
  ];
}

function allocateByWeights(total: number, weights: number[]) {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  let remaining = total;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) {
      return remaining;
    }

    const value = Math.round(total * (weight / sum));
    remaining -= value;
    return value;
  });
}

function buildGenericMonthArtifacts(seed: MonthDetailSeed) {
  const [year, month] = seed.month.split("-");
  const monthPrefix = `${year}-${month}`;
  const sharedFoodSplit = { tim: 5500, joyce: 4500 };

  const fixedPlanned = {
    savingsTim: 70000,
    savingsJoyce: 50000,
    houseLoan: 45000,
    family: 22000,
    tax: 28470,
    subscriptions: 7200
  };
  const fixedActual = {
    savingsTim: 70000,
    savingsJoyce: 50000,
    houseLoan: 45000,
    family: 23000,
    tax: 28470,
    subscriptions: 6900
  };

  const plannedFlexible = Math.max(
    0,
    seed.planned -
      fixedPlanned.savingsTim -
      fixedPlanned.savingsJoyce -
      fixedPlanned.houseLoan -
      fixedPlanned.family -
      fixedPlanned.tax -
      fixedPlanned.subscriptions
  );
  const actualFlexible = Math.max(
    0,
    seed.actual -
      fixedActual.savingsTim -
      fixedActual.savingsJoyce -
      fixedActual.houseLoan -
      fixedActual.family -
      fixedActual.tax -
      fixedActual.subscriptions
  );

  const [foodPlanned, groceriesPlanned, shoppingPlanned, hobbiesPlanned, transportPlanned] = allocateByWeights(plannedFlexible, [45, 15, 18, 12, 10]);
  const [foodActual, groceriesActual, shoppingActual, hobbiesActual, transportActual] = allocateByWeights(actualFlexible, [47, 14, 20, 10, 9]);

  const planRows: MonthPlanRowDto[] = [
    {
      id: `plan-${monthPrefix}-tim-savings`,
      section: "planned_items",
      categoryName: "Savings",
      label: "Savings",
      dayLabel: "1",
      dayOfWeek: undefined,
      plannedMinor: fixedPlanned.savingsTim,
      actualMinor: fixedActual.savingsTim,
      linkedEntryIds: fixedActual.savingsTim > 0 ? [`txn-${monthPrefix}-tim-savings`] : [],
      note: "Regular monthly savings allocation.",
      ownershipType: "direct",
      ownerName: "Tim",
      splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: fixedActual.savingsTim }]
    },
    {
      id: `plan-${monthPrefix}-joyce-savings`,
      section: "planned_items",
      categoryName: "Savings",
      label: "Savings",
      dayLabel: "1",
      dayOfWeek: undefined,
      plannedMinor: fixedPlanned.savingsJoyce,
      actualMinor: fixedActual.savingsJoyce,
      linkedEntryIds: fixedActual.savingsJoyce > 0 ? [`txn-${monthPrefix}-joyce-savings`] : [],
      note: "Regular monthly savings allocation.",
      ownershipType: "direct",
      ownerName: "Joyce",
      splits: [{ personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 10000, amountMinor: fixedActual.savingsJoyce }]
    },
    {
      id: `plan-${monthPrefix}-family`,
      section: "planned_items",
      categoryName: "Family & Personal",
      label: "Family support",
      dayLabel: "2",
      dayOfWeek: undefined,
      plannedMinor: fixedPlanned.family,
      actualMinor: fixedActual.family,
      linkedEntryIds: fixedActual.family > 0 ? [`txn-${monthPrefix}-family`] : [],
      note: "Shared family allocation.",
      ownershipType: "shared",
      splits: [
        { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: Math.floor(fixedActual.family / 2) },
        { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: Math.ceil(fixedActual.family / 2) }
      ]
    },
    {
      id: `plan-${monthPrefix}-house-loan`,
      section: "planned_items",
      categoryName: "Loans",
      label: "House loan",
      dayLabel: "2",
      dayOfWeek: undefined,
      plannedMinor: fixedPlanned.houseLoan,
      actualMinor: fixedActual.houseLoan,
      linkedEntryIds: fixedActual.houseLoan > 0 ? [`txn-${monthPrefix}-house-loan`] : [],
      note: "Recurring shared housing payment.",
      ownershipType: "shared",
      splits: [
        { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 22500 },
        { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 22500 }
      ]
    },
    {
      id: `plan-${monthPrefix}-tax`,
      section: "planned_items",
      categoryName: "Tax",
      label: "Tax",
      dayLabel: "6",
      dayOfWeek: undefined,
      plannedMinor: fixedPlanned.tax,
      actualMinor: fixedActual.tax,
      linkedEntryIds: fixedActual.tax > 0 ? [`txn-${monthPrefix}-tax`] : [],
      note: "Recurring tax allocation.",
      ownershipType: "direct",
      ownerName: "Tim",
      splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: fixedActual.tax }]
    },
    {
      id: `plan-${monthPrefix}-subscriptions`,
      section: "planned_items",
      categoryName: "Subscriptions MO",
      label: "Shared subscriptions",
      dayLabel: "15",
      dayOfWeek: undefined,
      plannedMinor: fixedPlanned.subscriptions,
      actualMinor: fixedActual.subscriptions,
      linkedEntryIds: fixedActual.subscriptions > 0 ? [`txn-${monthPrefix}-subscriptions`] : [],
      note: "Grouped recurring household subscriptions.",
      ownershipType: "shared",
      splits: [
        { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: Math.floor(fixedActual.subscriptions / 2) },
        { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: Math.ceil(fixedActual.subscriptions / 2) }
      ]
    },
    {
      id: `plan-${monthPrefix}-food`,
      section: "budget_buckets",
      categoryName: "Food & Drinks",
      label: "Food",
      plannedMinor: foodPlanned,
      actualMinor: foodActual,
      note: "Main shared dining budget for the month.",
      ownershipType: "shared",
      splits: [
        { personId: "person-tim", personName: "Tim", ratioBasisPoints: sharedFoodSplit.tim, amountMinor: Math.round(foodActual * (sharedFoodSplit.tim / 10000)) },
        { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: sharedFoodSplit.joyce, amountMinor: foodActual - Math.round(foodActual * (sharedFoodSplit.tim / 10000)) }
      ]
    },
    {
      id: `plan-${monthPrefix}-groceries`,
      section: "budget_buckets",
      categoryName: "Groceries",
      label: "Groceries",
      plannedMinor: groceriesPlanned,
      actualMinor: groceriesActual,
      note: "Shared grocery budget.",
      ownershipType: "shared",
      splits: [
        { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: Math.floor(groceriesActual / 2) },
        { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: Math.ceil(groceriesActual / 2) }
      ]
    },
    {
      id: `plan-${monthPrefix}-transport`,
      section: "budget_buckets",
      categoryName: "Public Transport",
      label: "Transport",
      plannedMinor: transportPlanned,
      actualMinor: transportActual,
      note: "Flexible commuting budget.",
      ownershipType: "shared",
      splits: [
        { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: Math.floor(transportActual / 2) },
        { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: Math.ceil(transportActual / 2) }
      ]
    },
    {
      id: `plan-${monthPrefix}-shopping`,
      section: "budget_buckets",
      categoryName: "Shopping",
      label: "Shopping",
      plannedMinor: shoppingPlanned,
      actualMinor: shoppingActual,
      note: "Personal shopping budget.",
      ownershipType: "direct",
      ownerName: "Joyce",
      splits: [{ personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 10000, amountMinor: shoppingActual }]
    },
    {
      id: `plan-${monthPrefix}-hobbies`,
      section: "budget_buckets",
      categoryName: "Sports & Hobbies",
      label: "Sports & Hobbies",
      plannedMinor: hobbiesPlanned,
      actualMinor: hobbiesActual,
      note: "Personal sports and hobby budget.",
      ownershipType: "direct",
      ownerName: "Tim",
      splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: hobbiesActual }]
    }
  ];

  const entries: EntryDto[] = [
    {
      id: `txn-${monthPrefix}-tim-savings`,
      date: `${monthPrefix}-01`,
      description: "Savings allocation",
      accountName: "UOB Savings",
      categoryName: "Savings",
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim",
      amountMinor: fixedActual.savingsTim,
      offsetsCategory: false,
      note: "Planned-item match for Tim's savings allocation.",
      splits: planRows.find((row) => row.id === `plan-${monthPrefix}-tim-savings`)!.splits
    },
    {
      id: `txn-${monthPrefix}-joyce-savings`,
      date: `${monthPrefix}-01`,
      description: "Savings allocation",
      accountName: "UOB Lady's",
      categoryName: "Savings",
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Joyce",
      amountMinor: fixedActual.savingsJoyce,
      offsetsCategory: false,
      note: "Planned-item match for Joyce's savings allocation.",
      splits: planRows.find((row) => row.id === `plan-${monthPrefix}-joyce-savings`)!.splits
    },
    {
      id: `txn-${monthPrefix}-family`,
      date: `${monthPrefix}-02`,
      description: "Family support",
      accountName: "UOB Savings",
      categoryName: "Family & Personal",
      entryType: "expense",
      ownershipType: "shared",
      amountMinor: fixedActual.family,
      offsetsCategory: false,
      note: "Booked against the family support planned item.",
      splits: planRows.find((row) => row.id === `plan-${monthPrefix}-family`)!.splits
    },
    {
      id: `txn-${monthPrefix}-house-loan`,
      date: `${monthPrefix}-02`,
      description: "House loan",
      accountName: "UOB One",
      categoryName: "Loans",
      entryType: "expense",
      ownershipType: "shared",
      amountMinor: fixedActual.houseLoan,
      offsetsCategory: false,
      note: "Booked against the recurring house loan planned item.",
      splits: planRows.find((row) => row.id === `plan-${monthPrefix}-house-loan`)!.splits
    },
    {
      id: `txn-${monthPrefix}-subscriptions`,
      date: `${monthPrefix}-15`,
      description: "Shared subscriptions",
      accountName: "Citi Rewards",
      categoryName: "Subscriptions MO",
      entryType: "expense",
      ownershipType: "shared",
      amountMinor: fixedActual.subscriptions,
      offsetsCategory: false,
      note: "Booked against the grouped household subscriptions planned item.",
      splits: planRows.find((row) => row.id === `plan-${monthPrefix}-subscriptions`)!.splits
    },
    {
      id: `txn-${monthPrefix}-food`,
      date: `${monthPrefix}-03`,
      description: "Dining total",
      accountName: "UOB One",
      categoryName: "Food & Drinks",
      entryType: "expense",
      ownershipType: "shared",
      amountMinor: foodActual,
      offsetsCategory: false,
      note: "Booked against the monthly dining budget.",
      splits: planRows.find((row) => row.id === `plan-${monthPrefix}-food`)!.splits
    },
    {
      id: `txn-${monthPrefix}-groceries`,
      date: `${monthPrefix}-06`,
      description: "Grocery total",
      accountName: "Citi Rewards",
      categoryName: "Groceries",
      entryType: "expense",
      ownershipType: "shared",
      amountMinor: groceriesActual,
      offsetsCategory: false,
      note: "Booked against the monthly grocery budget.",
      splits: planRows.find((row) => row.id === `plan-${monthPrefix}-groceries`)!.splits
    },
    {
      id: `txn-${monthPrefix}-shopping`,
      date: `${monthPrefix}-12`,
      description: "Shopping total",
      accountName: "UOB Lady's",
      categoryName: "Shopping",
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Joyce",
      amountMinor: shoppingActual,
      offsetsCategory: false,
      note: "Larger personal purchase in this sample month.",
      splits: [{ personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 10000, amountMinor: shoppingActual }]
    },
    {
      id: `txn-${monthPrefix}-tax`,
      date: `${monthPrefix}-14`,
      description: "Tax payment",
      accountName: "UOB Savings",
      categoryName: "Tax",
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim",
      amountMinor: fixedActual.tax,
      offsetsCategory: false,
      splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: fixedActual.tax }]
    },
    {
      id: `txn-${monthPrefix}-hobbies`,
      date: `${monthPrefix}-19`,
      description: "Hobby spend",
      accountName: "UOB One",
      categoryName: "Sports & Hobbies",
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim",
      amountMinor: hobbiesActual,
      offsetsCategory: false,
      note: "Booked against the monthly hobby budget.",
      splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: hobbiesActual }]
    }
  ];

  return { planRows, entries };
}

const octoberMonthPlanRows: MonthPlanRowDto[] = [
  {
    id: "plan-oct-savings",
    section: "planned_items",
    categoryName: "Savings",
    label: "Savings",
    dayLabel: "1",
    dayOfWeek: "Wed",
    plannedMinor: 180000,
    actualMinor: 180000,
    linkedEntryIds: ["txn-oct-savings-1"],
    note: "Regular monthly savings allocation.",
    ownershipType: "direct",
    ownerName: "Tim",
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 180000 }]
  },
  {
    id: "plan-oct-stashaway",
    section: "planned_items",
    categoryName: "Investments",
    label: "Stashaway",
    dayLabel: "1",
    dayOfWeek: "Wed",
    plannedMinor: 0,
    actualMinor: 0,
    note: "Investment contribution is paused in this sample month.",
    ownershipType: "direct",
    ownerName: "Tim",
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 0 }]
  },
  {
    id: "plan-oct-family",
    section: "planned_items",
    categoryName: "Family & Personal",
    label: "Family",
    dayLabel: "1",
    dayOfWeek: "Wed",
    plannedMinor: 26000,
    actualMinor: 23407,
    linkedEntryIds: ["txn-oct-family-1"],
    note: "Shared family support allocation.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 11704 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 11703 }
    ]
  },
  {
    id: "plan-oct-parents-insurance",
    section: "planned_items",
    categoryName: "Family & Personal",
    label: "Parent's Insurance",
    dayLabel: "1",
    dayOfWeek: "Wed",
    plannedMinor: 47000,
    actualMinor: 33429,
    linkedEntryIds: ["txn-oct-parents-insurance-1"],
    ownershipType: "direct",
    ownerName: "Joyce",
    splits: [{ personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 10000, amountMinor: 33429 }]
  },
  {
    id: "plan-oct-cursor",
    section: "planned_items",
    categoryName: "Subscriptions MO",
    label: "Cursor AI",
    dayLabel: "1",
    dayOfWeek: "Wed",
    plannedMinor: 2700,
    actualMinor: 2669,
    linkedEntryIds: ["txn-oct-cursor-1"],
    ownershipType: "direct",
    ownerName: "Tim",
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 2669 }]
  },
  {
    id: "plan-oct-m1",
    section: "planned_items",
    categoryName: "Bills",
    label: "M1home",
    dayLabel: "2",
    dayOfWeek: "Thu",
    plannedMinor: 2033,
    actualMinor: 2033,
    linkedEntryIds: ["txn-oct-m1-1"],
    accountName: "Citi Rewards",
    note: "Shared home internet allocation.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 1017 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 1016 }
    ]
  },
  {
    id: "plan-oct-netflix",
    section: "planned_items",
    categoryName: "Subscriptions MO",
    label: "Netflix",
    dayLabel: "2",
    dayOfWeek: "Thu",
    plannedMinor: 2297,
    actualMinor: 0,
    accountName: "Citi Rewards",
    note: "Shared streaming subscription.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 0 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 0 }
    ]
  },
  {
    id: "plan-oct-church",
    section: "planned_items",
    categoryName: "Church",
    label: "Tithes + offering",
    dayLabel: "2",
    dayOfWeek: "Thu",
    plannedMinor: 74700,
    actualMinor: 74700,
    linkedEntryIds: ["txn-oct-church-1"],
    note: "Recurring giving allocation.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 6000, amountMinor: 44820 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 4000, amountMinor: 29880 }
    ]
  },
  {
    id: "plan-oct-house-loan",
    section: "planned_items",
    categoryName: "Loans",
    label: "House loan",
    dayLabel: "2",
    dayOfWeek: "Thu",
    plannedMinor: 45000,
    actualMinor: 45000,
    linkedEntryIds: ["txn-oct-house-loan-1"],
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 22500 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 22500 }
    ]
  },
  {
    id: "plan-oct-openai",
    section: "planned_items",
    categoryName: "Subscriptions MO",
    label: "openAI",
    dayLabel: "2",
    dayOfWeek: "Thu",
    plannedMinor: 3100,
    actualMinor: 0,
    accountName: "UOB One",
    ownershipType: "direct",
    ownerName: "Tim",
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 0 }]
  },
  {
    id: "plan-oct-keppel",
    section: "planned_items",
    categoryName: "Bills",
    label: "Keppel",
    dayLabel: "4",
    dayOfWeek: "Sat",
    plannedMinor: 7500,
    actualMinor: 3939,
    linkedEntryIds: ["txn-oct-keppel-1"],
    accountName: "Citi Rewards",
    note: "Utilities tracked below the original estimate this month.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 1970 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 1969 }
    ]
  },
  {
    id: "plan-oct-tax",
    section: "planned_items",
    categoryName: "Tax",
    label: "Tax",
    dayLabel: "6",
    dayOfWeek: "Mon",
    plannedMinor: 28470,
    actualMinor: 28470,
    linkedEntryIds: ["txn-oct-tax-1"],
    accountName: "UOB Savings",
    ownershipType: "direct",
    ownerName: "Tim",
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 28470 }]
  },
  {
    id: "plan-oct-youtube",
    section: "planned_items",
    categoryName: "Subscriptions MO",
    label: "YouTube",
    dayLabel: "15",
    dayOfWeek: "Wed",
    plannedMinor: 1399,
    actualMinor: 0,
    accountName: "Citi Rewards",
    note: "Shared media subscription.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 0 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 0 }
    ]
  },
  {
    id: "plan-oct-gospel",
    section: "planned_items",
    categoryName: "Subscriptions MO",
    label: "GospelPartner",
    dayLabel: "17",
    dayOfWeek: "Fri",
    plannedMinor: 2398,
    actualMinor: 0,
    accountName: "Citi Rewards",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 0 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 0 }
    ]
  },
  {
    id: "plan-oct-sp",
    section: "planned_items",
    categoryName: "Bills",
    label: "SP Bill",
    dayLabel: "21",
    dayOfWeek: "Tue",
    plannedMinor: 2500,
    actualMinor: 3302,
    linkedEntryIds: ["txn-oct-sp-1"],
    accountName: "UOB One",
    note: "Electricity landed slightly above the estimate this month.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 1651 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 1651 }
    ]
  },
  {
    id: "plan-oct-vivify",
    section: "planned_items",
    categoryName: "Bills",
    label: "Vivify",
    dayLabel: "26",
    dayOfWeek: "Sun",
    plannedMinor: 1150,
    actualMinor: 1150,
    linkedEntryIds: ["txn-oct-vivify-1"],
    accountName: "Citi Rewards",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 575 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 575 }
    ]
  },
  {
    id: "plan-oct-icloud",
    section: "planned_items",
    categoryName: "Subscriptions MO",
    label: "iCloud",
    dayLabel: "28",
    dayOfWeek: "Tue",
    plannedMinor: 201,
    actualMinor: 201,
    linkedEntryIds: ["txn-oct-icloud-1"],
    accountName: "Citi Rewards",
    note: "Shared cloud storage subscription.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 101 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 100 }
    ]
  },
  {
    id: "plan-oct-apple-tv",
    section: "planned_items",
    categoryName: "Subscriptions MO",
    label: "Apple TV",
    dayLabel: "30",
    dayOfWeek: "Thu",
    plannedMinor: 0,
    actualMinor: 0,
    accountName: "Citi Rewards",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 0 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 0 }
    ]
  },
  {
    id: "plan-oct-amazon-prime",
    section: "planned_items",
    categoryName: "Subscriptions YR",
    label: "Amazon Prime",
    plannedMinor: 0,
    actualMinor: 0,
    accountName: "Citi Rewards",
    note: "Annual subscription placeholder.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 0 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 0 }
    ]
  },
  {
    id: "plan-oct-urban-company",
    section: "planned_items",
    categoryName: "Bills",
    label: "UrbanCompany",
    plannedMinor: 7200,
    actualMinor: 0,
    note: "Flexible home services placeholder.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 0 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 0 }
    ]
  },
  {
    id: "plan-oct-hdb",
    section: "planned_items",
    categoryName: "Bills",
    label: "HDB",
    plannedMinor: 3500,
    actualMinor: 0,
    note: "Shared housing charge placeholder.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 0 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 0 }
    ]
  },
  {
    id: "plan-oct-haircut",
    section: "planned_items",
    categoryName: "Beauty",
    label: "Haircut",
    plannedMinor: 3700,
    actualMinor: 0,
    ownershipType: "direct",
    ownerName: "Joyce",
    splits: [{ personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 10000, amountMinor: 0 }]
  },
  {
    id: "plan-oct-anywheel",
    section: "planned_items",
    categoryName: "Subscriptions MO",
    label: "Anywheel",
    plannedMinor: 990,
    actualMinor: 0,
    ownershipType: "direct",
    ownerName: "Tim",
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 0 }]
  },
  {
    id: "plan-oct-tennis",
    section: "planned_items",
    categoryName: "Sports & Hobbies",
    label: "Tennis lesson",
    plannedMinor: 12400,
    actualMinor: 8300,
    linkedEntryIds: ["txn-oct-tennis-1"],
    ownershipType: "direct",
    ownerName: "Tim",
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 8300 }]
  },
  {
    id: "plan-oct-public-transport",
    section: "budget_buckets",
    categoryName: "Public Transport",
    label: "Public Transport",
    plannedMinor: 6000,
    actualMinor: 0,
    note: "Flexible commuting budget.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 0 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 0 }
    ]
  },
  {
    id: "plan-oct-food",
    section: "budget_buckets",
    categoryName: "Food & Drinks",
    label: "Food",
    plannedMinor: 65000,
    actualMinor: 71319,
    note: "Main shared dining budget for the month.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5500, amountMinor: 39225 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 4500, amountMinor: 32094 }
    ]
  },
  {
    id: "plan-oct-groceries",
    section: "budget_buckets",
    categoryName: "Groceries",
    label: "Groceries",
    plannedMinor: 14000,
    actualMinor: 24251,
    note: "Shared grocery budget.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 12126 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 12125 }
    ]
  },
  {
    id: "plan-oct-taxi",
    section: "budget_buckets",
    categoryName: "Taxi",
    label: "Taxi",
    plannedMinor: 8000,
    actualMinor: 0,
    note: "Flexible ride budget.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 0 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 0 }
    ]
  },
  {
    id: "plan-oct-gifts",
    section: "budget_buckets",
    categoryName: "Gifts",
    label: "Gifts",
    plannedMinor: 5000,
    actualMinor: 0,
    note: "General gifts budget.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 0 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 0 }
    ]
  },
  {
    id: "plan-oct-entertainment",
    section: "budget_buckets",
    categoryName: "Entertainment",
    label: "Entertainment",
    plannedMinor: 7000,
    actualMinor: 0,
    note: "General entertainment budget.",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 0 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 0 }
    ]
  },
  {
    id: "plan-oct-sports",
    section: "budget_buckets",
    categoryName: "Sports & Hobbies",
    label: "Sports & Hobbies",
    plannedMinor: 10450,
    actualMinor: 0,
    note: "Personal sports and hobby budget.",
    ownershipType: "direct",
    ownerName: "Tim",
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 0 }]
  },
  {
    id: "plan-oct-shopping",
    section: "budget_buckets",
    categoryName: "Shopping",
    label: "Shopping",
    plannedMinor: 10000,
    actualMinor: 57496,
    note: "Personal shopping budget.",
    ownershipType: "direct",
    ownerName: "Joyce",
    splits: [{ personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 10000, amountMinor: 57496 }]
  }
];

const octoberMonthEntries: EntryDto[] = [
  {
    id: "txn-oct-savings-1",
    date: "2025-10-01",
    description: "Savings allocation",
    accountName: "UOB Savings",
    categoryName: "Savings",
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    amountMinor: 180000,
    offsetsCategory: false,
    note: "Booked against the monthly savings planned item.",
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 180000 }]
  },
  {
    id: "txn-oct-food-1",
    date: "2025-10-03",
    description: "October food spend",
    accountName: "UOB One",
    categoryName: "Food & Drinks",
    entryType: "expense",
    ownershipType: "shared",
    amountMinor: 71319,
    offsetsCategory: false,
    note: "Booked against the monthly dining budget.",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5500, amountMinor: 39225 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 4500, amountMinor: 32094 }
    ]
  },
  {
    id: "txn-oct-groceries-1",
    date: "2025-10-06",
    description: "October groceries",
    accountName: "Citi Rewards",
    categoryName: "Groceries",
    entryType: "expense",
    ownershipType: "shared",
    amountMinor: 24251,
    offsetsCategory: false,
    note: "Booked against the monthly grocery budget.",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 12126 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 12125 }
    ]
  },
  {
    id: "txn-oct-shopping-1",
    date: "2025-10-10",
    description: "Shopping total",
    accountName: "UOB Lady's",
    categoryName: "Shopping",
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Joyce",
    amountMinor: 57496,
    offsetsCategory: false,
    note: "Larger personal purchase in this sample month.",
    splits: [{ personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 10000, amountMinor: 57496 }]
  },
  {
    id: "txn-oct-family-1",
    date: "2025-10-12",
    description: "Family support",
    accountName: "UOB Savings",
    categoryName: "Family & Personal",
    entryType: "expense",
    ownershipType: "shared",
    amountMinor: 23407,
    offsetsCategory: false,
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 11704 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 11703 }
    ]
  },
  {
    id: "txn-oct-parents-insurance-1",
    date: "2025-10-12",
    description: "Parent's insurance",
    accountName: "UOB Lady's",
    categoryName: "Family & Personal",
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Joyce",
    amountMinor: 33429,
    offsetsCategory: false,
    splits: [{ personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 10000, amountMinor: 33429 }]
  },
  {
    id: "txn-oct-cursor-1",
    date: "2025-10-13",
    description: "Cursor AI",
    accountName: "Citi Rewards",
    categoryName: "Subscriptions MO",
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    amountMinor: 2669,
    offsetsCategory: false,
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 2669 }]
  },
  {
    id: "txn-oct-m1-1",
    date: "2025-10-13",
    description: "M1home",
    accountName: "Citi Rewards",
    categoryName: "Bills",
    entryType: "expense",
    ownershipType: "shared",
    amountMinor: 2033,
    offsetsCategory: false,
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 1017 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 1016 }
    ]
  },
  {
    id: "txn-oct-tax-1",
    date: "2025-10-14",
    description: "Tax payment",
    accountName: "UOB Savings",
    categoryName: "Tax",
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    amountMinor: 28470,
    offsetsCategory: false,
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 28470 }]
  },
  {
    id: "txn-oct-church-1",
    date: "2025-10-16",
    description: "Tithes + offering",
    accountName: "UOB One",
    categoryName: "Church",
    entryType: "expense",
    ownershipType: "shared",
    amountMinor: 74700,
    offsetsCategory: false,
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 6000, amountMinor: 44820 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 4000, amountMinor: 29880 }
    ]
  },
  {
    id: "txn-oct-house-loan-1",
    date: "2025-10-17",
    description: "House loan",
    accountName: "UOB One",
    categoryName: "Loans",
    entryType: "expense",
    ownershipType: "shared",
    amountMinor: 45000,
    offsetsCategory: false,
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 22500 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 22500 }
    ]
  },
  {
    id: "txn-oct-tennis-1",
    date: "2025-10-19",
    description: "Tennis lesson",
    accountName: "UOB One",
    categoryName: "Sports & Hobbies",
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    amountMinor: 8300,
    offsetsCategory: false,
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 8300 }]
  },
  {
    id: "txn-oct-keppel-1",
    date: "2025-10-20",
    description: "Keppel",
    accountName: "Citi Rewards",
    categoryName: "Bills",
    entryType: "expense",
    ownershipType: "shared",
    amountMinor: 3939,
    offsetsCategory: false,
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 1970 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 1969 }
    ]
  },
  {
    id: "txn-oct-sp-1",
    date: "2025-10-21",
    description: "SP Bill",
    accountName: "UOB One",
    categoryName: "Bills",
    entryType: "expense",
    ownershipType: "shared",
    amountMinor: 3302,
    offsetsCategory: false,
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 1651 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 1651 }
    ]
  },
  {
    id: "txn-oct-vivify-1",
    date: "2025-10-26",
    description: "Vivify",
    accountName: "Citi Rewards",
    categoryName: "Bills",
    entryType: "expense",
    ownershipType: "shared",
    amountMinor: 1150,
    offsetsCategory: false,
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 575 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 575 }
    ]
  },
  {
    id: "txn-oct-icloud-1",
    date: "2025-10-28",
    description: "iCloud",
    accountName: "Citi Rewards",
    categoryName: "Subscriptions MO",
    entryType: "expense",
    ownershipType: "shared",
    amountMinor: 201,
    offsetsCategory: false,
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 101 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 100 }
    ]
  },
  {
    id: "txn-oct-transfer-out",
    date: "2025-10-22",
    description: "Card payment to Citi Rewards",
    accountName: "UOB Savings",
    categoryName: "Transfer",
    entryType: "transfer",
    transferDirection: "out",
    ownershipType: "direct",
    ownerName: "Tim",
    amountMinor: 93150,
    offsetsCategory: false,
    linkedTransfer: {
      transactionId: "txn-oct-transfer-in",
      accountName: "Citi Rewards",
      amountMinor: 93150,
      transactionDate: "2025-10-22"
    },
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 93150 }]
  },
  {
    id: "txn-oct-transfer-in",
    date: "2025-10-22",
    description: "Payment received from UOB Savings",
    accountName: "Citi Rewards",
    categoryName: "Transfer",
    entryType: "transfer",
    transferDirection: "in",
    ownershipType: "direct",
    ownerName: "Tim",
    amountMinor: 93150,
    offsetsCategory: false,
    linkedTransfer: {
      transactionId: "txn-oct-transfer-out",
      accountName: "UOB Savings",
      amountMinor: 93150,
      transactionDate: "2025-10-22"
    },
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 93150 }]
  }
];

const genericSeededArtifacts = summaryMonthSeeds
  .filter((seed) => seed.month !== "2025-10")
  .map((seed) => buildGenericMonthArtifacts({
    month: seed.month,
    planned: seed.estimatedExpensesMinor,
    actual: seed.realExpensesMinor
  }));

export const monthPlanRows: MonthPlanRowDto[] = [
  ...genericSeededArtifacts.flatMap((artifact) => artifact.planRows),
  ...octoberMonthPlanRows
];

export const monthEntries: EntryDto[] = [
  ...genericSeededArtifacts.flatMap((artifact) => artifact.entries),
  ...octoberMonthEntries
];

export const importBatches: ImportBatchDto[] = [
  {
    id: "import-2025-10-citi",
    sourceLabel: "Citi Rewards October CSV",
    sourceType: "csv",
    importedAt: "2026-04-03T10:15:00Z",
    status: "completed",
    transactionCount: 42,
    note: "Demo import batch with grouped recurring charges."
  },
  {
    id: "import-2025-10-uob",
    sourceLabel: "UOB mixed-account export",
    sourceType: "csv",
    importedAt: "2026-04-02T18:40:00Z",
    status: "completed",
    transactionCount: 57
  }
];
