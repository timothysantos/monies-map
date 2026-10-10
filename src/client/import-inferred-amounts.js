import { createContext, useContext } from "react";

// Amounts an image-statement parser could not read and took from the
// statement's printed total (ParsedStatementImport.ocrReview.inferredAmounts).
// A preview row is marked while its date, description and amount still match
// one; once the user corrects the amount it is the user's figure, not inferred.

/** @param {Array<{ date: string, description: string, amount: string }> | undefined | null} inferredAmounts */
export function buildInferredAmountKeys(inferredAmounts) {
  return new Set((inferredAmounts ?? []).map((item) => inferredKey(item.date, item.description, Math.round(Number(item.amount) * 100))));
}

/** @param {{ date: string, description: string, amountMinor: number }} row @param {Set<string>} keys */
export function isInferredAmountRow(row, keys) {
  return keys.size > 0 && keys.has(inferredKey(row.date, row.description, row.amountMinor));
}

function inferredKey(date, description, amountMinor) {
  return `${date}|${description}|${amountMinor}`;
}

const EMPTY_KEYS = new Set();
export const InferredAmountsContext = createContext(EMPTY_KEYS);

export function useInferredAmountKeys() {
  return useContext(InferredAmountsContext);
}
