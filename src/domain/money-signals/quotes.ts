// Public-domain quotes for the expanded check-in. Loaded with a dynamic
// import when someone opens "Read full insight", so they never weigh on
// the first screen. Every line is copied exactly (spelling included) from
// the public-domain text named in `source`, checked before it was added.
// At most one shows, never beside a bigger question. A quote's place in
// the list sets its column (index mod 12): each page reads a different
// column each month, so no page repeats a quote within a year and two
// pages never show the same one in a month (pickQuote in checkin.ts,
// rotation.ts). Every column keeps a calm quote as its fallback; add new
// quotes at the end. This module holds only data, so its chunk carries
// nothing the first screen needs.
import type { QuoteTopic } from "./types";

export interface CheckInQuote {
  id: string;
  text: string;
  // Who says it, when it is a character: "Mr Micawber".
  speaker?: string;
  author: string;
  work: string;
  year: string;
  // The public-domain text the wording was checked against.
  source: string;
  topics: QuoteTopic[];
}

export const QUOTES: CheckInQuote[] = [
  {
    id: "thoreau-cost-of-a-thing",
    text: "The cost of a thing is the amount of what I will call life which is required to be exchanged for it, immediately or in the long run.",
    author: "Henry David Thoreau",
    work: "Walden",
    year: "1854",
    source: "Walden, \"Economy\" (Project Gutenberg #205)",
    topics: ["enjoy", "calm"]
  },
  {
    id: "thoreau-rich-in-proportion",
    text: "A man is rich in proportion to the number of things which he can afford to let alone.",
    author: "Henry David Thoreau",
    work: "Walden",
    year: "1854",
    source: "Walden, \"Where I Lived, and What I Lived For\" (Project Gutenberg #205)",
    topics: ["enough", "calm"]
  },
  {
    id: "thoreau-old-fashions",
    text: "Every generation laughs at the old fashions, but follows religiously the new.",
    author: "Henry David Thoreau",
    work: "Walden",
    year: "1854",
    source: "Walden, \"Economy\" (Project Gutenberg #205)",
    topics: ["change"]
  },
  {
    id: "thoreau-pumpkin",
    text: "I would rather sit on a pumpkin and have it all to myself than be crowded on a velvet cushion.",
    author: "Henry David Thoreau",
    work: "Walden",
    year: "1854",
    source: "Walden, \"Economy\" (Project Gutenberg #205)",
    topics: ["enjoy", "enough"]
  },
  {
    id: "thoreau-superfluous-wealth",
    text: "Superfluous wealth can buy superfluities only. Money is not required to buy one necessary of the soul.",
    author: "Henry David Thoreau",
    work: "Walden",
    year: "1854",
    source: "Walden, \"Conclusion\" (Project Gutenberg #205)",
    topics: ["enough", "calm"]
  },
  {
    id: "thoreau-time-stream",
    text: "Time is but the stream I go a-fishing in.",
    author: "Henry David Thoreau",
    work: "Walden",
    year: "1854",
    source: "Walden, \"Where I Lived, and What I Lived For\" (Project Gutenberg #205)",
    topics: ["time", "calm"]
  },
  {
    id: "dickens-micawber",
    text: "Annual income twenty pounds, annual expenditure nineteen nineteen and six, result happiness.",
    speaker: "Mr Micawber",
    author: "Charles Dickens",
    work: "David Copperfield",
    year: "1850",
    source: "David Copperfield, chapter 12 (Project Gutenberg #766)",
    topics: ["keep", "plan"]
  },
  {
    id: "seneca-craves-more",
    text: "It is not the man who has too little, but the man who craves more, that is poor.",
    author: "Seneca",
    work: "Letters to Lucilius, Letter 2",
    year: "c. 65",
    source: "Moral Letters to Lucilius, Letter 2, translated by Richard M. Gummere (1917), Wikisource",
    topics: ["enough", "calm"]
  },
  {
    id: "seneca-postponing",
    text: "While we are postponing, life speeds by.",
    author: "Seneca",
    work: "Letters to Lucilius, Letter 1",
    year: "c. 65",
    source: "Moral Letters to Lucilius, Letter 1, translated by Richard M. Gummere (1917), Wikisource",
    topics: ["later", "time"]
  },
  {
    id: "seneca-time-is-ours",
    text: "Nothing, Lucilius, is ours, except time.",
    author: "Seneca",
    work: "Letters to Lucilius, Letter 1",
    year: "c. 65",
    source: "Moral Letters to Lucilius, Letter 1, translated by Richard M. Gummere (1917), Wikisource",
    topics: ["time", "calm"]
  },
  {
    id: "franklin-little-expences",
    text: "Beware of little expences; a small leak will sink a great ship.",
    author: "Benjamin Franklin",
    work: "The Way to Wealth",
    year: "1758",
    source: "Franklin's Way to Wealth; or, \"Poor Richard Improved\" (Project Gutenberg #43855)",
    topics: ["small-costs"]
  },
  {
    id: "franklin-mickle",
    text: "Many a little makes a mickle.",
    author: "Benjamin Franklin",
    work: "The Way to Wealth",
    year: "1758",
    source: "Franklin's Way to Wealth; or, \"Poor Richard Improved\" (Project Gutenberg #43855)",
    topics: ["small-costs", "keep", "steady"]
  },
  {
    id: "franklin-lost-time",
    text: "Lost time is never found again.",
    author: "Benjamin Franklin",
    work: "The Way to Wealth",
    year: "1758",
    source: "Franklin's Way to Wealth; or, \"Poor Richard Improved\" (Project Gutenberg #43855)",
    topics: ["time", "later"]
  },
  {
    id: "franklin-morning-sun",
    text: "For age and want save while you may, No morning sun lasts a whole day.",
    author: "Benjamin Franklin",
    work: "The Way to Wealth",
    year: "1758",
    source: "Franklin's Way to Wealth; or, \"Poor Richard Improved\" (Project Gutenberg #43855)",
    topics: ["later", "keep"]
  },
  {
    id: "franklin-diligence",
    text: "Diligence is the mother of good luck",
    author: "Benjamin Franklin",
    work: "The Way to Wealth",
    year: "1758",
    source: "Franklin's Way to Wealth; or, \"Poor Richard Improved\" (Project Gutenberg #43855)",
    topics: ["steady"]
  },
  {
    id: "franklin-drive-thy-business",
    text: "Drive thy business, let not that drive thee",
    author: "Benjamin Franklin",
    work: "The Way to Wealth",
    year: "1758",
    source: "Franklin's Way to Wealth; or, \"Poor Richard Improved\" (Project Gutenberg #43855)",
    topics: ["plan"]
  },
  {
    id: "franklin-one-to-day",
    text: "One to-day is worth two to-morrows",
    author: "Benjamin Franklin",
    work: "The Way to Wealth",
    year: "1758",
    source: "Franklin's Way to Wealth; or, \"Poor Richard Improved\" (Project Gutenberg #43855)",
    topics: ["later", "settle"]
  },
  {
    id: "wilde-price-of-everything",
    text: "Nowadays people know the price of everything and the value of nothing.",
    speaker: "Lord Henry",
    author: "Oscar Wilde",
    work: "The Picture of Dorian Gray",
    year: "1891",
    source: "The Picture of Dorian Gray, chapter 4 (Project Gutenberg #174)",
    topics: ["enjoy", "change"]
  },
  {
    id: "emerson-money-costs",
    text: "Money often costs too much, and power and pleasure are not cheap.",
    author: "Ralph Waldo Emerson",
    work: "The Conduct of Life, \"Wealth\"",
    year: "1860",
    source: "The Conduct of Life, \"Wealth\" (Project Gutenberg #39827)",
    topics: ["enjoy", "change"]
  },
  {
    id: "austen-wealth-or-grandeur",
    text: "What have wealth or grandeur to do with happiness?",
    speaker: "Marianne Dashwood",
    author: "Jane Austen",
    work: "Sense and Sensibility",
    year: "1811",
    source: "Sense and Sensibility, chapter 17 (Project Gutenberg #161)",
    topics: ["enough", "enjoy", "calm"]
  },
  {
    id: "aesop-slow-but-steady",
    text: "Slow but steady wins the race.",
    author: "Aesop",
    work: "The Hare and the Tortoise",
    year: "1867",
    source: "Three Hundred Aesop's Fables, translated by George Fyler Townsend (1867) (Project Gutenberg #21)",
    topics: ["steady", "keep"]
  },
  {
    id: "franklin-creditors",
    text: "Creditors have better memories than debtors",
    author: "Benjamin Franklin",
    work: "The Way to Wealth",
    year: "1758",
    source: "Franklin's Way to Wealth; or, \"Poor Richard Improved\" (Project Gutenberg #43855)",
    topics: ["settle"]
  },
  {
    id: "emerson-peace",
    text: "Nothing can bring you peace but yourself.",
    author: "Ralph Waldo Emerson",
    work: "Essays: First Series, \"Self-Reliance\"",
    year: "1841",
    source: "Essays: First Series, \"Self-Reliance\" (Project Gutenberg #2944)",
    topics: ["calm"]
  },
  {
    id: "aurelius-happy-life",
    text: "Always bear this in mind; and another thing too, that very little indeed is necessary for living a happy life.",
    author: "Marcus Aurelius",
    work: "Meditations",
    year: "c. 170",
    source: "Thoughts of Marcus Aurelius Antoninus, translated by George Long (1862) (Project Gutenberg #15877)",
    topics: ["enough", "calm"]
  },
  {
    id: "dickens-thief-of-time",
    text: "Procrastination is the thief of time.",
    speaker: "Mr Micawber",
    author: "Charles Dickens",
    work: "David Copperfield",
    year: "1850",
    source: "David Copperfield, chapter 12 (Project Gutenberg #766)",
    topics: ["later", "settle"]
  },
  {
    id: "shakespeare-borrower",
    text: "Neither a borrower nor a lender be",
    speaker: "Polonius",
    author: "William Shakespeare",
    work: "Hamlet",
    year: "c. 1600",
    source: "Hamlet, Act 1, Scene 3 (Project Gutenberg #1524)",
    topics: ["settle"]
  },
  {
    id: "thoreau-give-me-truth",
    text: "Rather than love, than money, than fame, give me truth.",
    author: "Henry David Thoreau",
    work: "Walden",
    year: "1854",
    source: "Walden, \"Conclusion\" (Project Gutenberg #205)",
    topics: ["enough", "calm"]
  },
  {
    id: "aesop-ass-shadow",
    text: "In quarreling about the shadow we often lose the substance.",
    author: "Aesop",
    work: "The Ass and His Shadow",
    year: "1867",
    source: "Three Hundred Aesop's Fables, translated by George Fyler Townsend (1867) (Project Gutenberg #21)",
    topics: ["settle", "calm"]
  },
  {
    id: "franklin-great-pennyworth",
    text: "At a great pennyworth pause a while",
    author: "Benjamin Franklin",
    work: "The Way to Wealth",
    year: "1758",
    source: "Franklin's Way to Wealth; or, \"Poor Richard Improved\" (Project Gutenberg #43855)",
    topics: ["small-costs", "plan"]
  },
  {
    id: "seneca-todays-task",
    text: "Lay hold of to-day's task, and you will not need to depend so much upon to-morrow's.",
    author: "Seneca",
    work: "Letters to Lucilius, Letter 1",
    year: "c. 65",
    source: "Moral Letters to Lucilius, Letter 1, translated by Richard M. Gummere (1917), Wikisource",
    topics: ["later", "plan"]
  },
  {
    id: "aesop-anticipations",
    text: "Our mere anticipations of life outrun its realities.",
    author: "Aesop",
    work: "The Seaside Travelers",
    year: "1867",
    source: "Three Hundred Aesop's Fables, translated by George Fyler Townsend (1867) (Project Gutenberg #21)",
    topics: ["calm", "change"]
  },
  {
    id: "austen-large-income",
    text: "A large income is the best recipe for happiness I ever heard of.",
    speaker: "Mary Crawford",
    author: "Jane Austen",
    work: "Mansfield Park",
    year: "1814",
    source: "Mansfield Park, chapter 22 (Project Gutenberg #141)",
    topics: ["enjoy"]
  },
  {
    id: "thoreau-frittered",
    text: "Our life is frittered away by detail.",
    author: "Henry David Thoreau",
    work: "Walden",
    year: "1854",
    source: "Walden, \"Where I Lived, and What I Lived For\" (Project Gutenberg #205)",
    topics: ["small-costs", "calm"]
  },
  {
    id: "seneca-limit-of-wealth",
    text: "Do you ask what is the proper limit to wealth? It is, first, to have what is necessary, and, second, to have what is enough.",
    author: "Seneca",
    work: "Letters to Lucilius, Letter 2",
    year: "c. 65",
    source: "Moral Letters to Lucilius, Letter 2, translated by Richard M. Gummere (1917), Wikisource",
    topics: ["enough", "keep"]
  },
  {
    id: "franklin-no-need-of",
    text: "Buy what thou hast no need of, and ere long thou shalt sell thy necessaries.",
    author: "Benjamin Franklin",
    work: "The Way to Wealth",
    year: "1758",
    source: "Franklin's Way to Wealth; or, \"Poor Richard Improved\" (Project Gutenberg #43855)",
    topics: ["enough", "small-costs"]
  },
  {
    id: "franklin-stuff-of-life",
    text: "But, dost thou love life? then do not squander time, for that is the stuff life is made of",
    author: "Benjamin Franklin",
    work: "The Way to Wealth",
    year: "1758",
    source: "Franklin's Way to Wealth; or, \"Poor Richard Improved\" (Project Gutenberg #43855)",
    topics: ["time"]
  },
  {
    id: "austen-own-way",
    text: "I wish as well as every body else to be perfectly happy; but, like every body else it must be in my own way.",
    speaker: "Edward Ferrars",
    author: "Jane Austen",
    work: "Sense and Sensibility",
    year: "1811",
    source: "Sense and Sensibility, chapter 17 (Project Gutenberg #161)",
    topics: ["enjoy", "plan"]
  },
  {
    id: "thoreau-near-the-bone",
    text: "It is life near the bone where it is sweetest.",
    author: "Henry David Thoreau",
    work: "Walden",
    year: "1854",
    source: "Walden, \"Conclusion\" (Project Gutenberg #205)",
    topics: ["enough", "enjoy"]
  },
  {
    id: "emerson-insist-on-yourself",
    text: "Insist on yourself; never imitate.",
    author: "Ralph Waldo Emerson",
    work: "Essays: First Series, \"Self-Reliance\"",
    year: "1841",
    source: "Essays: First Series, \"Self-Reliance\" (Project Gutenberg #2944)",
    topics: ["enjoy", "change"]
  },
  {
    id: "thoreau-live-deliberately",
    text: "I went to the woods because I wished to live deliberately",
    author: "Henry David Thoreau",
    work: "Walden",
    year: "1854",
    source: "Walden, \"Where I Lived, and What I Lived For\" (Project Gutenberg #205)",
    topics: ["plan", "enjoy"]
  }
];

// "Henry David Thoreau, Walden", or "Mr Micawber, in Charles Dickens,
// David Copperfield".
export function quoteCitation(quote: CheckInQuote) {
  return quote.speaker ? `${quote.speaker}, in ${quote.author}, ${quote.work}` : `${quote.author}, ${quote.work}`;
}
