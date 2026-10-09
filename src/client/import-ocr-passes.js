// Which parse of an image statement to show: one that adds up to the
// statement's totals beats one that needs review, and the first pass alone
// beats a two-pass reading only when it adds up and the two-pass one does
// not (a second pass can add a phantom row). Each argument is
// { parsed } or { error } from parsing that OCR text.
export function chooseImageStatementParse(firstPass, bothPasses) {
  const addsUp = (attempt) => Boolean(attempt?.parsed && !attempt.parsed.reconciliation);
  if (addsUp(bothPasses)) {
    return bothPasses.parsed;
  }
  if (addsUp(firstPass)) {
    return firstPass.parsed;
  }
  const reviewable = bothPasses?.parsed ?? firstPass?.parsed;
  if (reviewable) {
    return reviewable;
  }
  throw bothPasses?.error ?? firstPass?.error;
}

export function attemptParse(parse, text) {
  try {
    return { parsed: parse(text) };
  } catch (error) {
    return { error };
  }
}
