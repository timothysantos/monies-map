// The two-card UOB statement for browser tests: the sanitized PDF text
// (tests/fixtures/pdf-statement-text/uob-card-two-card-may-2026-sanitized)
// printed to a real PDF so the browser parses it as a user's file, and the
// ledger with OpenAI and Buyandship recorded on the wrong card.
import { readFile } from "node:fs/promises";

import { postJson, reseedDemo } from "./helpers.js";

export const ONE_CARD = "UOB One Card";
export const LADYS_CARD = "UOB Lady's Card";

export async function writeStatementPdf(page, path) {
  const text = (await readFile(new URL("../fixtures/pdf-statement-text/uob-card-two-card-may-2026-sanitized.pdf-text.txt", import.meta.url), "utf8"))
    .split("__PDF_LAYOUT_TEXT__")[0];
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pdfPage = await page.context().newPage();
  await pdfPage.setContent(`<html><body><pre style="font-family: Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.55; white-space: pre-wrap;">${escaped}</pre></body></html>`);
  await pdfPage.pdf({ path, format: "A4", printBackground: true });
  await pdfPage.close();
}

export async function setUpWrongCardLedger(page) {
  await reseedDemo(page);
  const createAccount = async (name, openingBalanceMinor) => (await postJson(page, "/api/accounts/create", {
    name,
    institution: "UOB",
    kind: "credit_card",
    currency: "SGD",
    openingBalanceMinor,
    ownerPersonId: "person-tim",
    isJoint: false
  })).accountId;
  const oneCardId = await createAccount(ONE_CARD, 15000);
  const ladysCardId = await createAccount(LADYS_CARD, -1250);
  const entry = async (accountId, date, description, amountMinor, categoryName, extra = {}) => (await postJson(page, "/api/entries/create", {
    accountId,
    date,
    description,
    amountMinor,
    categoryName,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    ...extra
  })).entryId;
  await entry(oneCardId, "2026-04-11", "HONG KONG ZHAI DIM SUM", 1140, "Food & Drinks");
  await entry(ladysCardId, "2026-04-30", "Don Don Donki", 1890, "Groceries");
  const openaiId = await entry(ladysCardId, "2026-04-20", "OpenAI", 2949, "Subscriptions MO");
  const buyandshipId = await entry(ladysCardId, "2026-05-05", "Buyandship", 1313, "Shopping");
  await entry(ladysCardId, "2026-05-14", "Sabai Sabai - Valley P", 2049, "Food & Drinks");
  return { oneCardId, ladysCardId, openaiId, buyandshipId, entry };
}
