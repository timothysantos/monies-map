// Wallet card names that are pass-through cards (DOMAIN.md "Pass-through
// Card"): the card holds no money of its own, and every payment is charged to
// the card behind it. A tap on one of these goes to the person's card for
// other currencies, whatever the currency of the amount (Wallet writes "$12.34"
// when the amount is in the card's own currency, for example SGD chosen on a
// terminal abroad). Add a name here when another such card is added to Wallet.
export const passThroughWalletNames: readonly string[] = ["Amaze"];

function words(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-SG")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// Case-insensitive, and tolerant of a suffix after the name ("Amaze Card",
// "Amaze Card 7741"); the name must be whole words, so "Amazement Park" is not.
export function isPassThroughWalletName(walletName?: string): boolean {
  if (!walletName) {
    return false;
  }
  const given = words(walletName);
  return passThroughWalletNames.some((name) => {
    const wanted = words(name);
    return wanted.length > 0 && wanted.every((word, index) => given[index] === word);
  });
}
