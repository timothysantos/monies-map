// What the Create account dialog is filled in with for an account a statement
// names that the app does not know: its kind and institution come from the
// parser that read the file first, then from the account's name.

const INVESTMENT_PARSER = /ifast|stashaway/i;

export function inferStatementAccountKind(accountName, parserKey) {
  // An investment statement is an investment account's, whatever its name says.
  if (INVESTMENT_PARSER.test(parserKey)) {
    return "investment";
  }
  return /credit_card|cashback|rewards|miles|card/i.test(parserKey) || /card|cashback|rewards|miles/i.test(accountName)
    ? "credit_card"
    : "bank";
}

export function inferStatementInstitution(accountName, parserKey) {
  if (/stashaway/i.test(parserKey)) {
    return "StashAway";
  }
  if (/citibank|citi/i.test(parserKey) || /citi/i.test(accountName)) {
    return "Citibank";
  }
  if (/ocbc/i.test(parserKey) || /ocbc/i.test(accountName)) {
    return "OCBC";
  }
  if (/uob/i.test(parserKey) || /uob/i.test(accountName)) {
    return "UOB";
  }
  if (/ifast/i.test(parserKey) || /ifast/i.test(accountName)) {
    return "iFAST";
  }
  return "";
}
