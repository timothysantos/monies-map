// Public-domain quotes for the expanded check-in. Loaded with a dynamic
// import when someone opens "Read full insight", so they never weigh on
// the first screen. Every line is copied exactly (spelling included) from
// the public-domain text named in `source`, checked before it was added.
// At most one shows, never beside a bigger question, and the same quote
// does not come back within 28 days (pickQuote in checkin.ts). This module
// holds only data, so its chunk carries nothing the first screen needs.
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
  }
];

// "Henry David Thoreau, Walden", or "Mr Micawber, in Charles Dickens,
// David Copperfield".
export function quoteCitation(quote: CheckInQuote) {
  return quote.speaker ? `${quote.speaker}, in ${quote.author}, ${quote.work}` : `${quote.author}, ${quote.work}`;
}
