import type {
  AccountDto,
  EntryDto,
  HouseholdDto,
  ImportBatchDto,
  MonthPlanRowDto,
  SummaryMonthDto
} from "../types/dto";

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

export const summaryMonths: SummaryMonthDto[] = [
  {
    month: "2025-06",
    incomeMinor: 597373,
    estimatedExpensesMinor: 659935,
    realExpensesMinor: 751465,
    savingsGoalMinor: 120000,
    realizedSavingsMinor: -34092,
    estimatedDiffMinor: -62562,
    realDiffMinor: -154092,
    note: "Japan ticket and Miki's wedding pushed June above plan before the usual baby-related spending starts."
  },
  {
    month: "2025-07",
    incomeMinor: 597373,
    estimatedExpensesMinor: 562288,
    realExpensesMinor: 587226,
    savingsGoalMinor: 180000,
    realizedSavingsMinor: 190147,
    estimatedDiffMinor: 35085,
    realDiffMinor: 10147,
    note: "Joyce's birthday and the heavy paint workshop were planned spikes, then Urban Company overshot."
  },
  {
    month: "2025-08",
    incomeMinor: 597373,
    estimatedExpensesMinor: 588919,
    realExpensesMinor: 574282,
    savingsGoalMinor: 180000,
    realizedSavingsMinor: 203091,
    estimatedDiffMinor: 8454,
    realDiffMinor: 23091,
    note: "Bali and JLPT were intentional; reimbursements reduced food pressure and helped the month land below plan."
  },
  {
    month: "2025-09",
    incomeMinor: 597373,
    estimatedExpensesMinor: 515488,
    realExpensesMinor: 529907,
    savingsGoalMinor: 180000,
    realizedSavingsMinor: 247466,
    estimatedDiffMinor: 81885,
    realDiffMinor: 67466,
    note: "Tennis and lessons were manageable, but shopping ran hotter than planned."
  },
  {
    month: "2025-10",
    incomeMinor: 597373,
    estimatedExpensesMinor: 579688,
    realExpensesMinor: 559665,
    savingsGoalMinor: 180000,
    realizedSavingsMinor: 217708,
    estimatedDiffMinor: 17685,
    realDiffMinor: 37708,
    note: "No tennis month helped, but food and shopping still carried the month."
  }
];

export const summaryMonthsByView: Record<string, SummaryMonthDto[]> = {
  household: summaryMonths,
  "person-tim": [
    {
      month: "2025-06",
      incomeMinor: 597373,
      estimatedExpensesMinor: 425000,
      realExpensesMinor: 503500,
      savingsGoalMinor: 90000,
      realizedSavingsMinor: 93873,
      estimatedDiffMinor: 172373,
      realDiffMinor: 93873,
      note: "Tim carried the iPad, travel, and more of the wedding-related spend."
    },
    {
      month: "2025-07",
      incomeMinor: 597373,
      estimatedExpensesMinor: 366500,
      realExpensesMinor: 402800,
      savingsGoalMinor: 120000,
      realizedSavingsMinor: 194573,
      estimatedDiffMinor: 230873,
      realDiffMinor: 194573,
      note: "Tim side stayed under control even with lessons and workshop-related spillover."
    },
    {
      month: "2025-08",
      incomeMinor: 597373,
      estimatedExpensesMinor: 398000,
      realExpensesMinor: 384200,
      savingsGoalMinor: 120000,
      realizedSavingsMinor: 213173,
      estimatedDiffMinor: 199373,
      realDiffMinor: 213173,
      note: "Bali and JLPT sat more heavily on Tim's side, but reimbursements softened the month."
    },
    {
      month: "2025-09",
      incomeMinor: 597373,
      estimatedExpensesMinor: 332000,
      realExpensesMinor: 345500,
      savingsGoalMinor: 120000,
      realizedSavingsMinor: 251873,
      estimatedDiffMinor: 265373,
      realDiffMinor: 251873,
      note: "Tennis and lessons were the main Tim-side drivers in September."
    },
    {
      month: "2025-10",
      incomeMinor: 597373,
      estimatedExpensesMinor: 338740,
      realExpensesMinor: 342830,
      savingsGoalMinor: 120000,
      realizedSavingsMinor: 254543,
      estimatedDiffMinor: 258633,
      realDiffMinor: 254543,
      note: "No tennis month helped; Tim's side still absorbed tax, food share, and church commitments."
    }
  ],
  "person-joyce": [
    {
      month: "2025-06",
      incomeMinor: 0,
      estimatedExpensesMinor: 234935,
      realExpensesMinor: 247965,
      savingsGoalMinor: 30000,
      realizedSavingsMinor: -247965,
      estimatedDiffMinor: -234935,
      realDiffMinor: -247965,
      note: "Joyce side was lighter on income in the demo but still carried family and shared obligations."
    },
    {
      month: "2025-07",
      incomeMinor: 0,
      estimatedExpensesMinor: 195788,
      realExpensesMinor: 184426,
      savingsGoalMinor: 60000,
      realizedSavingsMinor: -184426,
      estimatedDiffMinor: -195788,
      realDiffMinor: -184426,
      note: "Joyce's birthday month still landed below the household plan share in the demo."
    },
    {
      month: "2025-08",
      incomeMinor: 0,
      estimatedExpensesMinor: 190919,
      realExpensesMinor: 190082,
      savingsGoalMinor: 60000,
      realizedSavingsMinor: -190082,
      estimatedDiffMinor: -190919,
      realDiffMinor: -190082,
      note: "Joyce side stayed close to estimate in August."
    },
    {
      month: "2025-09",
      incomeMinor: 0,
      estimatedExpensesMinor: 183488,
      realExpensesMinor: 184407,
      savingsGoalMinor: 60000,
      realizedSavingsMinor: -184407,
      estimatedDiffMinor: -183488,
      realDiffMinor: -184407,
      note: "Shopping contributed more heavily on Joyce's side in September."
    },
    {
      month: "2025-10",
      incomeMinor: 0,
      estimatedExpensesMinor: 240948,
      realExpensesMinor: 216835,
      savingsGoalMinor: 60000,
      realizedSavingsMinor: -216835,
      estimatedDiffMinor: -240948,
      realDiffMinor: -216835,
      note: "Joyce side carried shopping and parent's insurance but landed under estimate in October."
    }
  ]
};

export const monthPlanRows: MonthPlanRowDto[] = [
  {
    id: "plan-oct-savings",
    section: "planned_items",
    categoryName: "Savings",
    label: "Savings",
    dayLabel: "1",
    dayOfWeek: "Wed",
    plannedMinor: 180000,
    actualMinor: 180000,
    note: "SAVE ~30% : build up 3mos emergency fund",
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
    note: "INVEST ~10% : moved 10% to savings for now",
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
    note: "$250 for Family is roughly around 10,500PHP",
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
    accountName: "Citi Rewards",
    note: "Total 40.65",
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
    note: "Total 45.94",
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
    note: "will consider GP as my offering starting July",
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
    accountName: "Citi Rewards",
    note: "Actual Total: 78.77 (Estimated Total 150)",
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
    note: "Total 27.98",
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
    accountName: "UOB One",
    note: "Actual Total: 66.03 (Estimated Total 50)",
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
    accountName: "Citi Rewards",
    note: "Total 4.01",
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
    note: "Total 49.90",
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
    note: "Total 144",
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
    note: "Total 70",
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
    categoryName: "Sport & Hobbies",
    label: "Tennis lesson",
    plannedMinor: 12400,
    actualMinor: 8300,
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
    note: "Budget",
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
    note: "Budget: Daily Food budget average 650/30 = ~21, 391.08 solo | 322.11 shared",
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
    note: "Budget",
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
    note: "Budget",
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
    note: "Budget",
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
    note: "Budget",
    ownershipType: "shared",
    splits: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: 0 },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: 0 }
    ]
  },
  {
    id: "plan-oct-sports",
    section: "budget_buckets",
    categoryName: "Sport & Hobbies",
    label: "Sports & Hobbies",
    plannedMinor: 10450,
    actualMinor: 0,
    note: "Budget - Active SG 9.50 bookings x 11",
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
    note: "Budget",
    ownershipType: "direct",
    ownerName: "Joyce",
    splits: [{ personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 10000, amountMinor: 57496 }]
  }
];

export const monthEntries: EntryDto[] = [
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
    note: "Mapped from the October budget bucket actual.",
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
    note: "Mapped from the October budget bucket actual.",
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
    note: "Joyce-heavy month driver.",
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
    id: "txn-oct-tennis-1",
    date: "2025-10-19",
    description: "Tennis lesson",
    accountName: "UOB One",
    categoryName: "Sport & Hobbies",
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    amountMinor: 8300,
    offsetsCategory: false,
    splits: [{ personId: "person-tim", personName: "Tim", ratioBasisPoints: 10000, amountMinor: 8300 }]
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

export const importBatches: ImportBatchDto[] = [
  {
    id: "import-2025-10-citi",
    sourceLabel: "Citi Rewards October CSV",
    sourceType: "csv",
    importedAt: "2026-04-03T10:15:00Z",
    status: "completed",
    transactionCount: 42,
    note: "Some household subscriptions are still represented as grouped plan rows."
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
