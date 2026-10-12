import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// Swipe down to close on phone bottom sheets (design.md, "Mobile Sheet"):
// the shared EntryMobileSheet (here the Entries edit sheet) and the phone
// Splits dialog. A clean sheet closes; a changed one springs back and asks
// "Discard changes?" in a bar at its bottom (Keep editing keeps the draft,
// Discard closes without saving); sideways chip moves and the sheet's own
// scrolling are never taken over; a save in flight ignores the swipe.
//
// Touches are dispatched as TouchEvents in the page (WebKit cannot drive a
// real touch drag); in Chromium the scrolling and swipe proofs also go
// through the real input pipeline with CDP Input.dispatchTouchEvent.
//
// Tagged @webkit: `npm run test:e2e:webkit` runs them in WebKit on an
// iPhone 13 profile too.

const PHONE = { width: 390, height: 664 };
const MONTH = "2026-05";

test.use({ hasTouch: true });

async function phone(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.setViewportSize(PHONE);
  await reseedDemo(page);
}

async function createManualEntry(page, description, note = "") {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 3210,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note
  });
  return entryId;
}

async function openEditSheet(page, entryId) {
  await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
  const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  return sheet;
}

async function savedEntry(page, entryId) {
  const payload = await loadEntriesPage(page, { view: "person-tim", month: MONTH });
  return payload.monthPage.entries.find((entry) => entry.id === entryId);
}

/**
 * A one-finger drag dispatched as TouchEvents from the element at `from`
 * (viewport px) by each of `moves` in turn, `stepMs` apart, released
 * `restMs` after the last move. Returns which touchmoves the sheet's swipe
 * cancelled and the sheet's inline transform at the end of the drag and
 * straight after the release. Cancellation is read on <body>, after the
 * sheet's own listener and before the page-wide scroll lock's (which
 * cancels moves that have nothing to scroll, as it always has).
 */
function syntheticDrag(page, { from, moves, stepMs = 16, restMs = 0, sheetSelector }) {
  return page.evaluate(async ({ from, moves, stepMs, restMs, sheetSelector }) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const target = document.elementFromPoint(from.x, from.y);
    // Chromium builds a Touch with its constructor; WebKit (as on iPhone)
    // only with document.createTouch and a TouchList.
    const canConstructTouch = (() => {
      try {
        return Boolean(new Touch({ identifier: 0, target }));
      } catch {
        return false;
      }
    })();
    const touchAt = (x, y) => canConstructTouch
      ? new Touch({ identifier: 7, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y })
      // createTouch takes page coordinates: the client point is the page
      // point less the scroll, and the page behind may still be smooth-
      // scrolling to the edited row.
      : document.createTouch(window, target, 7, x + window.scrollX, y + window.scrollY, x, y);
    const list = (...touches) => canConstructTouch ? touches : document.createTouchList(...touches);
    const fire = (type, touch, active) => {
      const event = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        touches: active ? list(touch) : list(),
        targetTouches: active ? list(touch) : list(),
        changedTouches: list(touch)
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const sheet = document.querySelector(sheetSelector);
    const prevented = [];
    const record = (event) => prevented.push(event.defaultPrevented);
    document.body.addEventListener("touchmove", record);
    fire("touchstart", touchAt(from.x, from.y), true);
    let { x, y } = from;
    for (const move of moves) {
      await wait(stepMs);
      x += move.dx ?? 0;
      y += move.dy ?? 0;
      fire("touchmove", touchAt(x, y), true);
    }
    document.body.removeEventListener("touchmove", record);
    const transformDuringDrag = sheet?.style.transform ?? "";
    await wait(restMs);
    fire("touchend", touchAt(x, y), false);
    return {
      prevented,
      transformDuringDrag,
      transformAfterRelease: sheet?.style.transform ?? "",
      transitionAfterRelease: sheet?.style.transition ?? ""
    };
  }, { from, moves, stepMs, restMs, sheetSelector });
}

const down = (total, steps = 10) => Array.from({ length: steps }, () => ({ dy: total / steps }));

// A slow swipe from the sheet's top edge (the grab bar), well past the
// threshold, with a rest before letting go so it is not a flick.
async function swipeDown(page, sheet, sheetSelector, { distance = 260 } = {}) {
  const rect = await sheet.boundingBox();
  return syntheticDrag(page, {
    from: { x: rect.x + rect.width / 2, y: rect.y + 8 },
    moves: down(distance),
    stepMs: 20,
    restMs: 140,
    sheetSelector
  });
}

// The Month "Match planned item" sheet with a candidate list long enough to
// scroll inside the sheet (its own scroll box, a nested scroller).
async function openPlanLinkSheet(page) {
  const label = `Swipe list night ${Date.now()}`;
  await postJson(page, "/api/month-plan/save", {
    rowId: `swipe-plan-link-${Date.now()}`,
    month: MONTH,
    sectionKey: "planned_items",
    categoryName: "Entertainment",
    label,
    planDate: `${MONTH}-18`,
    accountName: "UOB One",
    plannedMinor: 5000,
    note: "",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  for (let index = 0; index < 14; index += 1) {
    await postJson(page, "/api/entries/create", {
      date: `${MONTH}-${String(10 + index).padStart(2, "0")}`,
      description: `Swipe list candidate ${index + 1}`,
      accountName: "UOB One",
      categoryName: "Entertainment",
      amountMinor: 1000 + index,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
  }
  await page.goto(`/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`);
  await page.locator("tr").filter({ hasText: label }).first().getByRole("button", { name: "Link entries" }).click();
  const sheet = page.locator('.entry-mobile-sheet[aria-label="Match planned item"]');
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  const list = sheet.locator(".planned-link-list");
  await expect(list).toContainText("Swipe list candidate 14");
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight + 40)).toBe(true);
  return { sheet, list };
}

const EDIT_SHEET = '.entry-mobile-sheet[aria-label="Edit entry"]';
const MONTH_SHEET = ".summary-month-sheet";
const SETTLEMENT_SHEET = ".split-dialog-content.split-settlement-dialog";

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 45_000 }).toBe(true);
}

// The Summary tab's "Pick a month" sheet with a tile for every month of the
// year-long range (the demo leaves some months empty), so the tiles run
// past the sheet and its body scrolls.
async function openMonthSheet(page) {
  for (const month of ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"]) {
    await postJson(page, "/api/entries/create", {
      date: `${month}-12`,
      description: `Swipe tile ${month}`,
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 4200,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
  }
  await page.goto("/summary?view=person-tim&month=2026-05&summary_start=2025-06&summary_end=2026-05");
  await waitUsable(page);
  await page.locator(".mobile-context-sticky-wrap").getByRole("button", { name: /All months/ }).click();
  const sheet = page.getByRole("dialog", { name: "Pick a month" });
  await expect(sheet).toBeVisible();
  const body = sheet.locator("[data-sheet-body]");
  await expect(body).toHaveClass(/summary-month-sheet-body/);
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight + 60)).toBe(true);
  return { sheet, body };
}

// The phone Splits "Record settlement" sheet, from the group's Settle group.
async function openSettlementSheet(page) {
  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
  await waitUsable(page);
  await page.getByRole("button", { name: "Settle group" }).filter({ visible: true }).first().click();
  const sheet = page.getByRole("dialog", { name: "Record settlement" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe("Swipe down to close a phone sheet", { tag: "@webkit" }, () => {
  test("a clean sheet follows the finger and closes on release; a short drag springs back", async ({ page }) => {
    await phone(page);
    const entryId = await createManualEntry(page, `Swipe clean ${Date.now()}`);
    const sheet = await openEditSheet(page, entryId);
    await expect(sheet.locator(".sheet-drag-handle")).toBeVisible();
    await expect(sheet.locator(".sheet-drag-handle")).toHaveAttribute("aria-hidden", "true");

    // Short of the threshold: the sheet moved with the finger, then goes back.
    const rect = await sheet.boundingBox();
    const short = await syntheticDrag(page, {
      from: { x: rect.x + rect.width / 2, y: rect.y + 8 },
      moves: down(50, 5),
      stepMs: 20,
      restMs: 140,
      sheetSelector: EDIT_SHEET
    });
    expect(short.transformDuringDrag).toBe("translateY(50px)");
    expect(short.prevented.every(Boolean)).toBe(true);
    expect(short.transformAfterRelease).toBe("translateY(0px)");
    expect(short.transitionAfterRelease).toContain("transform 200ms");
    await expect(sheet).toBeVisible();
    await expect.poll(() => sheet.evaluate((element) => element.style.transform)).toBe("");

    const swipe = await swipeDown(page, sheet, EDIT_SHEET);
    expect(swipe.transformDuringDrag).toBe("translateY(260px)");
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("alertdialog", { name: "Discard changes?" })).toHaveCount(0);
    await expect(page).not.toHaveURL(/editing_entry=/);
  });

  test("a changed sheet asks Discard changes?: Keep editing keeps the draft, Discard closes without saving", async ({ page }) => {
    await phone(page);
    const entryId = await createManualEntry(page, `Swipe dirty ${Date.now()}`, "Original note");
    const sheet = await openEditSheet(page, entryId);
    const note = sheet.getByRole("textbox", { name: "Note", exact: true });
    await note.fill("Half-typed note");
    // Off the field, as a person would before swiping.
    await sheet.locator(".entry-composer-copy strong").click();

    await swipeDown(page, sheet, EDIT_SHEET);
    const confirm = page.getByRole("alertdialog", { name: "Discard changes?" });
    await expect(confirm).toBeVisible();
    await expect(sheet).toBeVisible();
    await expect(confirm.getByRole("button")).toHaveText(["Discard", "Keep editing"]);
    await expect(confirm.getByRole("button", { name: "Keep editing" })).toBeFocused();
    // The sheet springs back to where it rests, with the question at its
    // bottom, under the thumb.
    await expect.poll(() => sheet.evaluate((element) => element.style.transform)).toBe("");
    const [sheetBox, confirmBox] = [await sheet.boundingBox(), await confirm.boundingBox()];
    expect(Math.abs(sheetBox.y + sheetBox.height - (confirmBox.y + confirmBox.height))).toBeLessThan(2);

    await confirm.getByRole("button", { name: "Keep editing" }).tap();
    await expect(confirm).toBeHidden();
    await expect(note).toHaveValue("Half-typed note");

    // Escape with the question up keeps editing too, rather than closing.
    await swipeDown(page, sheet, EDIT_SHEET);
    await expect(confirm).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(note).toHaveValue("Half-typed note");

    await swipeDown(page, sheet, EDIT_SHEET);
    await confirm.getByRole("button", { name: "Discard" }).tap();
    await expect(sheet).toBeHidden();
    expect((await savedEntry(page, entryId)).note).toBe("Original note");
  });

  test("a sideways move on the chip row and the body's own scrolling are never taken over", async ({ page }) => {
    await phone(page);
    const entryId = await createManualEntry(page, `Swipe chips ${Date.now()}`);
    const sheet = await openEditSheet(page, entryId);

    const chips = sheet.locator(".lsd-chips").first();
    const chipBox = await chips.boundingBox();
    const sideways = await syntheticDrag(page, {
      from: { x: chipBox.x + chipBox.width - 20, y: chipBox.y + chipBox.height / 2 },
      moves: [{ dx: -8, dy: 2 }, { dx: -30, dy: 3 }, { dx: -60, dy: 4 }, { dx: -60, dy: 30 }],
      sheetSelector: EDIT_SHEET
    });
    expect(sideways.prevented).toEqual([false, false, false, false]);
    expect(sideways.transformDuringDrag).toBe("");
    await expect(sheet).toBeVisible();

    // An upward drag in the body scrolls it: never cancelled, sheet unmoved.
    await sheet.getByRole("button", { name: /More details/ }).click();
    const body = sheet.locator("[data-sheet-body]");
    const bodyBox = await body.boundingBox();
    const upward = await syntheticDrag(page, {
      from: { x: bodyBox.x + bodyBox.width / 2, y: bodyBox.y + bodyBox.height - 60 },
      moves: [{ dy: -4 }, { dy: -20 }, { dy: -60 }],
      sheetSelector: EDIT_SHEET
    });
    expect(upward.prevented).toEqual([false, false, false]);
    expect(upward.transformDuringDrag).toBe("");

    // Scrolled away from its top, a downward drag in the body is the body's.
    await body.evaluate((element) => { element.scrollTop = 120; });
    expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const scrolled = await syntheticDrag(page, {
      from: { x: bodyBox.x + bodyBox.width / 2, y: bodyBox.y + 200 },
      moves: down(260),
      stepMs: 20,
      restMs: 140,
      sheetSelector: EDIT_SHEET
    });
    expect(scrolled.prevented.some(Boolean)).toBe(false);
    expect(scrolled.transformDuringDrag).toBe("");
    await expect(sheet).toBeVisible();
    // No touch-action on the sheet: every scrollable child keeps native touch.
    expect(await sheet.evaluate((element) => getComputedStyle(element).touchAction)).toBe("auto");
  });

  test("while Save is in flight a swipe is ignored, and the save still lands", async ({ page }) => {
    await phone(page);
    const entryId = await createManualEntry(page, `Swipe saving ${Date.now()}`);
    const sheet = await openEditSheet(page, entryId);
    await sheet.getByRole("textbox", { name: "Note", exact: true }).fill("Saved while swiping");

    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/entries/update", async (route) => {
      await held;
      await route.continue();
    });
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet.getByRole("button", { name: "Saving..." })).toBeVisible();

    const swipe = await swipeDown(page, sheet, EDIT_SHEET);
    expect(swipe.prevented.some(Boolean)).toBe(false);
    expect(swipe.transformDuringDrag).toBe("");
    await expect(sheet).toBeVisible();
    await expect(page.getByRole("alertdialog", { name: "Discard changes?" })).toHaveCount(0);

    release();
    await expect(sheet).toBeHidden();
    await expect.poll(async () => (await savedEntry(page, entryId)).note).toBe("Saved while swiping");
  });

  test("with reduced motion the sheet moves with the finger but never animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await phone(page);
    const entryId = await createManualEntry(page, `Swipe still ${Date.now()}`);
    const sheet = await openEditSheet(page, entryId);
    const rect = await sheet.boundingBox();
    const short = await syntheticDrag(page, {
      from: { x: rect.x + rect.width / 2, y: rect.y + 8 },
      moves: down(50, 5),
      stepMs: 20,
      restMs: 140,
      sheetSelector: EDIT_SHEET
    });
    expect(short.transformDuringDrag).toBe("translateY(50px)");
    expect(short.transformAfterRelease).toBe("");
    expect(short.transitionAfterRelease).toBe("");
    await swipeDown(page, sheet, EDIT_SHEET);
    await expect(sheet).toBeHidden();
  });

  test("a long list inside the sheet keeps its touches: a downward drag on it never moves the sheet", async ({ page }) => {
    await phone(page);
    const { sheet, list } = await openPlanLinkSheet(page);
    const listBox = await list.boundingBox();
    const onList = await syntheticDrag(page, {
      from: { x: listBox.x + 40, y: listBox.y + 20 },
      moves: down(260),
      stepMs: 20,
      restMs: 140,
      sheetSelector: '.entry-mobile-sheet[aria-label="Match planned item"]'
    });
    expect(onList.prevented.some(Boolean)).toBe(false);
    expect(onList.transformDuringDrag).toBe("");
    await expect(sheet).toBeVisible();
    // From the sheet's top it still swipes closed (nothing ticked: clean).
    await swipeDown(page, sheet, '.entry-mobile-sheet[aria-label="Match planned item"]');
    await expect(sheet).toBeHidden();
  });

  test("the phone Splits dialog swipes too: New split expense closes clean and asks once changed", async ({ page }) => {
    await phone(page);
    const open = async () => {
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none&split_action=add-expense");
      const dialog = page.getByRole("dialog", { name: "New split expense" });
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      return dialog;
    };
    const selector = ".split-dialog-content.split-expense-create";
    let dialog = await open();
    await expect(dialog.locator(".sheet-drag-handle")).toBeVisible();
    // The amount field takes focus on open; a swipe from the grab bar still works.
    await swipeDown(page, dialog, selector);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("alertdialog", { name: "Discard changes?" })).toHaveCount(0);

    dialog = await open();
    await dialog.locator(".lsd-card").getByRole("textbox", { name: "Expense total" }).fill("42.50");
    await dialog.getByRole("heading", { name: "New split expense" }).click();
    await swipeDown(page, dialog, selector);
    const confirm = page.getByRole("alertdialog", { name: "Discard changes?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Keep editing" }).tap();
    await expect(dialog.locator(".lsd-card").getByRole("textbox", { name: "Expense total" })).toHaveValue("42.50");
    await swipeDown(page, dialog, selector);
    await confirm.getByRole("button", { name: "Discard" }).tap();
    await expect(dialog).toBeHidden();
  });

  test("Edit split swipes the same way: unchanged it closes, changed from the saved split it asks", async ({ page }) => {
    await phone(page);
    const { splitExpenseId } = await postJson(page, "/api/splits/expenses/create", {
      groupId: null,
      date: `${MONTH}-10`,
      description: `Swipe edit split ${Date.now()}`,
      categoryName: "Groceries",
      payerPersonName: "Tim",
      amountMinor: 8640,
      note: "",
      splitBasisPoints: 5000,
      splitAmountMinor: 4320,
      currency: "SGD",
      paymentMethod: "cash",
      paymentStatus: "recorded"
    });
    let updates = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/splits/expenses/update")) updates += 1;
    });
    const open = async () => {
      await page.goto(`/splits?view=person-tim&month=${MONTH}&split_group=split-group-none&editing_split_expense=${splitExpenseId}`);
      const dialog = page.getByRole("dialog", { name: "Edit split" });
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      return dialog;
    };
    const selector = ".split-dialog-content.split-expense-card-dialog";
    let dialog = await open();
    await swipeDown(page, dialog, selector);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("alertdialog", { name: "Discard changes?" })).toHaveCount(0);

    dialog = await open();
    const total = dialog.locator(".lsd-card").getByRole("textbox", { name: "Expense total" });
    await total.fill("90");
    await dialog.getByRole("heading", { name: "Edit split" }).click();
    await swipeDown(page, dialog, selector);
    const confirm = page.getByRole("alertdialog", { name: "Discard changes?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Keep editing" }).tap();
    await expect(total).toHaveValue("90.00");
    // Typed back to the saved total, it is clean again.
    await total.fill("86.40");
    await dialog.getByRole("heading", { name: "Edit split" }).click();
    await swipeDown(page, dialog, selector);
    await expect(dialog).toBeHidden();
    await expect(confirm).toHaveCount(0);
    expect(updates).toBe(0);
  });

  test("the Summary Pick a month sheet swipes closed from its top, and its month grid keeps its touches", async ({ page }) => {
    await phone(page);
    const { sheet, body } = await openMonthSheet(page);
    await expect(sheet.locator(".sheet-drag-handle")).toBeVisible();
    await expect(sheet.locator(".sheet-drag-handle")).toHaveAttribute("aria-hidden", "true");

    // An upward drag on the month tiles scrolls them: never cancelled, the
    // sheet stays put.
    const bodyBox = await body.boundingBox();
    const upward = await syntheticDrag(page, {
      from: { x: bodyBox.x + bodyBox.width / 2, y: bodyBox.y + bodyBox.height - 60 },
      moves: [{ dy: -4 }, { dy: -20 }, { dy: -60 }],
      sheetSelector: MONTH_SHEET
    });
    expect(upward.prevented).toEqual([false, false, false]);
    expect(upward.transformDuringDrag).toBe("");

    // Scrolled down the grid, a downward drag on it scrolls the grid back
    // rather than moving the sheet.
    await body.evaluate((element) => { element.scrollTop = 160; });
    const scrolled = await syntheticDrag(page, {
      from: { x: bodyBox.x + bodyBox.width / 2, y: bodyBox.y + 120 },
      moves: down(260),
      stepMs: 20,
      restMs: 140,
      sheetSelector: MONTH_SHEET
    });
    expect(scrolled.prevented.some(Boolean)).toBe(false);
    expect(scrolled.transformDuringDrag).toBe("");
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((element) => getComputedStyle(element).touchAction)).toBe("auto");

    // Nothing to lose here: a swipe from the top closes it straight away,
    // leaving All months as it was.
    await body.evaluate((element) => { element.scrollTop = 0; });
    const swipe = await swipeDown(page, sheet, MONTH_SHEET);
    expect(swipe.transformDuringDrag).toBe("translateY(260px)");
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("alertdialog", { name: "Discard changes?" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/summary\?/);
    await expect(page).not.toHaveURL(/\/month\?/);
  });

  test("the Splits settlement sheet swipes: an untouched one closes, a changed one asks Discard changes?", async ({ page }) => {
    await phone(page);
    let sheet = await openSettlementSheet(page);
    await expect(sheet.locator(".sheet-drag-handle")).toBeVisible();
    // The amount field takes focus on open; a swipe from the grab bar still works.
    await swipeDown(page, sheet, SETTLEMENT_SHEET);
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("alertdialog", { name: "Discard changes?" })).toHaveCount(0);

    sheet = await openSettlementSheet(page);
    const note = sheet.getByLabel("Note");
    await note.fill("Half-typed settle-up note");
    await sheet.getByRole("heading", { name: "Record settlement" }).click();
    await swipeDown(page, sheet, SETTLEMENT_SHEET);
    const confirm = page.getByRole("alertdialog", { name: "Discard changes?" });
    await expect(confirm).toBeVisible();
    await expect(sheet).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Keep editing" })).toBeFocused();
    await confirm.getByRole("button", { name: "Keep editing" }).tap();
    await expect(confirm).toBeHidden();
    await expect(note).toHaveValue("Half-typed settle-up note");

    await swipeDown(page, sheet, SETTLEMENT_SHEET);
    await confirm.getByRole("button", { name: "Discard" }).tap();
    await expect(sheet).toBeHidden();
    // Nothing was recorded: the group is still open.
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    const group = data.splitsPage.groups.find((item) => item.id === "split-group-none");
    expect(group?.summaryText).not.toBe("Settled up");
  });

  test("the other phone sheets swipe closed too: Activity history, Create group (asks once changed)", async ({ page }) => {
    await phone(page);

    // View and scope gains swipe with the mobile chrome redesign (its lazy import here split the first screen).
    await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
    await waitUsable(page);
    await page.getByRole("button", { name: "Activity history" }).filter({ visible: true }).first().click();
    const history = page.getByRole("dialog", { name: "Split activity history" });
    await expect(history).toBeVisible();
    await expect(history.locator(".sheet-drag-handle")).toBeVisible();
    await swipeDown(page, history, ".split-history-dialog");
    await expect(history).toBeHidden();

    // The All groups sheet has nothing to lose, so a swipe always closes it.
    await page.getByRole("button", { name: "All groups" }).filter({ visible: true }).first().click();
    const allGroups = page.getByRole("dialog", { name: "All groups" });
    await expect(allGroups).toBeVisible();
    await expect(allGroups.locator(".sheet-drag-handle")).toBeVisible();
    await swipeDown(page, allGroups, ".splits-groups-sheet");
    await expect(allGroups).toBeHidden();

    const openGroupSheet = async () => {
      await page.getByRole("button", { name: "Create group" }).filter({ visible: true }).first().click();
      const sheet = page.getByRole("dialog", { name: "Create group" });
      await expect(sheet).toBeVisible();
      return sheet;
    };
    let group = await openGroupSheet();
    await expect(group.locator(".sheet-drag-handle")).toBeVisible();
    await swipeDown(page, group, ".split-group-dialog");
    await expect(group).toBeHidden();
    await expect(page.getByRole("alertdialog", { name: "Discard changes?" })).toHaveCount(0);

    group = await openGroupSheet();
    await group.getByLabel("Group name").fill("Swipe trip");
    await group.getByRole("heading", { name: "Create group" }).click();
    await swipeDown(page, group, ".split-group-dialog");
    const confirm = page.getByRole("alertdialog", { name: "Discard changes?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Discard" }).tap();
    await expect(group).toBeHidden();
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    expect(data.splitsPage.groups.some((item) => item.name === "Swipe trip")).toBe(false);
  });

  test("on a desktop the same Splits dialogs stay centred dialogs with no grab bar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await reseedDemo(page);
    await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
    await waitUsable(page);
    await page.locator(".splits-lead").getByRole("button", { name: "Settle group" }).click();
    const sheet = page.getByRole("dialog", { name: "Record settlement" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".sheet-drag-handle")).toHaveCount(0);
  });
});

// Real touch input (Chromium only): the browser's own gesture pipeline, so
// a cancelled touchmove really stops scrolling and an uncancelled one
// really scrolls.
test.describe("Swipe down with real touch input", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "CDP touch input is Chromium only");

  async function realDrag(page, client, { from, to, steps = 12, stepMs = 16, restMs = 0 }) {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
    for (let step = 1; step <= steps; step += 1) {
      await page.waitForTimeout(stepMs);
      const x = from.x + ((to.x - from.x) * step) / steps;
      const y = from.y + ((to.y - from.y) * step) / steps;
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    }
    if (restMs) {
      await page.waitForTimeout(restMs);
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  test("a long list inside the sheet scrolls by touch both ways, with the swipe installed", async ({ page }) => {
    await phone(page);
    const { sheet, list } = await openPlanLinkSheet(page);
    const client = await page.context().newCDPSession(page);
    const listBox = await list.boundingBox();
    const x = listBox.x + 40;
    // Within the list's visible rows (its bottom edge sits under the Save bar).
    const top = listBox.y + 20;
    const lower = listBox.y + 150;
    expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".planned-link-list")), { x, y: lower })).toBe(true);
    await realDrag(page, client, { from: { x, y: lower }, to: { x, y: top } });
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(60);
    const scrolled = await list.evaluate((element) => element.scrollTop);
    await realDrag(page, client, { from: { x, y: top }, to: { x, y: lower } });
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeLessThan(scrolled);
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((element) => element.style.transform)).toBe("");
  });

  test("the Pick a month grid scrolls by touch both ways, and a swipe from the top closes the sheet", async ({ page }) => {
    await phone(page);
    const { sheet, body } = await openMonthSheet(page);
    const client = await page.context().newCDPSession(page);
    const bodyBox = await body.boundingBox();
    const x = bodyBox.x + bodyBox.width / 2;
    await realDrag(page, client, { from: { x, y: bodyBox.y + bodyBox.height - 40 }, to: { x, y: bodyBox.y + 60 } });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(60);
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((element) => element.style.transform)).toBe("");

    const scrolledTop = await body.evaluate((element) => element.scrollTop);
    await realDrag(page, client, { from: { x, y: bodyBox.y + 60 }, to: { x, y: bodyBox.y + 60 + Math.min(scrolledTop, 150) / 2 } });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeLessThan(scrolledTop);
    await expect(sheet).toBeVisible();

    await body.evaluate((element) => { element.scrollTop = 0; });
    const rect = await sheet.boundingBox();
    const top = { x: rect.x + rect.width / 2, y: rect.y + 8 };
    await realDrag(page, client, { from: top, to: { x: top.x, y: top.y + 260 }, steps: 12, stepMs: 20, restMs: 140 });
    await expect(sheet).toBeHidden();
  });

  test("the long sheet body still scrolls by touch, and a swipe from the top closes it", async ({ page }) => {
    await phone(page);
    const entryId = await createManualEntry(page, `Swipe real ${Date.now()}`);
    const sheet = await openEditSheet(page, entryId);
    await sheet.getByRole("button", { name: /More details/ }).click();
    const body = sheet.locator("[data-sheet-body]");
    expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    const client = await page.context().newCDPSession(page);

    const bodyBox = await body.boundingBox();
    const x = bodyBox.x + 30;
    await realDrag(page, client, { from: { x, y: bodyBox.y + bodyBox.height - 40 }, to: { x, y: bodyBox.y + 60 } });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(40);
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((element) => element.style.transform)).toBe("");

    // Scrolled down, a downward drag scrolls the body back instead of
    // moving the sheet.
    const scrolledTop = await body.evaluate((element) => element.scrollTop);
    await realDrag(page, client, { from: { x, y: bodyBox.y + 80 }, to: { x, y: bodyBox.y + 80 + Math.min(scrolledTop, 150) / 2 } });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeLessThan(scrolledTop);
    await expect(sheet).toBeVisible();

    await body.evaluate((element) => { element.scrollTop = 0; });
    const rect = await sheet.boundingBox();
    const top = { x: rect.x + rect.width / 2, y: rect.y + 8 };
    await realDrag(page, client, { from: top, to: { x: top.x, y: top.y + 260 }, steps: 12, stepMs: 20, restMs: 140 });
    await expect(sheet).toBeHidden();
  });
});
