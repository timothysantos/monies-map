// Locked statements in a real browser, at desktop and phone widths: a PDF
// that needs a password asks for it in an in-app dialog before anything reads
// it, says when the password was wrong, and then runs the normal import. The
// PDFs are the committed fixtures in tests/fixtures/locked-pdf/ (made by
// scripts/make-locked-pdf-fixture.mjs; the password is the fake test value
// below). The password must never leave the page: every request is recorded
// and searched for it. Docs: docs/audits/locked-statements.md.
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { dropFiles, expectImportRowsReady, postJson, reseedDemo } from "./helpers.js";

const PASSWORD = "TESTCARD12345678";
const WRONG_PASSWORD = "WRONGCARD00000000";
const FIXTURES = "tests/fixtures/locked-pdf";
const UOB_LOCKED_AES = `${FIXTURES}/uob-one-savings-apr-2026.locked-aes-128.pdf`;
const UOB_LOCKED_RC4 = `${FIXTURES}/uob-one-savings-apr-2026.locked-rc4-128.pdf`;
const UOB_PLAIN = `${FIXTURES}/uob-one-savings-apr-2026.plain.pdf`;
const UOB_OWNER_ONLY = `${FIXTURES}/uob-one-savings-apr-2026.owner-only.pdf`;
const HSBC_SEP_LOCKED = `${FIXTURES}/hsbc-visa-revolution-sep-2026.locked-rc4-128.pdf`;
// Set to a folder to also save the screenshots (docs/audits/locked-statements/).
const SHOT_DIR = process.env.LOCKED_SHOT_DIR;
const SHOT_PREFIX = process.env.LOCKED_SHOT_PREFIX ?? "after";
// "dark" emulates the dark colour scheme for the screenshots.
const SHOT_SCHEME = process.env.LOCKED_SHOT_SCHEME;

const DEVICES = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "phone", width: 390, height: 844 }
];

const dialog = (page) => page.getByRole("dialog", { name: "This statement is locked" });
const passwordField = (page) => dialog(page).getByLabel("Password", { exact: true });
const openButton = (page) => dialog(page).getByRole("button", { name: "Open statement" });
const skipButton = (page) => dialog(page).getByRole("button", { name: "Skip this file", exact: true });
const commitButton = (page) => page.locator(".import-commit-bar .import-commit-button");

// Records everything the page sends, so a password anywhere in a URL, a header
// or a body fails the test.
function recordRequests(page) {
  const sent = [];
  page.on("request", (request) => {
    sent.push(`${request.method()} ${request.url()}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ""}`);
  });
  return sent;
}

function expectNothingSentWith(sent, ...secrets) {
  for (const secret of secrets) {
    const hits = sent.filter((entry) => entry.includes(secret) || entry.includes(encodeURIComponent(secret)));
    expect(hits, `a request carried ${secret.slice(0, 4)}...`).toEqual([]);
  }
}

async function expectNothingStored(page, ...secrets) {
  const stored = await page.evaluate(async () => {
    const parts = [];
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        parts.push(`${key}=${storage.getItem(key)}`);
      }
    }
    parts.push(location.href);
    const databases = (await indexedDB.databases?.()) ?? [];
    parts.push(JSON.stringify(databases));
    return parts.join("\n");
  });
  for (const secret of secrets) {
    expect(stored).not.toContain(secret);
  }
}

async function shot(page, name) {
  if (SHOT_DIR) {
    await mkdir(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, `${SHOT_PREFIX}-${name}.png`) });
  }
}

async function openImports(page) {
  await page.goto("/imports?view=person-tim&month=2026-04", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function typePassword(page, value) {
  await passwordField(page).fill(value);
  await openButton(page).click();
}

for (const device of DEVICES) {
  test.describe(`${device.label}: locked statements`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: device.width, height: device.height });
      if (SHOT_SCHEME) {
        await page.emulateMedia({ colorScheme: SHOT_SCHEME });
      }
      await reseedDemo(page);
    });

    test("a locked statement asks for its password, refuses a wrong one, opens with the right one and commits", async ({ page }) => {
      test.setTimeout(180_000);
      const sent = recordRequests(page);
      await openImports(page);
      await page.locator("input[type=file]").setInputFiles(UOB_LOCKED_AES);

      await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
      await expect(dialog(page)).toContainText("uob-one-savings-apr-2026.locked-aes-128.pdf");
      await expect(dialog(page)).toContainText("Banks usually lock statements with part of your card number or ID. The password stays on this device and is not saved.");
      // Nothing was read yet: no preview, no mapping, no raw pdf.js error.
      await expect(page.getByText("No password given")).toHaveCount(0);
      await expect(page.locator(".import-stepper-step").first()).not.toContainText("rows ready");
      const field = passwordField(page);
      await expect(field).toHaveAttribute("type", "password");
      await expect(field).toHaveAttribute("autocomplete", "off");
      await expect(field).toHaveAttribute("inputmode", "text");
      const useForOthers = dialog(page).getByRole("checkbox", { name: "Use this password for my other locked files in this import" });
      await expect(useForOthers).not.toBeChecked();
      const toggle = dialog(page).getByRole("button", { name: "Show password" });
      const toggleBox = await toggle.boundingBox();
      expect(toggleBox.width).toBeGreaterThanOrEqual(44);
      expect(toggleBox.height).toBeGreaterThanOrEqual(44);
      await shot(page, `${device.label}-dialog`);

      await typePassword(page, WRONG_PASSWORD);
      await expect(dialog(page).getByRole("alert")).toHaveText("That password didn't work. Try again.");
      await expect(passwordField(page)).toHaveValue("");
      await expect(passwordField(page)).toBeFocused();
      await shot(page, `${device.label}-dialog-wrong`);

      await toggle.click();
      await expect(passwordField(page)).toHaveAttribute("type", "text");
      await expect(dialog(page).getByRole("button", { name: "Hide password" })).toBeVisible();
      await typePassword(page, PASSWORD);

      await expect(dialog(page)).toHaveCount(0, { timeout: 30_000 });
      await expectImportRowsReady(page, "4 rows ready for review");
      await shot(page, `${device.label}-preview`);
      await expect(commitButton(page)).toBeEnabled();
      await commitButton(page).click();
      // The demo household's UOB One does not match this statement's total,
      // so the app asks first; the rows still commit.
      await page.getByRole("button", { name: "Commit anyway" }).click();
      await expect(page.locator(".import-done-card")).toBeVisible({ timeout: 60_000 });

      // The password went nowhere: no request, no storage, no address.
      expectNothingSentWith(sent, PASSWORD, WRONG_PASSWORD);
      await expectNothingStored(page, PASSWORD, WRONG_PASSWORD);
    });

    test("skipping leaves the other files of the drop to carry on and marks the locked one", async ({ page }) => {
      const sent = recordRequests(page);
      await openImports(page);
      await page.locator("input[type=file]").setInputFiles([UOB_LOCKED_AES, UOB_PLAIN]);

      await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
      await skipButton(page).click();
      await expect(dialog(page)).toHaveCount(0);

      // The unlocked file was added to the queue, the locked one is a chip.
      await expect(page.getByText("1 file added to the intake queue.")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText("1 locked file was skipped. Add it again when you have the password.")).toBeVisible();
      await expect(page.locator(".import-file-chip.is-skipped")).toContainText("Skipped: locked");
      await expect(page.locator(".import-file-chip.is-skipped")).toHaveAttribute("title", /locked-aes-128/);
      await shot(page, `${device.label}-skipped`);
      expectNothingSentWith(sent, PASSWORD);
    });

    test("a single locked file that is skipped says so in plain words", async ({ page }) => {
      await openImports(page);
      await page.locator("input[type=file]").setInputFiles(UOB_LOCKED_AES);
      await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
      await skipButton(page).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByText("uob-one-savings-apr-2026.locked-aes-128.pdf is locked, so it was skipped. Add it again when you have its password.")).toBeVisible();
      await expect(page.getByText("No password given")).toHaveCount(0);
      // Adding it again asks again: the skipped file was not remembered.
      await page.locator("input[type=file]").setInputFiles(UOB_LOCKED_AES);
      await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
      await typePassword(page, PASSWORD);
      await expectImportRowsReady(page, "4 rows ready for review");
    });

    test("one question at a time, and the password can be kept for the other locked files of the drop", async ({ page }) => {
      test.setTimeout(180_000);
      const sent = recordRequests(page);
      await openImports(page);
      await page.locator("input[type=file]").setInputFiles([UOB_LOCKED_AES, UOB_LOCKED_RC4]);

      // Without the checkbox each locked file asks, one dialog at a time.
      await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
      await expect(dialog(page)).toContainText("locked-aes-128.pdf");
      await typePassword(page, PASSWORD);
      await expect(dialog(page)).toContainText("locked-rc4-128.pdf", { timeout: 30_000 });
      expect(await page.getByRole("dialog").count()).toBe(1);
      await skipButton(page).click();
      await expect(dialog(page)).toHaveCount(0);

      // With the checkbox the second file opens by itself.
      await openImports(page);
      await page.locator("input[type=file]").setInputFiles([UOB_LOCKED_AES, UOB_LOCKED_RC4]);
      await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
      await dialog(page).getByRole("checkbox", { name: "Use this password for my other locked files in this import" }).check();
      await typePassword(page, PASSWORD);
      await expect(page.getByText(/files? added to the intake queue/)).toBeVisible({ timeout: 60_000 });
      await expect(dialog(page)).toHaveCount(0);
      expectNothingSentWith(sent, PASSWORD);
      await expectNothingStored(page, PASSWORD);
    });

    test("a statement locked only against copying and printing opens without a question", async ({ page }) => {
      await openImports(page);
      await page.locator("input[type=file]").setInputFiles(UOB_OWNER_ONLY);
      await expectImportRowsReady(page, "4 rows ready for review");
      await expect(dialog(page)).toHaveCount(0);
    });
  });
}

test.describe("locked statements on a desktop keyboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    if (SHOT_SCHEME) {
      await page.emulateMedia({ colorScheme: SHOT_SCHEME });
    }
    await reseedDemo(page);
  });

  test("the password field has focus, Enter opens the statement and the dialog is labelled", async ({ page }) => {
    await openImports(page);
    await page.locator("input[type=file]").setInputFiles(UOB_LOCKED_AES);
    await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
    await expect(passwordField(page)).toBeFocused();
    await expect(dialog(page)).toHaveAccessibleDescription(/part of your card number or ID/);
    await page.keyboard.type(WRONG_PASSWORD);
    await page.keyboard.press("Enter");
    await expect(dialog(page).getByRole("alert")).toHaveText("That password didn't work. Try again.");
    await expect(passwordField(page)).toBeFocused();
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toHaveCount(0, { timeout: 30_000 });
    await expectImportRowsReady(page, "4 rows ready for review");
  });

  test("Escape skips the file", async ({ page }) => {
    await openImports(page);
    await page.locator("input[type=file]").setInputFiles(UOB_LOCKED_AES);
    await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText("is locked, so it was skipped.")).toBeVisible();
  });

  test("after 5 wrong passwords only skipping is offered", async ({ page }) => {
    await openImports(page);
    await page.locator("input[type=file]").setInputFiles(UOB_LOCKED_AES);
    await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await passwordField(page).fill(`${WRONG_PASSWORD}${attempt}`);
      await passwordField(page).press("Enter");
      await expect(dialog(page).getByRole("alert")).toBeVisible();
    }
    await expect(dialog(page).getByRole("alert")).toContainText("didn't work after 5 tries");
    await expect(passwordField(page)).toHaveCount(0);
    await expect(openButton(page)).toHaveCount(0);
    await shot(page, "desktop-dialog-out-of-tries");
    await skipButton(page).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("a drop while the question is open waits its turn instead of stacking a second one", async ({ page }) => {
    test.setTimeout(180_000);
    await openImports(page);
    await page.locator("input[type=file]").setInputFiles(UOB_LOCKED_AES);
    await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
    await expect(dialog(page)).toContainText("locked-aes-128.pdf");
    await dropFiles(page, "body", [{ name: "uob-one-savings-apr-2026.locked-rc4-128.pdf", type: "application/pdf", path: UOB_LOCKED_RC4 }]);
    await page.waitForTimeout(500);
    expect(await page.getByRole("dialog").count()).toBe(1);
    await expect(dialog(page)).toContainText("locked-aes-128.pdf");
    await typePassword(page, PASSWORD);
    // Only now does the second file ask.
    await expect(dialog(page)).toContainText("locked-rc4-128.pdf", { timeout: 30_000 });
    expect(await page.getByRole("dialog").count()).toBe(1);
    await skipButton(page).click();
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe("locked image statement (OCR after unlocking)", () => {
  test("a locked HSBC image statement is unlocked first, then read by private OCR in this browser", async ({ page }) => {
    // Real browser OCR of one statement with a second pass.
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await reseedDemo(page);
    await postJson(page, "/api/accounts/create", {
      name: "HSBC Visa Revolution",
      institution: "HSBC",
      kind: "credit_card",
      openingBalanceMinor: 0,
      currency: "SGD",
      ownerPersonId: "",
      isJoint: false
    });
    const sent = recordRequests(page);
    await page.goto("/imports?view=person-tim&month=2026-09", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Import and certify", exact: true })).toBeVisible({ timeout: 30_000 });
    await page.locator("input[type=file]").setInputFiles(HSBC_SEP_LOCKED);

    await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
    // The OCR engine has not started while the file is locked.
    await expect(page.getByText(/Running private OCR in this browser/)).toHaveCount(0);
    await typePassword(page, PASSWORD);
    await expect(page.getByText(/Running private OCR in this browser/)).toBeVisible({ timeout: 60_000 });
    await expectImportRowsReady(page, "3 rows ready for review", { timeout: 180_000 });
    await expect(dialog(page)).toHaveCount(0);
    expectNothingSentWith(sent, PASSWORD);
  });
});
