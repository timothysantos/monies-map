// Ask's answer to "what's an annual fee?" (the `term` answer intent): the
// fixed plain explanation (ask-terms.ts) and, for a bank fee or S&CC, what
// the view paid for it this year, from the entries. Pure: the read is in
// pages/ask-answer.ts.
import { askTermByKey } from "./ask-terms";
import type { AskAnswerCardDto, PersonScope } from "../types/dto";

export interface TermFacts {
  kind: "term";
  termKey: string;
  name: string;
  text: string;
  year: string;
  month: string;
  viewId: string;
  scope: PersonScope;
  // What the view paid for it this year (after refunds), and what was
  // charged and then refunded; null when the term is no charge.
  yearMinor: number | null;
  refundedMinor: number;
  entryCount: number;
}

export function buildTermFacts(input: Omit<TermFacts, "kind" | "name" | "text">): TermFacts | null {
  const term = askTermByKey(input.termKey);
  return term ? { kind: "term", name: term.name, text: term.text, ...input } : null;
}

export function buildTermCard(facts: TermFacts): AskAnswerCardDto {
  return {
    title: facts.name,
    lead: { label: `${facts.name} in ${facts.year} so far`, amountMinor: facts.yearMinor ?? 0, currency: "SGD", tone: "neutral" },
    support: facts.refundedMinor > 0 ? [{ label: "Refunded", amountMinor: facts.refundedMinor, currency: "SGD" }] : [],
    lines: [],
    links: []
  };
}

export function buildTermWording(facts: TermFacts, money: (minor: number) => string): string {
  if (facts.yearMinor === null) {
    return facts.text;
  }
  const refunded = facts.refundedMinor > 0 ? ` Another ${money(facts.refundedMinor)} was charged and then refunded.` : "";
  const noun = /fee$/i.test(facts.name) ? `${facts.name.toLowerCase()}s` : facts.name === "S&CC" ? "S&CC" : facts.name.toLowerCase();
  const paid = facts.yearMinor > 0
    ? `This year: you paid ${money(facts.yearMinor)} in ${noun}.`
    : `This year: none so far.`;
  return `${facts.text} ${paid}${refunded}`;
}

export function buildTermPromptFacts(facts: TermFacts, money: (minor: number) => string): string[] {
  return [
    `${facts.name}: ${facts.text}`,
    ...(facts.yearMinor === null ? [] : [`Paid this year (${facts.year}): ${money(facts.yearMinor)}`]),
    ...(facts.refundedMinor > 0 ? [`Charged and then refunded: ${money(facts.refundedMinor)}`] : [])
  ];
}
