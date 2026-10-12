import { copyFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const MONTH = "2026-08";
const SAMPLE_EXPORT_NAME = "CC_TXN_History_06052026211223";
const SAMPLE_CARD_ACCOUNT = "UOB One Card (new)";
const SCRATCH = process.env.MOCK_SCRATCH ?? path.join(os.tmpdir(), "mock-round2");

export async function reseed(page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await page.request.post("/api/demo/reseed").catch(() => null);
    if (response?.ok()) return;
    await page.waitForTimeout(750);
  }
  throw new Error("reseed failed");
}

export async function openSettingsSection(page, h, heading) {
  await h.open(page, "/settings?view=household");
  if (!heading) return null;
  const toggle = page.locator(".settings-section-toggle").filter({ has: page.getByRole("heading", { name: heading, exact: true }) }).first();
  await toggle.click();
  await page.waitForTimeout(700);
  await toggle.evaluate((el) => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 10, behavior: "instant" }));
  await page.waitForTimeout(400);
  return toggle;
}

// The guide's import workflow up to the preview with the account mapped.
export async function importPreview(page, h, { mapAccount = true } = {}) {
  await reseed(page);
  const reference = await (await page.request.get("/api/reference-data")).json();
  const serene = reference.accounts.find((account) => account.name === "UOB PRVI Miles Card")?.ownerPersonId;
  await page.request.post("/api/accounts/create", {
    data: { name: SAMPLE_CARD_ACCOUNT, institution: "UOB", kind: "credit_card", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: serene ?? null, isJoint: false }
  });
  const target = `${SCRATCH}/files/${SAMPLE_EXPORT_NAME}.xls`;
  await mkdir(`${SCRATCH}/files`, { recursive: true });
  await copyFile(`${ROOT}/tests/fixtures/uob-current-transactions/CC_TXN_History_06052026211223-onecard-tim-06-may.xls`, target);
  await h.open(page, `/imports?view=household&month=${MONTH}`);
  await page.getByRole("button", { name: "Paste rows or set defaults" }).click();
  await page.getByLabel("Default account").selectOption({ label: `${SAMPLE_CARD_ACCOUNT} - Serene` });
  await page.locator("input[type=file]").first().setInputFiles(target);
  await page.getByText(/ready for review/).first().waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForTimeout(1500);
  if (mapAccount) {
    await page.getByRole("combobox").filter({ has: page.locator("option", { hasText: "Choose account" }) }).first().selectOption({ label: `${SAMPLE_CARD_ACCOUNT} - Serene` });
    await page.locator("button:has-text('Commit import to ledger'):enabled").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
  }
}
