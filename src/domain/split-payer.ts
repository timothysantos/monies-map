// Who paid a ledger entry that is put on Splits (DOMAIN.md "Split Payer";
// owner decision 2026-11-18, Ask audit B28). A wallet that belongs to one
// person means that person paid, whoever the entry is for: Joyce's dinner on
// Tim's card was paid by Tim. A joint wallet (or one with no owner) keeps
// the entry's owner. Only a new add to Splits uses this; a split already
// saved keeps its payer.

export interface SplitPayerFacts {
  entryOwnerPersonId: string | null;
  walletOwnerPersonId: string | null;
  walletIsJoint: boolean;
}

export function splitPayerForEntry(facts: SplitPayerFacts): { payerPersonId: string | null; fromWallet: boolean } {
  if (!facts.walletIsJoint && facts.walletOwnerPersonId) {
    return {
      payerPersonId: facts.walletOwnerPersonId,
      fromWallet: Boolean(facts.entryOwnerPersonId) && facts.walletOwnerPersonId !== facts.entryOwnerPersonId
    };
  }
  return { payerPersonId: facts.entryOwnerPersonId ?? facts.walletOwnerPersonId, fromWallet: false };
}
